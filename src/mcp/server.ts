import * as http from 'http';
import * as crypto from 'crypto';
import { McpToolEntry } from './tools.js';

/**
 * Runtime options for {@link McpServer.start}. All fields are optional and
 * fall back to sensible defaults. The server binds to loopback by default to
 * avoid accidental exposure.
 */
export interface McpServerOptions {
  /** Port to bind on. Defaults to 3847. Pass 0 to pick an ephemeral port. */
  port?: number;
  /** Bind address. Defaults to `127.0.0.1` (loopback only). */
  bindAddress?: string;
  /** If set, requests missing `Authorization: Bearer <token>` are rejected. */
  bearerToken?: string;
  /**
   * Maximum number of concurrent SSE sessions. Additional `GET /sse`
   * requests are rejected with HTTP 503 once the cap is reached. Defaults
   * to 16, which is generous for the typical "one MCP client per editor"
   * scenario while preventing trivial DoS via reconnection loops.
   */
  maxSseSessions?: number;
  /**
   * Maximum lifetime in milliseconds for a single SSE session. When reached
   * the server closes the connection and frees associated resources. Defaults
   * to 1 800 000 (30 minutes). Configurable via `ozBridge.mcpSseMaxLifetimeMs`.
   */
  sseMaxLifetimeMs?: number;
  /**
   * Origins accepted on the Streamable HTTP endpoint. The MCP spec requires
   * servers to validate `Origin` to block DNS rebinding: a web page cannot
   * read a loopback response, but it *can* fire a cross-origin POST at one,
   * and the browser attaches `Origin` when it does. Native MCP clients are
   * not browsers and send no `Origin` at all, so the default accepts a
   * missing header plus any loopback origin and answers everything else with
   * HTTP 403. Set this to widen the allow-list to exact origin strings.
   */
  allowedOrigins?: string[];
}

export interface McpServerInfo {
  name: string;
  version: string;
}

/**
 * Protocol-level capabilities returned by `initialize`. The server advertises
 * `tools` only in this release; `resources`, `prompts`, `logging` are not
 * implemented.
 */
const SERVER_CAPABILITIES = { tools: { listChanged: false } } as const;

/**
 * Protocol versions the server speaks. The newest client-supported version
 * wins during `initialize`.
 */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05'];

/**
 * Path of the Streamable HTTP endpoint. The legacy `GET /sse` +
 * `POST /messages` pair stays mounted alongside it.
 */
const MCP_ENDPOINT_PATH = '/mcp';

/**
 * Protocol version assumed for a Streamable HTTP POST that carries no
 * version anywhere. The `MCP-Protocol-Version` header only arrived in
 * `2025-06-18`; the spec lets a server that still serves older clients read
 * its absence as `2025-03-26`, which is what we do.
 */
const DEFAULT_NEGOTIATED_VERSION = '2025-03-26';

/** Freshness hint (ms) returned on `server/discover`. */
const DISCOVER_TTL_MS = 300_000;

// JSON-RPC and MCP error codes used by the Streamable HTTP endpoint.
const ERR_PARSE = -32700;
const ERR_INVALID_REQUEST = -32600;
const ERR_METHOD_NOT_FOUND = -32601;
/** MCP `HeaderMismatchError`: a mirrored header disagrees with the body. */
const ERR_HEADER_MISMATCH = -32020;
/** MCP `UnsupportedProtocolVersionError`: we do not speak that revision. */
const ERR_UNSUPPORTED_PROTOCOL_VERSION = -32022;

/** `_meta` key carrying a request's protocol version (MCP 2026-07-28). */
const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion';
/** `_meta` key a server identifies itself with in a result (MCP 2026-07-28). */
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

/**
 * RPC methods {@link McpServer.dispatch} implements. Used only to pick the
 * HTTP status for a `-32601` on the Streamable HTTP endpoint: the spec maps an
 * unimplemented *method* to HTTP 404, but `tools/call` naming a tool that does
 * not exist is a `-32601` on a method that *is* implemented, and answering
 * that with 404 would read as "this endpoint is gone". Keep in sync with the
 * `switch` in `dispatch`.
 */
