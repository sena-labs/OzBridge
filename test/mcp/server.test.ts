import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import { McpServer } from '../../src/mcp/server.js';
import type { McpToolEntry } from '../../src/mcp/tools.js';

function makeRegistry(): Map<string, McpToolEntry> {
  return new Map<string, McpToolEntry>([
    [
      'echo_tool',
      {
        descriptor: {
          name: 'echo_tool',
          description: 'Echoes the prompt back for tests.',
          inputSchema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string' } } },
        },
        invoke: async (input) => {
          if (typeof input.prompt !== 'string') {
            return { content: [{ type: 'text', text: 'missing prompt' }], isError: true };
          }
          return { content: [{ type: 'text', text: `echo:${input.prompt}` }] };
        },
      },
    ],
  ]);
}

// ---------------------------------------------------------------------------
// Dispatcher tests (no socket)
// ---------------------------------------------------------------------------

describe('McpServer.dispatch', () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer(makeRegistry());
  });

  it('handles initialize and returns serverInfo + capabilities', async () => {
    const resp = await server.dispatch({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26' },
    });
    expect(resp?.error).toBeUndefined();
    const result = resp?.result as any;
    expect(result.protocolVersion).toBe('2025-03-26');
    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo.name).toBe('oz-bridge');
  });

  it('falls back to latest protocol version when client asks an unknown one', async () => {
    const resp = await server.dispatch({
      jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1900-01-01' },
    });
    expect((resp?.result as any).protocolVersion).toBe('2025-03-26');
  });

  it('tools/list returns registered tool descriptors', async () => {
    const resp = await server.dispatch({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const tools = (resp?.result as any).tools as Array<{ name: string }>;
    expect(tools.map((t) => t.name)).toEqual(['echo_tool']);
  });

  it('tools/call dispatches the right handler and returns its content', async () => {
    const resp = await server.dispatch({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'echo_tool', arguments: { prompt: 'hi' } },
    });
    const result = resp?.result as any;
    expect(result.content[0].text).toBe('echo:hi');
  });

  it('tools/call returns -32601 for unknown tool names', async () => {
    const resp = await server.dispatch({
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'does_not_exist', arguments: {} },
    });
    expect(resp?.error?.code).toBe(-32601);
    expect(resp?.error?.message).toContain('Unknown tool');
  });

  it('rejects malformed requests with -32600 Invalid Request', async () => {
    const resp = await server.dispatch({ foo: 'bar' });
    expect(resp?.error?.code).toBe(-32600);
  });

  it('ping returns {}', async () => {
    const resp = await server.dispatch({ jsonrpc: '2.0', id: 6, method: 'ping' });
    expect(resp?.result).toEqual({});
  });

  it('notifications (no id) for unknown methods yield null', async () => {
    const resp = await server.dispatch({ jsonrpc: '2.0', method: 'some/notification' });
    expect(resp).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Shared HTTP helpers
// ---------------------------------------------------------------------------

async function fetchJson(port: number, pathname: string, headers: Record<string, string> = {}) {
    const response: string = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: pathname, method: 'GET', headers },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            resolve(JSON.stringify({
              status: res.statusCode,
              body: Buffer.concat(chunks).toString('utf8'),
            }));
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
    const parsed = JSON.parse(response);
    return {
      status: parsed.status as number,
      body: parsed.body ? JSON.parse(parsed.body) : undefined,
    };
}

// ---------------------------------------------------------------------------
// HTTP + SSE integration
// ---------------------------------------------------------------------------

describe('McpServer HTTP transport', () => {
  let server: McpServer;

  afterEach(async () => {
    await server?.stop();
  });

  it('GET /health returns server info and tool count', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0 });
    await server.start();
    const port = server.endpoint!.port;
    const { status, body } = await fetchJson(port, '/health');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.tools).toBe(1);
  });

  it('listens on 127.0.0.1 by default', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0 });
    await server.start();
    expect(server.endpoint?.address).toBe('127.0.0.1');
    expect(server.endpoint?.port).toBeGreaterThan(0);
  });

  it('rejects requests missing Authorization when bearerToken is set', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0, bearerToken: 'secret123' });
    await server.start();
    const port = server.endpoint!.port;
    const { status, body } = await fetchJson(port, '/health');
    expect(status).toBe(401);
    expect(body.error).toBe('unauthorized');
  });

  it('accepts requests with the right bearer token', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0, bearerToken: 'secret123' });
    await server.start();
    const port = server.endpoint!.port;
    const { status, body } = await fetchJson(port, '/health', { Authorization: 'Bearer secret123' });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  // The Authorization parser was rewritten off `/^Bearer\s+(.+)$/i`, whose
  // `\s+`/`.+` overlap backtracked in O(n²) on a padded header supplied by
  // an unauthenticated caller. ReDoS is now prevented by construction — no
  // ambiguous regex is left to backtrack — so these tests pin the accepted
  // and rejected shapes instead of asserting a wall-clock bound, which
  // would be flaky in CI and would not have failed on the old code anyway.
  it('accepts a bearer token separated by extra whitespace', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0, bearerToken: 'secret123' });
    await server.start();
    const port = server.endpoint!.port;
    const { status } = await fetchJson(port, '/health', { Authorization: 'Bearer \t  secret123' });
    expect(status).toBe(200);
  });

  it('matches the bearer scheme case-insensitively', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0, bearerToken: 'secret123' });
    await server.start();
    const port = server.endpoint!.port;
    const { status } = await fetchJson(port, '/health', { Authorization: 'bEaReR secret123' });
    expect(status).toBe(200);
  });

  it('rejects a bearer header with no credential, however padded', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0, bearerToken: 'secret123' });
    await server.start();
    const port = server.endpoint!.port;
    for (const header of ['Bearer', 'Bearer ', `Bearer${' '.repeat(4096)}`]) {
      const { status, body } = await fetchJson(port, '/health', { Authorization: header });
      expect(status).toBe(401);
      expect(body.error).toBe('unauthorized');
    }
  });

  it('rejects a bearer header with no separator before the credential', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0, bearerToken: 'secret123' });
    await server.start();
    const port = server.endpoint!.port;
    const { status } = await fetchJson(port, '/health', { Authorization: 'Bearersecret123' });
    expect(status).toBe(401);
  });

  it('404s for unknown routes', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0 });
    await server.start();
    const port = server.endpoint!.port;
    const { status, body } = await fetchJson(port, '/nope');
    expect(status).toBe(404);
    expect(body.error).toBe('not_found');
  });

  it('stop() is idempotent', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0 });
    await server.start();
    await server.stop();
    await server.stop(); // second call must not throw
  });

  it('calls close before force-closing the connections', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0 });
    await server.start();
    const nodeServer = (server as unknown as { http: http.Server }).http;
    const events: string[] = [];
    const originalClose = nodeServer.close.bind(nodeServer);
    const originalCloseAllConnections = nodeServer.closeAllConnections?.bind(nodeServer);

    nodeServer.close = ((callback?: (err?: Error) => void) => {
      events.push('close');
      return originalClose(callback);
    }) as http.Server['close'];
    nodeServer.closeAllConnections = () => {
      events.push('closeAllConnections');
      originalCloseAllConnections?.();
    };

    await server.stop();

    expect(events).toEqual(['close', 'closeAllConnections']);
  });
});

