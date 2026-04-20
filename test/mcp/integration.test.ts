/**
 * End-to-end smoke for the MCP HTTP+SSE transport.
 *
 * Most existing tests in `test/mcp/` exercise the JSON-RPC dispatcher
 * directly or hit individual HTTP routes (health, auth). This file
 * closes the integration gap by walking through the full client
 * handshake:
 *
 *   1. open `GET /sse`
 *   2. read the initial `event: endpoint` frame to obtain the
 *      session-scoped `/messages?sessionId=…` URL
 *   3. POST a `tools/call` JSON-RPC request to that URL
 *   4. read the next SSE `event: message` frame and assert it carries
 *      the JSON-RPC response produced by the registered tool.
 *
 * The whole flow uses ephemeral ports (`port: 0`) and 127.0.0.1 so it
 * runs in parallel-safe isolation without any user setup.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import { McpServer } from '../../src/mcp/server.js';
import type { McpToolEntry } from '../../src/mcp/tools.js';

function makeRegistry(): Map<string, McpToolEntry> {
  return new Map<string, McpToolEntry>([
    [
      'echo_tool',
      {
        descriptor: {
          name: 'echo_tool',
          description: 'Echoes the prompt back.',
          inputSchema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string' } } },
        },
        invoke: async (input) => ({
          content: [{ type: 'text', text: `echo:${input.prompt}` }],
        }),
      },
    ],
  ]);
}

interface SseClient {
  /** Resolves with the next `data: …` payload emitted by the server. */
  nextData(): Promise<string>;
  close(): void;
}

/**
 * Opens an SSE stream against `http://127.0.0.1:<port>/sse` and exposes
 * an async iterator-like `nextData()` helper. Frames are split on the
 * `\n\n` SSE delimiter and only the `data:` line is returned.
 */
function openSse(port: number): Promise<SseClient> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/sse', method: 'GET' },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE handshake failed with status ${res.statusCode}`));
          return;
        }

        let buffer = '';
        const pendingFrames: string[] = [];
        const waiters: Array<(data: string) => void> = [];

        const emitFrame = (raw: string) => {
          const dataLine = raw.split('\n').find((line) => line.startsWith('data:'));
          if (!dataLine) { return; }
          const payload = dataLine.slice('data:'.length).trim();
          const waiter = waiters.shift();
          if (waiter) { waiter(payload); } else { pendingFrames.push(payload); }
        };

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            if (frame.length > 0) { emitFrame(frame); }
          }
        });

        resolve({
          nextData: () => new Promise<string>((r) => {
            const queued = pendingFrames.shift();
            if (queued !== undefined) { r(queued); return; }
            waiters.push(r);
          }),
          close: () => { try { req.destroy(); } catch { /* ignore */ } },
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function postJson(port: number, path: string, body: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('MCP HTTP+SSE end-to-end smoke', () => {
  let server: McpServer;
  let sse: SseClient | undefined;

  afterEach(async () => {
    sse?.close();
    sse = undefined;
    await server?.stop();
  });

  it('completes the full handshake → tools/call → SSE response cycle', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0 });
    await server.start();
    const port = server.endpoint!.port;

    // 1. Open SSE and read the endpoint frame.
    sse = await openSse(port);
    const endpointPayload = await sse.nextData();
    expect(endpointPayload).toMatch(/^\/messages\?sessionId=[0-9a-fA-F-]{36}$/);

    // 2. POST a tools/call request to the session-scoped endpoint.
    const postResult = await postJson(port, endpointPayload, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'echo_tool', arguments: { prompt: 'hello' } },
    });
    expect(postResult.status).toBe(202);

    // 3. The next SSE frame must carry the JSON-RPC response.
    const messagePayload = await sse.nextData();
    const response = JSON.parse(messagePayload);
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(1);
    expect(response.error).toBeUndefined();
    expect(response.result.content[0].text).toBe('echo:hello');
  });

  it('rejects POST /messages with an unknown sessionId', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0 });
    await server.start();
    const port = server.endpoint!.port;

    const result = await postJson(port, '/messages?sessionId=does-not-exist', {
      jsonrpc: '2.0', id: 1, method: 'ping',
    });
    expect(result.status).toBe(404);
    expect(JSON.parse(result.body).error).toBe('unknown_session');
  });

  it('rejects POST /messages with malformed JSON body', async () => {
    server = new McpServer(makeRegistry(), undefined, { port: 0 });
    await server.start();
    const port = server.endpoint!.port;

    sse = await openSse(port);
    const endpointPayload = await sse.nextData();

    // Send a body that is not valid JSON.
    const malformed = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: endpointPayload,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }));
        },
      );
      req.on('error', reject);
      req.write('{ not json');
      req.end();
    });

    expect(malformed.status).toBe(400);
    expect(JSON.parse(malformed.body).error).toBe('invalid_json');
  });
});