const IMPLEMENTED_METHODS = new Set([
  'initialize',
  'server/discover',
  'ping',
  'tools/list',
  'tools/call',
]);

/**
 * Lightweight MCP JSON-RPC 2.0 server with HTTP + SSE transport.
 *
 * Transport layout:
 * - `POST /mcp`                       → Streamable HTTP: one JSON-RPC request
 *                                       per POST, answered in the same HTTP
 *                                       response. No session to open first.
 * - `GET  /sse`                       → opens a Server-Sent-Events stream
 *                                       that the server uses to push JSON-RPC
 *                                       responses and notifications.
 * - `POST /messages?sessionId=<uuid>` → single JSON-RPC request carried as
 *                                       the body; the response is dispatched
 *                                       over the matching SSE stream.
 * - `GET  /health`                    → `{ ok: true, tools: N }`.
 *
 * This is the transport historically adopted by Claude Desktop, Cursor and
 * Codex. The server is intentionally self-contained (no third-party deps)
 * so the extension keeps its zero-runtime-dependency promise.
 */
export class McpServer {
  private http: http.Server | undefined;
  private readonly sessions = new Map<string, http.ServerResponse>();
  /**
   * Per-session keep-alive / max-lifetime timer handles. Tracked separately
   * so {@link stop} can clear them deterministically even if `res.end()`
   * throws and the `'close'` event never fires.
   */
  // B-L2: only the per-session `maxLifetime` is tracked here; the keepalive
  // is a single shared interval (`globalKeepalive`) that fans out a `: keepalive`
  // line to every active SSE response, instead of one `setInterval` per session.
  private readonly sessionTimers = new Map<string, { maxLifetime: NodeJS.Timeout }>();
  private globalKeepalive?: NodeJS.Timeout;
  private readonly options: Required<Pick<McpServerOptions, 'port' | 'bindAddress' | 'maxSseSessions' | 'sseMaxLifetimeMs'>> & Pick<McpServerOptions, 'bearerToken' | 'allowedOrigins'>;

  constructor(
    private readonly tools: Map<string, McpToolEntry>,
    private readonly serverInfo: McpServerInfo = { name: 'oz-bridge', version: '0.6.0-dev' },
    options: McpServerOptions = {},
  ) {
    this.options = {
      port: options.port ?? 3847,
      bindAddress: options.bindAddress ?? '127.0.0.1',
      bearerToken: options.bearerToken,
      allowedOrigins: options.allowedOrigins,
      maxSseSessions: Math.max(1, options.maxSseSessions ?? 16),
      sseMaxLifetimeMs: options.sseMaxLifetimeMs ?? 1_800_000,
    };
  }

  /** Resolved listen address. Undefined until `start()` completes. */
  get endpoint(): { address: string; port: number } | undefined {
    if (!this.http) { return undefined; }
    const info = this.http.address();
    if (info && typeof info === 'object') {
      return { address: info.address, port: info.port };
    }
    return undefined;
  }