// ---------------------------------------------------------------------------
// SSE session caps and lifetime enforcement
// ---------------------------------------------------------------------------

describe('McpServer SSE — session caps and lifetime', () => {
  let server: McpServer;

  afterEach(async () => {
    await server?.stop();
  });

  /**
   * Opens a GET /sse connection and resolves once the `endpoint` event is
   * received (session fully established server-side).
   */
  function openSseConnection(port: number, timeoutMs = 5_000): Promise<{
    close: () => void;
    onClosed: Promise<void>;
  }> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const rejectOnce = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        req.destroy();
        reject(err);
      };

      const connectTimer = setTimeout(() => {
        rejectOnce(
          new Error(`openSseConnection: timed out after ${timeoutMs} ms waiting for endpoint event`),
        );
      }, timeoutMs);

      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/sse',
          method: 'GET',
          headers: { Accept: 'text/event-stream' },
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            rejectOnce(new Error(`/sse → ${res.statusCode}`));
            return;
          }
          let closedResolve!: () => void;
          const onClosed = new Promise<void>((r) => { closedResolve = r; });
          res.on('close', () => closedResolve());
          res.on('end',   () => closedResolve());
          let buffer = '';

          const processBuffer = () => {
            while (!settled) {
              const crlfIndex = buffer.indexOf('\r\n\r\n');
              const lfIndex = buffer.indexOf('\n\n');
              let frameEnd = -1;
              let separatorLength = 0;

              if (crlfIndex !== -1 && (lfIndex === -1 || crlfIndex < lfIndex)) {
                frameEnd = crlfIndex;
                separatorLength = 4;
              } else if (lfIndex !== -1) {
                frameEnd = lfIndex;
                separatorLength = 2;
              }

              if (frameEnd === -1) {
                return;
              }

              const frame = buffer.slice(0, frameEnd);
              buffer = buffer.slice(frameEnd + separatorLength);

              const eventName = frame
                .split(/\r?\n/)
                .find((line) => line.startsWith('event:'))
                ?.slice('event:'.length)
                .trim();

              if (eventName === 'endpoint') {
                settled = true;
                clearTimeout(connectTimer);
                resolve({ close: () => req.destroy(), onClosed });
              }
            }
          };

          res.on('data', (chunk: Buffer) => {
            if (settled) {
              return;
            }
            buffer += chunk.toString('utf8');
            processBuffer();
          });
          res.on('end', () => {
            if (!settled) {
              rejectOnce(new Error('SSE stream ended before endpoint event was received'));
            }
          });
          res.on('close', () => {
            if (!settled) {
              rejectOnce(new Error('SSE stream closed before endpoint event was received'));
            }
          });
        },
      );
      req.on('error', (err) => rejectOnce(err));
      req.end();
    });
  }

  it('rejects new SSE connections with 503 when maxSseSessions is reached', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0, maxSseSessions: 2 });
    await server.start();
    const port = server.endpoint!.port;

    const s1 = await openSseConnection(port);
    const s2 = await openSseConnection(port);

    // Third connection must be refused with 503
    const result = await new Promise<{ status: number; body: Record<string, unknown> }>(
      (resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port, path: '/sse', method: 'GET' },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () =>
              resolve({
                status: res.statusCode!,
                body: JSON.parse(
                  Buffer.concat(chunks).toString('utf8'),
                ) as Record<string, unknown>,
              }),
            );
          },
        );
        req.on('error', reject);
        req.end();
      },
    );

    expect(result.status).toBe(503);
    expect(result.body['error']).toBe('too_many_sessions');
    expect(result.body['max']).toBe(2);

    s1.close();
    s2.close();
    await Promise.all([s1.onClosed, s2.onClosed]);
  });

  it('closes SSE connection server-side after sseMaxLifetimeMs elapses', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0, sseMaxLifetimeMs: 80 });
    await server.start();
    const port = server.endpoint!.port;

    const { onClosed } = await openSseConnection(port);

    // Wait up to 600 ms for the server to close the session (80 ms timeout + buffer)
    const outcome = await Promise.race([
      onClosed.then(() => 'closed' as const),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 600)),
    ]);
    expect(outcome).toBe('closed');

    // /health must report 0 active sessions once cleanup completes
    const { body } = await fetchJson(port, '/health');
    expect((body as Record<string, unknown>)['sessions']).toBe(0);
  });

  it('stop() closes active SSE streams and clears lifetime timers', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0, sseMaxLifetimeMs: 5_000 });
    await server.start();
    const port = server.endpoint!.port;

    const { onClosed } = await openSseConnection(port);

    // Stop the server while the max-lifetime timer (5 s) is still armed
    await server.stop();

    // The stream must be closed by stop() without waiting for the 5 s timer
    const outcome = await Promise.race([
      onClosed.then(() => 'closed' as const),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 500)),
    ]);
    expect(outcome).toBe('closed');
  });
});

// ---------------------------------------------------------------------------
// Streamable HTTP transport (POST /mcp)
// ---------------------------------------------------------------------------

