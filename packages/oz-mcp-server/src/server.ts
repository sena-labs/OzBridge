/**
 * Standalone MCP server entry point.
 *
 * Starts the OzBridge HTTP+SSE MCP server without requiring VS Code.
 * Compatible with Claude Code, Cursor, and any MCP client.
 *
 * Usage:
 *   npx @sena-labs/oz-mcp-server [options]
 *
 * Options:
 *   --port  <n>    Port to listen on     (default: OZ_MCP_PORT env or 3847)
 *   --bind  <addr> Bind address          (default: OZ_MCP_BIND env or 127.0.0.1)
 *   --token <s>    Bearer token          (default: OZ_MCP_TOKEN env or none)
 *   --cwd   <dir>  Workspace root for .warp/warp-bridge.yaml discovery
 *                  (default: process.cwd())
 */

import { McpServer } from '../../../src/mcp/server.js';
import { buildToolRegistry } from '../../../src/mcp/tools.js';
import { OzCliService } from '../../../src/services/ozCliService.js';
import { StandaloneConfigManager } from './standaloneConfig.js';

function getArg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log([
      'oz-mcp-server — Standalone Warp Oz MCP server',
      '',
      'Options:',
      '  --port  <n>    Listening port              (default: 3847)',
      '  --bind  <addr> Bind address                (default: 127.0.0.1)',
      '  --token <s>    Bearer auth token           (default: none)',
      '  --cwd   <dir>  Workspace for YAML config   (default: .)',
      '',
      'Env vars: OZ_PATH, OZ_MCP_PORT, OZ_MCP_BIND, OZ_MCP_TOKEN,',
      '          OZ_DEFAULT_MODEL, OZ_DEFAULT_PROFILE, OZ_DEFAULT_ENV,',
      '          OZ_TIMEOUT_MS, OZ_IDLE_TIMEOUT_MS',
    ].join('\n'));
    process.exit(0);
  }

  const cwd = getArg(args, '--cwd') ?? process.cwd();

  const cfgMgr = new StandaloneConfigManager(cwd);
  const cfg = cfgMgr.getConfig();

  // Coalesce on a finite-integer check, not `||`, so `--port 0` (request an
  // OS-assigned ephemeral port) is honoured instead of falling back to cfg.
  const portArg = getArg(args, '--port');
  const parsedPort = portArg !== undefined ? Number(portArg) : NaN;
  const port    = Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65535
    ? parsedPort
    : cfg.mcpPort;
  const bind    = getArg(args, '--bind')           ?? cfg.mcpBindAddress;
  const token   = getArg(args, '--token')          ?? cfg.mcpBearerToken;

  // Security gate: the MCP tool surface can spawn the Oz CLI, so refuse to
  // bind to a non-loopback address without a bearer token (mirrors the
  // extension's McpLifecycle gate). `localhost` is normalised first so the
  // gate cannot be bypassed via a tampered hosts file.
  const normalizedBind = bind.trim().toLowerCase() === 'localhost' ? '127.0.0.1' : bind.trim();
  const isLoopback = normalizedBind === '127.0.0.1' || normalizedBind === '::1';
  if (!isLoopback && !token) {
    console.error(
      `[oz-mcp-server] Refusing to bind to non-loopback address "${bind}" without a bearer token. `
      + 'Pass --token / set OZ_MCP_TOKEN, or bind to 127.0.0.1.',
    );
    process.exit(1);
  }

  const cli   = new OzCliService(cfgMgr);
  const tools = buildToolRegistry({ cli, cfgMgr, workspaceRoot: cwd });

  const server = new McpServer(
    tools,
    { name: 'oz-mcp-server', version: '1.2.0' },
    {
      port,
      bindAddress: normalizedBind,
      bearerToken: token || undefined,
      maxSseSessions: cfg.mcpMaxSseSessions,
      sseMaxLifetimeMs: cfg.mcpSseMaxLifetimeMs,
    },
  );

  await server.start();

  const ep = server.endpoint;
  console.log(`[oz-mcp-server] Listening on http://${ep?.address ?? bind}:${ep?.port ?? port}`);
  console.log(`[oz-mcp-server] SSE endpoint : http://${ep?.address ?? bind}:${ep?.port ?? port}/sse`);
  console.log(`[oz-mcp-server] Health check : http://${ep?.address ?? bind}:${ep?.port ?? port}/health`);
  console.log('[oz-mcp-server] Press Ctrl+C to stop.');

  const stop = async () => {
    console.log('\n[oz-mcp-server] Shutting down…');
    try { await server.stop(); } catch { /* ignore */ }
    process.exit(0);
  };

  process.on('SIGINT',  () => { void stop(); });
  process.on('SIGTERM', () => { void stop(); });
}

main().catch((err: unknown) => {
  console.error('[oz-mcp-server] Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
