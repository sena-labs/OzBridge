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

  it('chiama close prima di forzare la chiusura delle connessioni', async () => {
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