interface PostResult {
  status: number;
  headers: Record<string, string>;
  raw: string;
}

/** POSTs a raw body to `/mcp` and returns status, headers and the raw body. */
function postMcp(
  port: number,
  payload: string,
  headers: Record<string, string> = {},
  pathname = '/mcp',
  method = 'POST',
): Promise<PostResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode!,
          headers: res.headers as Record<string, string>,
          raw: Buffer.concat(chunks).toString('utf8'),
        }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

/** Same as {@link postMcp} but parses the body as a JSON-RPC response. */
async function rpc(
  port: number,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Record<string, string>; body: any }> {
  const res = await postMcp(port, JSON.stringify(body), headers);
  return { status: res.status, headers: res.headers, body: res.raw ? JSON.parse(res.raw) : undefined };
}

/** The per-request `_meta` a `2026-07-28` request MUST carry (basic §_meta). */
function modernMeta(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientInfo': { name: 'vitest', version: '1.0.0' },
    'io.modelcontextprotocol/clientCapabilities': {},
    ...extra,
  };
}

/** The standard request headers a `2026-07-28` POST MUST carry. */
function modernHeaders(method: string, name?: string): Record<string, string> {
  return {
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2026-07-28',
    'Mcp-Method': method,
    ...(name !== undefined ? { 'Mcp-Name': name } : {}),
  };
}

/** A well-formed `2026-07-28` request over `/mcp`. */
function modernRpc(
  port: number,
  id: number,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const name = typeof params.name === 'string' ? params.name : undefined;
  return rpc(
    port,
    { jsonrpc: '2.0', id, method, params: { ...params, _meta: modernMeta() } },
    { ...modernHeaders(method, name), ...headers },
  );
}

/** Splits an SSE body into the JSON payloads of its `data:` lines. */
function sseMessages(raw: string): any[] {
  return raw
    .split(/\r?\n\r?\n/)
    .map((frame) => frame.split(/\r?\n/).find((line) => line.startsWith('data: ')))
    .filter((line): line is string => line !== undefined)
    .map((line) => JSON.parse(line.slice('data: '.length)));
}

describe('McpServer.dispatch — server/discover', () => {
  it('advertises only the protocol versions the server really implements', async () => {
    const server = new McpServer(makeRegistry());
    const resp = await server.dispatch({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} });
    const result = resp?.result as any;
    expect(resp?.error).toBeUndefined();
    expect(result.supportedVersions).toEqual(['2026-07-28', '2025-03-26', '2024-11-05']);
    expect(result.capabilities.tools).toBeDefined();
    expect(result.resultType).toBe('complete');
    expect(typeof result.ttlMs).toBe('number');
    expect(result.cacheScope).toBe('public');
    expect(result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('oz-bridge');
  });
});

describe('McpServer Streamable HTTP — POST /mcp', () => {
  let server: McpServer;
  let port: number;

  beforeEach(async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0 });
    await server.start();
    port = server.endpoint!.port;
  });

  afterEach(async () => {
    await server?.stop();
  });

  it('lists tools without any prior initialize or session (stateless client)', async () => {
    const { status, headers, body } = await rpc(port, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(status).toBe(200);
    expect(headers['content-type']).toContain('application/json');
    expect(body.result.tools.map((t: any) => t.name)).toEqual(['echo_tool']);
  });

  it('calls a tool and returns its content in the same HTTP response', async () => {
    const { status, body } = await rpc(port, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'echo_tool', arguments: { prompt: 'hi' } },
    });
    expect(status).toBe(200);
    expect(body.result.content[0].text).toBe('echo:hi');
  });

  it('answers with JSON when the client accepts both JSON and event-stream', async () => {
    const { headers, body } = await rpc(
      port,
      { jsonrpc: '2.0', id: 3, method: 'tools/list' },
      { Accept: 'application/json, text/event-stream' },
    );
    expect(headers['content-type']).toContain('application/json');
    expect(body.result.tools).toHaveLength(1);
  });

  it('frames the answer as SSE when the client accepts only event-stream', async () => {
    const res = await postMcp(
      port,
      JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/list' }),
      { Accept: 'text/event-stream' },
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.raw.startsWith('event: message\ndata: ')).toBe(true);
    const payload = JSON.parse(res.raw.slice('event: message\ndata: '.length).trim());
    expect(payload.result.tools).toHaveLength(1);
  });

  it('echoes the negotiated protocol version on the response', async () => {
    const { headers } = await rpc(port, { jsonrpc: '2.0', id: 5, method: 'tools/list' });
    expect(headers['mcp-protocol-version']).toBe('2025-03-26');
  });

  it('acknowledges a notification with 202 and an empty body', async () => {
    const res = await postMcp(port, JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    expect(res.status).toBe(202);
    expect(res.raw).toBe('');
  });

  it('reports an unknown method as HTTP 404 carrying a JSON-RPC -32601', async () => {
    const { status, body } = await rpc(port, { jsonrpc: '2.0', id: 6, method: 'does/notExist' });
    expect(status).toBe(404);
    expect(body.error.code).toBe(-32601);
  });

  it('rejects a malformed JSON body with -32700', async () => {
    const res = await postMcp(port, '{not json');
    expect(res.status).toBe(400);
    expect(JSON.parse(res.raw).error.code).toBe(-32700);
  });

  it('rejects a JSON-RPC batch with -32600', async () => {
    const res = await postMcp(port, JSON.stringify([{ jsonrpc: '2.0', id: 7, method: 'tools/list' }]));
    expect(res.status).toBe(400);
    expect(JSON.parse(res.raw).error.code).toBe(-32600);
  });

  it('accepts POST only — GET and DELETE get 405 with an Allow header', async () => {
    for (const method of ['GET', 'DELETE']) {
      const res = await postMcp(port, '', {}, '/mcp', method);
      expect(res.status).toBe(405);
      expect(res.headers['allow']).toBe('POST');
    }
  });

  it('enforces the bearer token on /mcp when one is configured', async () => {
    await server.stop();
    server = new McpServer(makeRegistry(), undefined, { port: 0, bearerToken: 'secret123' });
    await server.start();
    port = server.endpoint!.port;

    const denied = await rpc(port, { jsonrpc: '2.0', id: 8, method: 'tools/list' });
    expect(denied.status).toBe(401);

    const allowed = await rpc(
      port,
      { jsonrpc: '2.0', id: 9, method: 'tools/list' },
      { Authorization: 'Bearer secret123' },
    );
    expect(allowed.status).toBe(200);
    expect(allowed.body.result.tools).toHaveLength(1);
  });
});