  /** Opens the socket and starts accepting connections. Idempotent. */
  async start(): Promise<void> {
    if (this.http) { return; }
    const server = http.createServer((req, res) => { this.handle(req, res); });
    this.http = server;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error): void => {
          server.off('error', onError);
          reject(err);
        };
        server.once('error', onError);
        server.listen(this.options.port, this.options.bindAddress, () => {
          server.off('error', onError);
          resolve();
        });
      });
    } catch (err) {
      // Reset state so a subsequent start() attempt is not silently a no-op.
      this.http = undefined;
      try { server.close(); } catch { /* ignore */ }
      throw err;
    }
  }

  /** Closes the socket and terminates any in-flight SSE streams. Idempotent. */
  async stop(): Promise<void> {
    if (!this.http) { return; }
    const server = this.http;
    this.http = undefined;
    // Clear every per-session timer first so that, even if `res.end()`
    // throws and the `'close'` event never fires, no stale timer keeps the
    // event loop alive.
    for (const timers of this.sessionTimers.values()) {
      clearTimeout(timers.maxLifetime);
    }
    this.sessionTimers.clear();
    if (this.globalKeepalive) {
      clearInterval(this.globalKeepalive);
      this.globalKeepalive = undefined;
    }
    for (const res of this.sessions.values()) {
      try { res.end(); } catch { /* ignore */ }
    }
    this.sessions.clear();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Force-close any lingering keep-alive sockets after the listener stops
      // accepting new connections. `closeAllConnections` was added in Node
      // 18.2; older runtimes rely on the `res.end()` calls above.
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }

  /**
   * Synchronously dispatches a single JSON-RPC request. Exposed for tests
   * and for a hypothetical stdio transport (out of scope for v0.6).
   */
  async dispatch(message: unknown): Promise<JsonRpcResponse | null> {
    if (!isJsonRpcRequest(message)) {
      return jsonRpcError(null, -32600, 'Invalid Request');
    }
    const id = message.id ?? null;
    try {
      switch (message.method) {
        case 'initialize': {
          // Safe extraction of protocol version from params
          const protocolVersion = extractProtocolVersion(message.params);
          return jsonRpcResult(id, {
            protocolVersion: pickProtocolVersion(protocolVersion),
            capabilities: SERVER_CAPABILITIES,
            serverInfo: this.serverInfo,
          });
        }
        case 'server/discover': {
          // MCP 2026-07-28 drops the `initialize` handshake in favour of this
          // RPC, and lets clients use it as a backward-compatibility probe to
          // learn which revisions a server actually speaks. Answering it on
          // every transport lets a stateless client negotiate down to a
          // version we implement instead of failing blind.
          // `supportedVersions` lists only what `dispatch` really honours, so
          // this never claims conformance we do not have.
          return jsonRpcResult(id, {
            resultType: 'complete',
            supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
            capabilities: SERVER_CAPABILITIES,
            ttlMs: DISCOVER_TTL_MS,
            cacheScope: 'public',
            _meta: { [META_SERVER_INFO]: this.serverInfo },
          });
        }
        case 'ping':
          return jsonRpcResult(id, {});
        case 'tools/list':
          return jsonRpcResult(id, {
            tools: Array.from(this.tools.values()).map((e) => e.descriptor),
          });
        case 'tools/call': {
          const toolParams = extractToolCallParams(message.params);
          if (!toolParams.name) {
            return jsonRpcError(id, -32602, 'Missing tool name');
          }
          const entry = this.tools.get(toolParams.name);
          if (!entry) {
            return jsonRpcError(id, -32601, `Unknown tool: ${toolParams.name}`);
          }
          const result = await entry.invoke(toolParams.arguments);
          return jsonRpcResult(id, result);
        }
        default:
          // Notifications (no id) yield null (no response body).
          if (id === null) { return null; }
          return jsonRpcError(id, -32601, `Unknown method: ${message.method}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonRpcError(id, -32603, `Internal error: ${msg}`);
    }
  }

  // ---------------------------------------------------------------------
  // HTTP dispatch
  // ---------------------------------------------------------------------

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

      // Bearer auth (if configured) is enforced before routing.
      if (this.options.bearerToken && !this.checkBearer(req)) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, {
          ok: true,
          name: this.serverInfo.name,
          version: this.serverInfo.version,
          tools: this.tools.size,
          sessions: this.sessions.size,
        });
        return;
      }

      if (url.pathname === MCP_ENDPOINT_PATH) {
        if (req.method === 'POST') {
          await this.handleStreamableHttp(req, res);
        } else {
          // 2026-07-28 removed both the GET endpoint (server-initiated
          // stream) and the DELETE one (session teardown), so this transport
          // is POST-only.
          res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'POST' });
          res.end(JSON.stringify(jsonRpcError(null, ERR_INVALID_REQUEST, 'The MCP endpoint accepts POST only')));
        }
        return;
      }

      if (req.method === 'GET' && url.pathname === '/sse') {
        this.openSseStream(req, res);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/messages') {
        const sessionId = url.searchParams.get('sessionId') ?? '';
        await this.handleMessage(req, res, sessionId);
        return;
      }

      sendJson(res, 404, { error: 'not_found' });
    } catch (err) {
      // The detail stays server-side. Echoing `err.message` back leaked
      // internals to an unauthenticated caller — absolute module paths,
      // dependency names and Node error codes all surface in thrown
      // messages (CodeQL js/stack-trace-exposure). stderr is the safe
      // channel: the standalone package speaks MCP over stdout, so
      // console.log there would corrupt the protocol frame.
      console.error('[oz-mcp] unhandled request error:', err);
      try { sendJson(res, 500, { error: 'internal' }); } catch { /* ignore */ }
    }
  }

  private checkBearer(req: http.IncomingMessage): boolean {
    const header = req.headers['authorization'];
    if (!header || Array.isArray(header)) { return false; }

    // Parsed without a regex on purpose. `/^Bearer\s+(.+)$/i` is ambiguous —
    // `\s+` and `.+` can both consume a space — so an `Authorization` header
    // of "Bearer" followed by N spaces makes the engine try every split point
    // and backtrack in O(N²) (CodeQL js/polynomial-redos). That runs *before*
    // authentication, on a header an unauthenticated caller fully controls,
    // and this file is also the core of the standalone MCP server package.
    // Scheme comparison + trimStart is linear and accepts exactly the same
    // inputs.
    const SCHEME = 'bearer';
    if (header.length <= SCHEME.length) { return false; }
    if (header.slice(0, SCHEME.length).toLowerCase() !== SCHEME) { return false; }

    const rest = header.slice(SCHEME.length);
    const token = rest.trimStart();
    // RFC 7235 requires at least one space between scheme and credentials
    // (`token === rest` means there was none), and an empty credential is
    // never valid.
    if (token === rest || token.length === 0) { return false; }

    return timingSafeEqual(token, this.options.bearerToken ?? '');
  }

  private openSseStream(_req: http.IncomingMessage, res: http.ServerResponse): void {
    // DoS guard: refuse new sessions once the configured cap is reached.
    // Prevents a misbehaving (or malicious) client from accumulating an
    // unbounded number of timers + sockets via reconnection loops.
    if (this.sessions.size >= this.options.maxSseSessions) {
      sendJson(res, 503, { error: 'too_many_sessions', max: this.options.maxSseSessions });
      return;
    }
    const sessionId = crypto.randomUUID();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // The first frame of an MCP SSE stream is an `endpoint` event telling
    // the client where to POST subsequent JSON-RPC messages.
    res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);
    this.sessions.set(sessionId, res);

    // Single shared keepalive interval (B-L2): start lazily on the first
    // session, stop in `cleanupSession` when the last session goes away.
    if (!this.globalKeepalive) {
      this.globalKeepalive = setInterval(() => {
        for (const stream of this.sessions.values()) {
          try { stream.write(': keepalive\n\n'); } catch { /* ignore */ }
        }
      }, 15_000);
    }

    // Add maximum lifetime timer to prevent indefinite keepalive
    // (configured via sseMaxLifetimeMs, default 30 minutes).
    // This prevents resource leaks if the client never properly closes the connection.
    const maxLifetime = setTimeout(() => {
      this.cleanupSession(sessionId);
      try { res.end(); } catch { /* ignore */ }
    }, this.options.sseMaxLifetimeMs);

    this.sessionTimers.set(sessionId, { maxLifetime });

    res.on('close', () => {
      this.cleanupSession(sessionId);
    });
  }

  private cleanupSession(sessionId: string): void {
    const timers = this.sessionTimers.get(sessionId);
    if (timers) {
      clearTimeout(timers.maxLifetime);
      this.sessionTimers.delete(sessionId);
    }
    this.sessions.delete(sessionId);
    // Stop the shared keepalive when no sessions remain.
    if (this.sessions.size === 0 && this.globalKeepalive) {
      clearInterval(this.globalKeepalive);
      this.globalKeepalive = undefined;
    }
  }

  /**
   * Streamable HTTP transport: one JSON-RPC request per `POST /mcp`, answered
   * in the same HTTP response. Unlike `/messages` there is no session to open
   * first and no SSE stream to correlate the answer against, which is exactly
   * what Streamable-HTTP-only clients expect. `dispatch()` keeps no
   * per-connection state, so a stateless client may skip `initialize`
   * entirely and go straight to `tools/list`.
   */
  private async handleStreamableHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.isOriginAllowed(req)) {
      sendJson(res, 403, jsonRpcError(null, ERR_INVALID_REQUEST, 'Origin not allowed'));
      return;
    }

    let raw: string;
    try {
      raw = await readBody(req);
    } catch {
      sendJson(res, 413, jsonRpcError(null, ERR_INVALID_REQUEST, 'Payload too large'));
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      sendJson(res, 400, jsonRpcError(null, ERR_PARSE, 'Parse error'));
      return;
    }

    if (Array.isArray(body)) {
      // JSON-RPC batching was removed from MCP in 2025-06-18 and this server
      // never implemented it. Saying so beats silently answering element 0.
      sendJson(res, 400, jsonRpcError(null, ERR_INVALID_REQUEST, 'JSON-RPC batches are not supported'));
      return;
    }
    if (!isJsonRpcRequest(body)) {
      sendJson(res, 400, jsonRpcError(null, ERR_INVALID_REQUEST, 'Invalid Request'));
      return;
    }

    const id = body.id ?? null;
    const mismatch = checkMirroredHeaders(req, body, id);
    if (mismatch) {
      sendJson(res, 400, mismatch);
      return;
    }

    const version = resolveRequestVersion(req, body);
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
      // Spec-mandated shape: 400 plus the list the client should pick from,
      // so a newer client can negotiate down rather than guess.
      sendJson(res, 400, jsonRpcError(
        id,
        ERR_UNSUPPORTED_PROTOCOL_VERSION,
        `Unsupported protocol version: ${version}`,
        { requested: version, supported: [...SUPPORTED_PROTOCOL_VERSIONS] },
      ));
      return;
    }

    const response = await this.dispatch(body);
    if (!response) {
      // A notification is acknowledged with 202 and an empty body.
      res.writeHead(202, { 'MCP-Protocol-Version': version }).end();
      return;
    }

    // An unimplemented method is reported as HTTP 404 carrying a JSON-RPC
    // error, which is how the spec lets a client tell "modern endpoint, no
    // such method" apart from "legacy server that hosts no /mcp endpoint at
    // all". A `-32601` raised *within* an implemented method — `tools/call`
    // for a tool that is not registered — stays a 200.
    const status = response.error?.code === ERR_METHOD_NOT_FOUND
      && !IMPLEMENTED_METHODS.has(body.method)
      ? 404
      : 200;

    if (prefersEventStream(req)) {
      res.writeHead(status, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'MCP-Protocol-Version': version,
      });
      res.end(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
      return;
    }

    res.writeHead(status, {
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': version,
    });
    res.end(JSON.stringify(response));
  }

  /** Origin allow-list check for the Streamable HTTP endpoint. */
  private isOriginAllowed(req: http.IncomingMessage): boolean {
    const origin = req.headers['origin'];
    // Native MCP clients are not browsers and send no Origin at all.
    if (origin === undefined) { return true; }
    if (Array.isArray(origin)) { return false; }
    if (this.options.allowedOrigins) {
      return this.options.allowedOrigins.includes(origin);
    }
    return isLoopbackOrigin(origin);
  }

  private async handleMessage(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string,
  ): Promise<void> {
    const stream = this.sessions.get(sessionId);
    if (!stream) {
      sendJson(res, 404, { error: 'unknown_session' });
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: 'invalid_json' });
      return;
    }
    // Ack the POST immediately so the client can fire-and-forget.
    res.writeHead(202).end();

    const response = await this.dispatch(body);
    if (response) {
      try {
        stream.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
      } catch { /* stream may have been closed; ignore */ }
    }
  }
}

// ===========================================================================
// JSON-RPC envelope helpers
// ===========================================================================

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  id?: number | string | null;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== 'object' || value === null) { return false; }
  const obj = value as Record<string, unknown>;
  return obj.jsonrpc === '2.0' && typeof obj.method === 'string';
}

function jsonRpcResult(id: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: number | string | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function pickProtocolVersion(requested: unknown): string {
  if (typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) {
    return requested;
  }
  return SUPPORTED_PROTOCOL_VERSIONS[0]!;
}

/**
 * Type-safe extraction of protocol version from initialize params.
 * Avoids unsafe 'as any' casts.
 */
function extractProtocolVersion(params: unknown): unknown {
  if (params && typeof params === 'object' && 'protocolVersion' in params) {
    return params.protocolVersion;
  }
  return undefined;
}

/**
 * Type-safe extraction of tool call parameters.
 * Returns name and arguments with proper validation.
 */
function extractToolCallParams(params: unknown): { name: string | undefined; arguments: Record<string, unknown> } {
  if (!params || typeof params !== 'object') {
    return { name: undefined, arguments: {} };
  }

  const name = 'name' in params && typeof params.name === 'string' ? params.name : undefined;
  let arguments_: Record<string, unknown> = {};

  if ('arguments' in params && params.arguments && typeof params.arguments === 'object'
      && !Array.isArray(params.arguments)) {
    // A-L15: arrays are typeof 'object' too — reject them so a malformed
    // request like `{"arguments": ["foo"]}` doesn't surface to tools as a
    // bogus `{0: "foo", length: 1}` Record.
    arguments_ = params.arguments as Record<string, unknown>;
  }

  return { name, arguments: arguments_ };
}

/**
 * `true` when `origin` names this machine. The server binds to loopback by
 * default, so a loopback origin is the only one a legitimate browser-based
 * client could present.
 */
function isLoopbackOrigin(origin: string): boolean {
  // "null" is the opaque origin a sandboxed iframe or a file:// page sends.
  if (origin === 'null') { return false; }
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false;
  }
  // `new URL` keeps an IPv6 host bracketed.
  const host = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (host === 'localhost' || host === '::1') { return true; }
  // The whole 127.0.0.0/8 block is loopback, not just 127.0.0.1.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/** Reads a header that may appear at most once. Node lowercases the names. */
function singleHeader(req: http.IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (value === undefined) { return undefined; }
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Effective protocol version for a Streamable HTTP request. `2026-07-28`
 * moved the version into `params._meta`, `2025-06-18` carried it in the
 * `MCP-Protocol-Version` header; either is read, and a request with neither
 * falls back to {@link DEFAULT_NEGOTIATED_VERSION}.
 */
function resolveRequestVersion(req: http.IncomingMessage, body: JsonRpcRequest): string {
  const header = singleHeader(req, 'mcp-protocol-version');
  if (header !== undefined) { return header; }
  const meta = extractMetaProtocolVersion(body.params);
  if (meta !== undefined) { return meta; }
  return DEFAULT_NEGOTIATED_VERSION;
}

/**
 * Validates the headers MCP 2026-07-28 mirrors from the JSON-RPC body
 * (`MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`). Returns a
 * `HeaderMismatchError` response when a header is present and disagrees with
 * the body, else `null`. An absent header is accepted: the headers are only
 * REQUIRED of `2026-07-28` clients, and this endpoint also serves the older
 * revisions that never sent them.
 */
function checkMirroredHeaders(
  req: http.IncomingMessage,
  body: JsonRpcRequest,
  id: number | string | null,
): JsonRpcResponse | null {
  const headerVersion = singleHeader(req, 'mcp-protocol-version');
  const metaVersion = extractMetaProtocolVersion(body.params);
  if (headerVersion !== undefined && metaVersion !== undefined && headerVersion !== metaVersion) {
    return jsonRpcError(id, ERR_HEADER_MISMATCH,
      `Header mismatch: MCP-Protocol-Version header value '${headerVersion}' does not match body value '${metaVersion}'`);
  }

  const headerMethod = singleHeader(req, 'mcp-method');
  if (headerMethod !== undefined && headerMethod !== body.method) {
    return jsonRpcError(id, ERR_HEADER_MISMATCH,
      `Header mismatch: Mcp-Method header value '${headerMethod}' does not match body value '${body.method}'`);
  }

  const headerName = singleHeader(req, 'mcp-name');
  if (headerName !== undefined) {
    const decoded = decodeHeaderValue(headerName);
    if (decoded === undefined) {
      return jsonRpcError(id, ERR_HEADER_MISMATCH, 'Header mismatch: Mcp-Name header value is malformed');
    }
    const expected = extractMirroredName(body.params);
    if (expected === undefined || decoded !== expected) {
      return jsonRpcError(id, ERR_HEADER_MISMATCH,
        `Header mismatch: Mcp-Name header value '${decoded}' does not match body value '${expected ?? ''}'`);
    }
  }

  return null;
}

/**
 * Decodes the `=?base64?<value>?=` sentinel MCP 2026-07-28 defines for header
 * values that cannot be expressed as plain ASCII. A plain value is returned
 * unchanged; `undefined` means the sentinel was malformed.
 */
function decodeHeaderValue(value: string): string | undefined {
  const PREFIX = '=?base64?';
  const SUFFIX = '?=';
  if (!value.startsWith(PREFIX) || !value.endsWith(SUFFIX)
      || value.length < PREFIX.length + SUFFIX.length) {
    return value;
  }
  const encoded = value.slice(PREFIX.length, value.length - SUFFIX.length);
  const decoded = Buffer.from(encoded, 'base64');
  // Node's base64 decoder silently drops junk, so round-trip to reject it.
  // Padding is normalized away before comparing.
  const strip = (v: string): string => v.replace(/=+$/, '');
  if (strip(decoded.toString('base64')) !== strip(encoded)) {
    return undefined;
  }
  return decoded.toString('utf8');
}

/**
 * The body field `Mcp-Name` mirrors: `params.name` for `tools/call` and
 * `prompts/get`, `params.uri` for `resources/read`.
 */
function extractMirroredName(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') { return undefined; }
  const obj = params as Record<string, unknown>;
  if (typeof obj.name === 'string') { return obj.name; }
  if (typeof obj.uri === 'string') { return obj.uri; }
  return undefined;
}

/** Reads `params._meta["io.modelcontextprotocol/protocolVersion"]`. */
function extractMetaProtocolVersion(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') { return undefined; }
  const meta = (params as Record<string, unknown>)._meta;
  if (!meta || typeof meta !== 'object') { return undefined; }
  const value = (meta as Record<string, unknown>)[META_PROTOCOL_VERSION];
  return typeof value === 'string' ? value : undefined;
}

/**
 * `true` only when the client offered `text/event-stream` and did *not* also
 * accept JSON. Streamable HTTP lets the server pick either framing, and a
 * single JSON object is the cheaper fit for this server's
 * one-request-one-response shape, so JSON wins whenever the client accepts
 * it — including the wildcard and missing-header cases.
 */
function prefersEventStream(req: http.IncomingMessage): boolean {
  const accept = singleHeader(req, 'accept');
  if (!accept) { return false; }
  const types = accept.split(',').map((t) => t.split(';')[0]!.trim().toLowerCase());
  if (types.some((t) => t === 'application/json' || t === 'application/*' || t === '*/*')) {
    return false;
  }
  return types.includes('text/event-stream');
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function readBody(req: http.IncomingMessage, maxBytes = 1_048_576): Promise<string> {
  // Bridge-input audit (v1.2): reject oversized payloads up front using
  // the declared Content-Length header before we start buffering. This
  // prevents an attacker from forcing the bridge to allocate up to
  // `maxBytes` of memory per request just to discover the body exceeds
  // the limit (the post-buffer check below remains as a defence in depth
  // for chunked / mis-declared lengths).
  const declaredLen = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
    req.resume(); // drain so the socket can be closed cleanly
    throw new Error('payload too large');
  }
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) {
        req.destroy();
        reject(new Error('payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Improved constant-time comparison for bearer tokens that doesn't leak
 * information about token length. Pads shorter buffer to match longer one.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');

  // Always perform constant-time comparison on same-length buffers
  const maxLen = Math.max(aBuf.length, bBuf.length);
  const aPadded = Buffer.alloc(maxLen);
  const bPadded = Buffer.alloc(maxLen);

  aBuf.copy(aPadded);
  bBuf.copy(bPadded);

  // Length check must also be done after comparison to maintain constant time
  const lengthMatch = aBuf.length === bBuf.length;
  const bufferMatch = crypto.timingSafeEqual(aPadded, bPadded);

  return lengthMatch && bufferMatch;
}
