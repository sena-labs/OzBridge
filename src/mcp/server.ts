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
 * Lightweight MCP JSON-RPC 2.0 server with HTTP + SSE transport.
 *
 * Transport layout:
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
  private readonly options: Required<Pick<McpServerOptions, 'port' | 'bindAddress'>> & Pick<McpServerOptions, 'bearerToken'>;

  constructor(
    private readonly tools: Map<string, McpToolEntry>,
    private readonly serverInfo: McpServerInfo = { name: 'oz-bridge', version: '0.6.0-dev' },
    options: McpServerOptions = {},
  ) {
    this.options = {
      port: options.port ?? 3847,
      bindAddress: options.bindAddress ?? '127.0.0.1',
      bearerToken: options.bearerToken,
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
    for (const res of this.sessions.values()) {
      try { res.end(); } catch { /* ignore */ }
    }
    this.sessions.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
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
      const msg = err instanceof Error ? err.message : String(err);
      try { sendJson(res, 500, { error: 'internal', message: msg }); } catch { /* ignore */ }
    }
  }

  private checkBearer(req: http.IncomingMessage): boolean {
    const header = req.headers['authorization'];
    if (!header || Array.isArray(header)) { return false; }
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) { return false; }
    return timingSafeEqual(match[1], this.options.bearerToken ?? '');
  }

  private openSseStream(_req: http.IncomingMessage, res: http.ServerResponse): void {
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

    const keepalive = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch { /* ignore */ }
    }, 15_000);

    // Add maximum lifetime timer to prevent indefinite keepalive (30 minutes)
    // This prevents resource leaks if the client never properly closes the connection
    const maxLifetime = setTimeout(() => {
      clearInterval(keepalive);
      this.sessions.delete(sessionId);
      try { res.end(); } catch { /* ignore */ }
    }, 1_800_000);

    res.on('close', () => {
      clearInterval(keepalive);
      clearTimeout(maxLifetime);
      this.sessions.delete(sessionId);
    });
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
  return (
    typeof value === 'object' && value !== null &&
    (value as any).jsonrpc === '2.0' &&
    typeof (value as any).method === 'string'
  );
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
  return SUPPORTED_PROTOCOL_VERSIONS[0];
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

  if ('arguments' in params && params.arguments && typeof params.arguments === 'object') {
    arguments_ = params.arguments as Record<string, unknown>;
  }

  return { name, arguments: arguments_ };
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function readBody(req: http.IncomingMessage, maxBytes = 1_048_576): Promise<string> {
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