describe('McpServer Streamable HTTP — protocol version negotiation', () => {
  let server: McpServer;
  let port: number;

  beforeEach(async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0 });
    await server.start();
    port = server.endpoint!.port;
  });

  afterEach(async () => {
    await server?.stop();
  });

  it('accepts a supported version in the MCP-Protocol-Version header', async () => {
    const { status, headers } = await rpc(
      port,
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { 'MCP-Protocol-Version': '2024-11-05' },
    );
    expect(status).toBe(200);
    expect(headers['mcp-protocol-version']).toBe('2024-11-05');
  });

  it('rejects an unimplemented version with -32022 and the supported list', async () => {
    const { status, body } = await rpc(
      port,
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { 'MCP-Protocol-Version': '2099-01-01' },
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe(-32022);
    expect(body.error.data.requested).toBe('2099-01-01');
    expect(body.error.data.supported).toEqual(['2026-07-28', '2025-03-26', '2024-11-05']);
  });

  it('reads the version out of params._meta when no header is sent', async () => {
    const { status, body } = await rpc(port, {
      jsonrpc: '2.0', id: 3, method: 'tools/list',
      params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } },
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe(-32022);
  });

  it('flags a header that disagrees with params._meta as -32020', async () => {
    const { status, body } = await rpc(
      port,
      {
        jsonrpc: '2.0', id: 4, method: 'tools/list',
        params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2024-11-05' } },
      },
      { 'MCP-Protocol-Version': '2025-03-26' },
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe(-32020);
  });
});

describe('McpServer Streamable HTTP — mirrored request headers', () => {
  let server: McpServer;
  let port: number;

  beforeEach(async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0 });
    await server.start();
    port = server.endpoint!.port;
  });

  afterEach(async () => {
    await server?.stop();
  });

  const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo_tool', arguments: { prompt: 'x' } } };

  it('accepts Mcp-Method and Mcp-Name that match the body', async () => {
    const { status, body } = await rpc(port, call, { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'echo_tool' });
    expect(status).toBe(200);
    expect(body.result.content[0].text).toBe('echo:x');
  });

  it('rejects an Mcp-Method that disagrees with the body', async () => {
    const { status, body } = await rpc(port, call, { 'Mcp-Method': 'tools/list' });
    expect(status).toBe(400);
    expect(body.error.code).toBe(-32020);
    expect(body.error.message).toContain('Mcp-Method');
  });

  it('rejects an Mcp-Name that disagrees with the body', async () => {
    const { status, body } = await rpc(port, call, { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'other_tool' });
    expect(status).toBe(400);
    expect(body.error.code).toBe(-32020);
    expect(body.error.message).toContain('Mcp-Name');
  });

  it('decodes the =?base64?…?= sentinel before comparing Mcp-Name', async () => {
    const encoded = `=?base64?${Buffer.from('echo_tool', 'utf8').toString('base64')}?=`;
    const { status, body } = await rpc(port, call, { 'Mcp-Method': 'tools/call', 'Mcp-Name': encoded });
    expect(status).toBe(200);
    expect(body.result.content[0].text).toBe('echo:x');
  });

  it('works unchanged when a pre-2026 client sends no mirrored headers', async () => {
    const { status, body } = await rpc(port, call);
    expect(status).toBe(200);
    expect(body.result.content[0].text).toBe('echo:x');
  });
});

describe('McpServer Streamable HTTP — Origin validation', () => {
  let server: McpServer;

  afterEach(async () => {
    await server?.stop();
  });

  const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

  it('accepts a request with no Origin (native MCP clients send none)', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0 });
    await server.start();
    const { status } = await rpc(server.endpoint!.port, list);
    expect(status).toBe(200);
  });

  it('accepts loopback origins', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0 });
    await server.start();
    const p = server.endpoint!.port;
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.1.2.3:80', 'http://[::1]:8080']) {
      const { status } = await rpc(p, list, { Origin: origin });
      expect(status, origin).toBe(200);
    }
  });

  it('rejects a foreign origin with 403 (DNS-rebinding guard)', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0 });
    await server.start();
    const p = server.endpoint!.port;
    for (const origin of ['https://evil.example', 'http://localhost.evil.example', 'null']) {
      const { status } = await rpc(p, list, { Origin: origin });
      expect(status, origin).toBe(403);
    }
  });

  it('honours an explicit allowedOrigins list', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0, allowedOrigins: ['https://trusted.example'] });
    await server.start();
    const p = server.endpoint!.port;
    expect((await rpc(p, list, { Origin: 'https://trusted.example' })).status).toBe(200);
    // An explicit list replaces the loopback default rather than extending it.
    expect((await rpc(p, list, { Origin: 'http://127.0.0.1:3000' })).status).toBe(403);
  });
});

describe('McpServer Streamable HTTP — -32601 status mapping', () => {
  let server: McpServer;
  let port: number;

  beforeEach(async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0 });
    await server.start();
    port = server.endpoint!.port;
  });

  afterEach(async () => {
    await server?.stop();
  });

  it('maps an unimplemented RPC method to HTTP 404', async () => {
    const { status, body } = await rpc(port, { jsonrpc: '2.0', id: 1, method: 'resources/list' });
    expect(status).toBe(404);
    expect(body.error.code).toBe(-32601);
  });

  it('keeps an unknown tool on HTTP 200 — tools/call is implemented', async () => {
    const { status, body } = await rpc(port, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'does_not_exist', arguments: {} },
    });
    expect(status).toBe(200);
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toContain('Unknown tool');
  });
});

