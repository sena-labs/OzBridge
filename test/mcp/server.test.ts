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
// HTTP + SSE integration
// ---------------------------------------------------------------------------

describe('McpServer HTTP transport', () => {
  let server: McpServer;

  afterEach(async () => {
    await server?.stop();
  });

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
});