describe('McpServer Streamable HTTP — Mcp-Name decoding is linear', () => {
  let server: McpServer;
  let port: number;

  beforeEach(async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0 });
    await server.start();
    port = server.endpoint!.port;
  });

  afterEach(async () => {
    await server?.stop();
  });

  const call = {
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'echo_tool', arguments: { prompt: 'x' } },
  };

  // The padding strip was rewritten off `/=+$/`, whose `=+`/anchor overlap
  // backtracked in O(n²) on a header an unauthenticated caller controls.
  // Quadratic blow-up is prevented by construction, so this pins the accepted
  // and rejected shapes rather than asserting a wall-clock bound (which would
  // be flaky in CI and would not have failed on the old code anyway).
  it('rejects a padding-heavy sentinel instead of chewing on it', async () => {
    const pathological = `=?base64?${'='.repeat(8000)}x?=`;
    const { status, body } = await rpc(port, call, { 'Mcp-Name': pathological });
    expect(status).toBe(400);
    expect(body.error.code).toBe(-32020);
  });

  it('still decodes a sentinel that carries real = padding', async () => {
    // "echo_tool" is 9 bytes, a clean multiple of 3, so its base64 has no
    // padding at all. A 4-byte name does, so use one to exercise the strip:
    // the header then matches the body, validation passes, and the request
    // reaches dispatch — which reports the tool as unknown with HTTP 200.
    // A decoding failure would instead surface as 400 + -32020.
    const encoded = Buffer.from('nope', 'utf8').toString('base64');
    expect(encoded.endsWith('=')).toBe(true);
    const { status, body } = await rpc(
      port,
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nope', arguments: {} } },
      { 'Mcp-Method': 'tools/call', 'Mcp-Name': `=?base64?${encoded}?=` },
    );
    expect(status).toBe(200);
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toContain('Unknown tool');
  });
});

describe('McpServer Streamable HTTP — review follow-ups', () => {
  let server: McpServer;
  let port: number;

  beforeEach(async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0 });
    await server.start();
    port = server.endpoint!.port;
  });

  afterEach(async () => {
    await server?.stop();
  });

  // server/discover is the version-negotiation probe. On a revision the
  // server does not implement, 2026-07-28 (basic/versioning) requires the
  // UnsupportedProtocolVersionError — whose `supported` list is exactly what
  // the probe is after, and which a dual-era client reads as "modern server".
  it('answers server/discover on an unsupported version with -32022 and the supported list', async () => {
    const { status, body } = await rpc(
      port,
      { jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} },
      { 'MCP-Protocol-Version': '2099-01-01' },
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe(-32022);
    expect(body.error.data.supported).toEqual(['2026-07-28', '2025-03-26', '2024-11-05']);
  });

  it('answers server/discover when the version arrives via params._meta', async () => {
    const { status, body, headers } = await rpc(
      port,
      { jsonrpc: '2.0', id: 2, method: 'server/discover', params: { _meta: modernMeta() } },
      modernHeaders('server/discover'),
    );
    expect(status).toBe(200);
    expect(body.result.supportedVersions).toContain('2025-03-26');
    expect(headers['mcp-protocol-version']).toBe('2026-07-28');
  });

  it('still rejects an unsupported version on every other method', async () => {
    const { status, body } = await rpc(
      port,
      { jsonrpc: '2.0', id: 3, method: 'tools/list' },
      { 'MCP-Protocol-Version': '2099-01-01' },
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe(-32022);
  });

  // A request with no `id` is a notification: it must draw a bare 202, even
  // when the method is implemented and dispatch() produced a result.
  it('acknowledges a notification on an implemented method with a bare 202', async () => {
    for (const method of ['ping', 'tools/list']) {
      const res = await postMcp(port, JSON.stringify({ jsonrpc: '2.0', method }));
      expect(res.status, method).toBe(202);
      expect(res.raw, method).toBe('');
    }
  });

  it('still answers the same method normally when an id is present', async () => {
    const { status, body } = await rpc(port, { jsonrpc: '2.0', id: 4, method: 'ping' });
    expect(status).toBe(200);
    expect(body.result).toEqual({});
  });

  it('runs a notification\'s side effect even though nothing is returned', async () => {
    let called = 0;
    const registry = makeRegistry();
    registry.set('counter', {
      descriptor: { name: 'counter', description: 'counts', inputSchema: { type: 'object' } },
      invoke: async () => { called += 1; return { content: [{ type: 'text', text: 'ok' }] }; },
    });
    await server.stop();
    server = new McpServer(registry, undefined, { port: 0 });
    await server.start();
    port = server.endpoint!.port;

    const res = await postMcp(port, JSON.stringify({
      jsonrpc: '2.0', method: 'tools/call', params: { name: 'counter', arguments: {} },
    }));
    expect(res.status).toBe(202);
    expect(res.raw).toBe('');
    expect(called).toBe(1);
  });

  // RFC 9110: `q=0` marks a media type as NOT acceptable.
  it('treats application/json;q=0 as a refusal and frames the answer as SSE', async () => {
    const res = await postMcp(
      port,
      JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/list' }),
      { Accept: 'application/json;q=0, text/event-stream' },
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
  });

  it('treats text/event-stream;q=0 as a refusal and answers in JSON', async () => {
    const { status, headers } = await rpc(
      port,
      { jsonrpc: '2.0', id: 6, method: 'tools/list' },
      { Accept: 'text/event-stream;q=0, application/json' },
    );
    expect(status).toBe(200);
    expect(headers['content-type']).toContain('application/json');
  });

  it('keeps a non-zero q on text/event-stream as a genuine offer', async () => {
    const res = await postMcp(
      port,
      JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' }),
      { Accept: 'text/event-stream;q=0.9' },
    );
    expect(res.headers['content-type']).toContain('text/event-stream');
  });

  it('honours a text/* offer as event-stream when JSON is not on the list', async () => {
    const res = await postMcp(
      port,
      JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/list' }),
      { Accept: 'text/*' },
    );
    expect(res.headers['content-type']).toContain('text/event-stream');
  });
});

// ---------------------------------------------------------------------------
// MCP 2026-07-28 — version-gated conformance
// ---------------------------------------------------------------------------

describe('McpServer.dispatch — older revisions stay byte-identical', () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer(makeRegistry());
  });

  it('returns tools/list without resultType or caching hints when no 2026-07-28 version is declared', async () => {
    const resp = await server.dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(resp?.result).toEqual({ tools: [makeRegistry().get('echo_tool')!.descriptor] });
  });

  it('returns the tool result unchanged on tools/call for an older revision', async () => {
    const resp = await server.dispatch({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'echo_tool', arguments: { prompt: 'hi' } },
    });
    expect(resp?.result).toEqual({ content: [{ type: 'text', text: 'echo:hi' }] });
  });

  it('keeps answering a 2025-03-26 request declared in _meta exactly like a bare one', async () => {
    const resp = await server.dispatch({
      jsonrpc: '2.0', id: 3, method: 'ping',
      params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2025-03-26' } },
    });
    expect(resp?.result).toEqual({});
  });

  it('never negotiates 2026-07-28 through initialize — that revision has no handshake', async () => {
    const resp = await server.dispatch({
      jsonrpc: '2.0', id: 4, method: 'initialize', params: { protocolVersion: '2026-07-28' },
    });
    expect((resp?.result as any).protocolVersion).toBe('2025-03-26');
  });

  it('still treats subscriptions/listen as an unknown method on an older revision', async () => {
    const resp = await server.dispatch({ jsonrpc: '2.0', id: 5, method: 'subscriptions/listen', params: {} });
    expect(resp?.error?.code).toBe(-32601);
  });
});

describe('McpServer.dispatch — 2026-07-28 requests', () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer(makeRegistry());
  });

  const modern = (id: number, method: string, params: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) =>
    server.dispatch({ jsonrpc: '2.0', id, method, params: { ...params, _meta: modernMeta(meta) } });

  it('marks tools/list complete and attaches ttlMs, cacheScope and serverInfo', async () => {
    const result = (await modern(1, 'tools/list'))?.result as any;
    expect(result.resultType).toBe('complete');
    expect(result.tools.map((t: any) => t.name)).toEqual(['echo_tool']);
    expect(Number.isInteger(result.ttlMs) && result.ttlMs >= 0).toBe(true);
    expect(result.cacheScope).toBe('public');
    expect(result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('oz-bridge');
  });

  it('marks tools/call complete without caching hints (CallToolResult is not cacheable)', async () => {
    const result = (await modern(2, 'tools/call', { name: 'echo_tool', arguments: { prompt: 'hi' } }))?.result as any;
    expect(result.resultType).toBe('complete');
    expect(result.content[0].text).toBe('echo:hi');
    expect(result.ttlMs).toBeUndefined();
    expect(result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('oz-bridge');
  });

  it('keeps a tool-level failure a complete result with isError, not a protocol error', async () => {
    const resp = await modern(3, 'tools/call', { name: 'echo_tool', arguments: {} });
    expect(resp?.error).toBeUndefined();
    expect((resp?.result as any).resultType).toBe('complete');
    expect((resp?.result as any).isError).toBe(true);
  });

  it('reports an unknown tool as -32602 Invalid params, as server/tools specifies', async () => {
    const resp = await modern(4, 'tools/call', { name: 'does_not_exist', arguments: {} });
    expect(resp?.error?.code).toBe(-32602);
    expect(resp?.error?.message).toContain('Unknown tool');
  });

  it('treats ping, initialize and logging/setLevel as removed methods', async () => {
    for (const method of ['ping', 'initialize', 'logging/setLevel']) {
      const resp = await modern(5, method);
      expect(resp?.error?.code, method).toBe(-32601);
    }
  });

  it('rejects a request id that is null, boolean, an object or a fraction as -32600 without an id', async () => {
    for (const id of [null, true, {}, [], 1.5]) {
      for (const method of ['tools/list', 'subscriptions/listen']) {
        const resp = await server.dispatch({
          jsonrpc: '2.0', id, method, params: { notifications: {}, _meta: modernMeta() },
        } as any);
        expect(resp?.error?.code, `${method} id=${JSON.stringify(id)}`).toBe(-32600);
        expect(resp && 'id' in resp, `${method} id=${JSON.stringify(id)}`).toBe(false);
        expect(resp?.result).toBeUndefined();
      }
    }
  });

  it('accepts a string request id and echoes it', async () => {
    const resp = await server.dispatch({ jsonrpc: '2.0', id: 'req-1', method: 'tools/list', params: { _meta: modernMeta() } });
    expect(resp?.id).toBe('req-1');
    expect((resp?.result as any).resultType).toBe('complete');
  });

  it('keeps the older revisions lenient about a null id, as base JSON-RPC is', async () => {
    const resp = await server.dispatch({ jsonrpc: '2.0', id: null, method: 'tools/list' });
    expect(resp?.id).toBeNull();
    expect(resp?.result).toEqual({ tools: [makeRegistry().get('echo_tool')!.descriptor] });
  });

  it('lists every implemented revision on server/discover, with caching hints', async () => {
    const result = (await modern(6, 'server/discover'))?.result as any;
    expect(result.resultType).toBe('complete');
    expect(result.supportedVersions).toEqual(['2026-07-28', '2025-03-26', '2024-11-05']);
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(typeof result.ttlMs).toBe('number');
    expect(result.cacheScope).toBe('public');
  });

  it('rejects a request missing the required clientCapabilities with -32602', async () => {
    const resp = await server.dispatch({
      jsonrpc: '2.0', id: 7, method: 'tools/list',
      params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
    });
    expect(resp?.error?.code).toBe(-32602);
    expect(resp?.error?.message).toContain('clientCapabilities');
  });

  it('rejects an unrecognised per-request log level with -32602 and accepts a valid one', async () => {
    const bad = await modern(8, 'tools/list', {}, { 'io.modelcontextprotocol/logLevel': 'verbose' });
    expect(bad?.error?.code).toBe(-32602);
    const good = await modern(9, 'tools/list', {}, { 'io.modelcontextprotocol/logLevel': 'debug' });
    expect(good?.error).toBeUndefined();
  });

  it('answers an unimplemented revision in _meta with -32022 and the supported list', async () => {
    const resp = await server.dispatch({
      jsonrpc: '2.0', id: 10, method: 'tools/list',
      params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } },
    });
    expect(resp?.error?.code).toBe(-32022);
    expect((resp?.error?.data as any).supported).toEqual(['2026-07-28', '2025-03-26', '2024-11-05']);
  });

  it('never answers a notification, even a malformed one', async () => {
    const resp = await server.dispatch({
      jsonrpc: '2.0', method: 'notifications/cancelled',
      params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } },
    });
    expect(resp).toBeNull();
  });

  it('acknowledges subscriptions/listen with an empty honoured set, then closes it gracefully', async () => {
    const notes: any[] = [];
    const resp = await server.dispatch(
      { jsonrpc: '2.0', id: 'sub-1', method: 'subscriptions/listen',
        params: { notifications: { toolsListChanged: true, resourceSubscriptions: ['file:///x'] }, _meta: modernMeta() } },
      { notify: (n) => notes.push(n) },
    );
    expect(notes).toEqual([{
      jsonrpc: '2.0',
      method: 'notifications/subscriptions/acknowledged',
      params: { _meta: { 'io.modelcontextprotocol/subscriptionId': 'sub-1' }, notifications: {} },
    }]);
    const result = resp?.result as any;
    expect(resp?.id).toBe('sub-1');
    expect(result.resultType).toBe('complete');
    expect(result._meta['io.modelcontextprotocol/subscriptionId']).toBe('sub-1');
  });

  it('rejects subscriptions/listen without a notifications filter with -32602', async () => {
    const resp = await modern(11, 'subscriptions/listen');
    expect(resp?.error?.code).toBe(-32602);
  });

  it('serves only the older revisions when the transport is restricted to them', async () => {
    const resp = await server.dispatch(
      { jsonrpc: '2.0', id: 12, method: 'tools/list', params: { _meta: modernMeta() } },
      { legacyOnly: true },
    );
    expect(resp?.error?.code).toBe(-32022);
    expect((resp?.error?.data as any).supported).toEqual(['2025-03-26', '2024-11-05']);
    const discover = await server.dispatch({ jsonrpc: '2.0', id: 13, method: 'server/discover' }, { legacyOnly: true });
    expect((discover?.result as any).supportedVersions).toEqual(['2025-03-26', '2024-11-05']);
  });
});

describe('McpServer Streamable HTTP — 2026-07-28 requests', () => {
  let server: McpServer;
  let port: number;

  beforeEach(async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0 });
    await server.start();
    port = server.endpoint!.port;
  });

  afterEach(async () => {
    await server?.stop();
  });

  it('serves tools/list under 2026-07-28 and echoes the version', async () => {
    const { status, headers, body } = await modernRpc(port, 1, 'tools/list');
    expect(status).toBe(200);
    expect(headers['mcp-protocol-version']).toBe('2026-07-28');
    expect(body.result.resultType).toBe('complete');
    expect(body.result.cacheScope).toBe('public');
    expect(typeof body.result.ttlMs).toBe('number');
  });

  it('serves tools/call under 2026-07-28', async () => {
    const { status, body } = await modernRpc(port, 2, 'tools/call', { name: 'echo_tool', arguments: { prompt: 'hi' } });
    expect(status).toBe(200);
    expect(body.result.resultType).toBe('complete');
    expect(body.result.content[0].text).toBe('echo:hi');
  });

  it('rejects a missing Mcp-Method, Mcp-Name or MCP-Protocol-Version header with 400 + -32020', async () => {
    const call = { name: 'echo_tool', arguments: { prompt: 'hi' } };
    for (const drop of ['Mcp-Method', 'Mcp-Name', 'MCP-Protocol-Version']) {
      const headers = modernHeaders('tools/call', 'echo_tool');
      delete headers[drop];
      const { status, body } = await rpc(
        port,
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { ...call, _meta: modernMeta() } },
        headers,
      );
      expect(status, drop).toBe(400);
      expect(body.error.code, drop).toBe(-32020);
    }
  });

  it('rejects a null request id with 400 + -32600 and no id in the error', async () => {
    const { status, body } = await rpc(
      port,
      { jsonrpc: '2.0', id: null, method: 'tools/list', params: { _meta: modernMeta() } },
      modernHeaders('tools/list'),
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe(-32600);
    expect('id' in body).toBe(false);
  });

  it('rejects a 2026-07-28 header whose body carries no version as -32020', async () => {
    const { status, body } = await rpc(
      port,
      { jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} },
      modernHeaders('tools/list'),
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe(-32020);
  });

  it('rejects a body missing clientCapabilities with 400 + -32602', async () => {
    const { status, body } = await rpc(
      port,
      { jsonrpc: '2.0', id: 5, method: 'tools/list',
        params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } },
      modernHeaders('tools/list'),
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe(-32602);
  });

  it('maps the removed ping to HTTP 404 + -32601 under 2026-07-28', async () => {
    const { status, body } = await modernRpc(port, 6, 'ping');
    expect(status).toBe(404);
    expect(body.error.code).toBe(-32601);
  });

  it('keeps an unknown tool on HTTP 200 with -32602 under 2026-07-28', async () => {
    const { status, body } = await modernRpc(port, 7, 'tools/call', { name: 'nope', arguments: {} });
    expect(status).toBe(200);
    expect(body.error.code).toBe(-32602);
  });

  it('streams the subscriptions/listen acknowledgement ahead of the closing result', async () => {
    const res = await postMcp(
      port,
      JSON.stringify({
        jsonrpc: '2.0', id: 8, method: 'subscriptions/listen',
        params: { notifications: { toolsListChanged: true }, _meta: modernMeta() },
      }),
      modernHeaders('subscriptions/listen'),
    );
    expect(res.status).toBe(200);
    // Even though the client also accepts JSON: the notification needs a stream.
    expect(res.headers['content-type']).toContain('text/event-stream');
    const [ack, done] = sseMessages(res.raw);
    expect(ack.method).toBe('notifications/subscriptions/acknowledged');
    expect(ack.params._meta['io.modelcontextprotocol/subscriptionId']).toBe(8);
    expect(ack.params.notifications).toEqual({});
    expect(done.id).toBe(8);
    expect(done.result.resultType).toBe('complete');
    expect(done.result._meta['io.modelcontextprotocol/subscriptionId']).toBe(8);
  });

  it('acknowledges a 2026-07-28 notification with a bare 202', async () => {
    const res = await postMcp(
      port,
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }),
      { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'notifications/cancelled' },
    );
    expect(res.status).toBe(202);
    expect(res.raw).toBe('');
  });

  it('serves a header-less older client exactly as before', async () => {
    const { status, headers, body } = await rpc(port, { jsonrpc: '2.0', id: 9, method: 'tools/list' });
    expect(status).toBe(200);
    expect(headers['mcp-protocol-version']).toBe('2025-03-26');
    expect(body.result).toEqual({ tools: [makeRegistry().get('echo_tool')!.descriptor] });
  });
});

// ---------------------------------------------------------------------------
// HTTP+SSE (/sse + /messages) — Origin validation and era restriction
// ---------------------------------------------------------------------------

interface SseHandle {
  status: number;
  /** `/messages?sessionId=…` from the `endpoint` event (200 only). */
  endpoint?: string;
  /** Resolves with the next `event: message` payload. */
  nextMessage: () => Promise<any>;
  close: () => void;
}

/** Opens `GET /sse` and, on 200, waits for the `endpoint` event. */
function openSse(port: number, headers: Record<string, string> = {}): Promise<SseHandle> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/sse', method: 'GET', headers: { Accept: 'text/event-stream', ...headers } },
      (res) => {
        const close = () => req.destroy();
        if (res.statusCode !== 200) {
          res.resume();
          resolve({ status: res.statusCode!, nextMessage: () => Promise.reject(new Error('no stream')), close });
          return;
        }
        let buffer = '';
        let resolved = false;
        const queue: any[] = [];
        const waiters: Array<(m: any) => void> = [];
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const lines = frame.split('\n');
            const event = lines.find((l) => l.startsWith('event: '))?.slice('event: '.length);
            const data = lines.find((l) => l.startsWith('data: '))?.slice('data: '.length);
            if (event === 'endpoint' && !resolved) {
              resolved = true;
              resolve({
                status: 200,
                endpoint: data,
                nextMessage: () => new Promise((r) => {
                  const queued = queue.shift();
                  if (queued !== undefined) { r(queued); } else { waiters.push(r); }
                }),
                close,
              });
            } else if (event === 'message' && data !== undefined) {
              const msg = JSON.parse(data);
              const waiter = waiters.shift();
              if (waiter) { waiter(msg); } else { queue.push(msg); }
            }
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('McpServer HTTP+SSE — Origin validation', () => {
  let server: McpServer;
  const handles: SseHandle[] = [];

  afterEach(async () => {
    for (const h of handles.splice(0)) { h.close(); }
    await server?.stop();
  });

  async function start(options: { allowedOrigins?: string[] } = {}): Promise<number> {
    server = new McpServer(makeRegistry(), undefined, { port: 0, ...options });
    await server.start();
    return server.endpoint!.port;
  }

  async function sse(port: number, headers: Record<string, string> = {}): Promise<SseHandle> {
    const h = await openSse(port, headers);
    handles.push(h);
    return h;
  }

  it('opens GET /sse with no Origin (native MCP clients send none)', async () => {
    const port = await start();
    const h = await sse(port);
    expect(h.status).toBe(200);
    expect(h.endpoint).toMatch(/^\/messages\?sessionId=/);
  });

  it('opens GET /sse from loopback origins', async () => {
    const port = await start();
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:3000', 'http://[::1]:8080']) {
      expect((await sse(port, { Origin: origin })).status, origin).toBe(200);
    }
  });

  it('rejects GET /sse from a foreign origin with 403 and opens no session', async () => {
    const port = await start();
    for (const origin of ['https://evil.example', 'http://localhost.evil.example', 'null']) {
      expect((await sse(port, { Origin: origin })).status, origin).toBe(403);
    }
    const health = await fetchJson(port, '/health');
    expect(health.body.sessions).toBe(0);
  });

  it('honours allowedOrigins on GET /sse, replacing the loopback default', async () => {
    const port = await start({ allowedOrigins: ['https://trusted.example'] });
    expect((await sse(port, { Origin: 'https://trusted.example' })).status).toBe(200);
    expect((await sse(port, { Origin: 'http://127.0.0.1:3000' })).status).toBe(403);
  });

  it('rejects POST /messages from a foreign origin even with a live session id', async () => {
    const port = await start();
    const h = await sse(port);
    const ping = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
    const denied = await postMcp(port, ping, { Origin: 'https://evil.example' }, h.endpoint!);
    expect(denied.status).toBe(403);
    const accepted = await postMcp(port, ping, {}, h.endpoint!);
    expect(accepted.status).toBe(202);
    expect(await h.nextMessage()).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
  });

  it('accepts POST /messages from a loopback origin', async () => {
    const port = await start();
    const h = await sse(port);
    const res = await postMcp(
      port,
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      { Origin: 'http://localhost:5173' },
      h.endpoint!,
    );
    expect(res.status).toBe(202);
    expect((await h.nextMessage()).result.tools).toHaveLength(1);
  });
});

describe('McpServer HTTP+SSE — deprecated transport serves older revisions only', () => {
  let server: McpServer;
  let handle: SseHandle | undefined;

  afterEach(async () => {
    handle?.close();
    await server?.stop();
  });

  it('answers a 2026-07-28 request on /messages with -32022 listing the older revisions', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0 });
    await server.start();
    const port = server.endpoint!.port;
    handle = await openSse(port);
    await postMcp(
      port,
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: modernMeta() } }),
      {},
      handle.endpoint!,
    );
    const msg = await handle.nextMessage();
    expect(msg.error.code).toBe(-32022);
    expect(msg.error.data.supported).toEqual(['2025-03-26', '2024-11-05']);
  });

  it('advertises only the older revisions on server/discover over /messages', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0 });
    await server.start();
    const port = server.endpoint!.port;
    handle = await openSse(port);
    await postMcp(port, JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'server/discover' }), {}, handle.endpoint!);
    const msg = await handle.nextMessage();
    expect(msg.result.supportedVersions).toEqual(['2025-03-26', '2024-11-05']);
  });
});
