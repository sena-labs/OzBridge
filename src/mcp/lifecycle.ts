import * as vscode from 'vscode';
import { IConfigManager, IOzCliService, WarpBridgeConfig } from '../types/index.js';
import { McpServer } from './server.js';
import { buildToolRegistry } from './tools.js';
import { logError, logInfo, logWarn } from '../services/logger.js';
import { IMcpClientRegistrar, McpClientEndpoint } from './clientRegistration.js';
import { ClaudeCodeRegistrar } from './registrars/claudeCodeRegistrar.js';
import { CursorRegistrar } from './registrars/cursorRegistrar.js';
import { CodexRegistrar } from './registrars/codexRegistrar.js';

/** Settings block consumed by the lifecycle controller. */
export interface McpConfig {
  enabled: boolean;
  port: number;
  bindAddress: string;
  bearerToken: string;
}

/** Extracts the `warpBridge.mcp.*` slice from the full config snapshot. */
export function readMcpConfig(full: WarpBridgeConfig & Partial<{
  mcpEnabled: boolean; mcpPort: number; mcpBindAddress: string; mcpBearerToken: string;
}>): McpConfig {
  return {
    enabled: full.mcpEnabled === true,
    port: typeof full.mcpPort === 'number' && full.mcpPort >= 0 ? full.mcpPort : 3847,
    bindAddress: full.mcpBindAddress || '127.0.0.1',
    bearerToken: full.mcpBearerToken || '',
  };
}

/**
 * Extension-side wrapper around {@link McpServer}. Handles: config-driven
 * auto-start, manual start/stop commands, status reporting and disposal.
 *
 * This class owns exactly one server instance at a time. `start()` is
 * idempotent — calling it while a server is already running restarts with
 * the current config.
 */
export class McpLifecycle implements vscode.Disposable {
  private server: McpServer | undefined;
  private current: McpConfig | undefined;
  private disposed = false;

  constructor(
    private readonly cli: IOzCliService,
    private readonly cfgMgr: IConfigManager,
    private readonly extensionVersion: string,
  ) {}

  /** True while an MCP server socket is open. */
  get running(): boolean {
    return this.server !== undefined;
  }

  /**
   * Resolved endpoint (address + port) once the server is listening, else
   * undefined.
   */
  get endpoint(): { address: string; port: number } | undefined {
    return this.server?.endpoint;
  }

  /** Snapshot of the current `warpBridge.mcp.*` settings. */
  get config(): McpConfig | undefined {
    return this.current;
  }

  /**
   * Starts (or restarts) the server with the latest settings. If the socket
   * fails to bind, logs the error and resolves without re-throwing so that
   * extension activation is never blocked.
   */
  async start(): Promise<void> {
    if (this.disposed) { return; }
    await this.stop();
    const cfg = readMcpConfig(this.cfgMgr.getConfig() as unknown as WarpBridgeConfig);
    this.current = { ...cfg };

    const registry = buildToolRegistry({ cli: this.cli, cfgMgr: this.cfgMgr });
    const serverInfo = { name: 'warp-vsc-bridge', version: this.extensionVersion };

    try {
      const server = new McpServer(registry, serverInfo, {
        port: cfg.port,
        bindAddress: cfg.bindAddress,
        bearerToken: cfg.bearerToken || undefined,
      });
      await server.start();
      this.server = server;
      const ep = this.server.endpoint;
      logInfo(`MCP server listening on http://${ep?.address}:${ep?.port}/sse (${registry.size} tools)`);
      return;
    } catch (err) {
      if (isPortInUseError(err) && cfg.port !== 0) {
        logWarn(`MCP port ${cfg.port} is busy; retrying on an ephemeral port.`);
        try {
          const fallbackServer = new McpServer(registry, serverInfo, {
            port: 0,
            bindAddress: cfg.bindAddress,
            bearerToken: cfg.bearerToken || undefined,
          });
          await fallbackServer.start();
          this.server = fallbackServer;
          const ep = this.server.endpoint;
          if (ep?.port && this.current) {
            this.current.port = ep.port;
          }
          logInfo(`MCP server listening on fallback endpoint http://${ep?.address}:${ep?.port}/sse (${registry.size} tools)`);
          return;
        } catch (fallbackErr) {
          const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          logError(`MCP server fallback start failed: ${msg}`);
          this.server = undefined;
          return;
        }
      }

      const msg = err instanceof Error ? err.message : String(err);
      logError(`MCP server failed to start: ${msg}`);
      this.server = undefined;
    }
  }

  /** Stops the server if running. Idempotent. */
  async stop(): Promise<void> {
    if (!this.server) { return; }
    const server = this.server;
    this.server = undefined;
    try {
      await server.stop();
      logInfo('MCP server stopped.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`MCP server stop error: ${msg}`);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) { return; }
    this.disposed = true;
    await this.stop();
  }
}

function isPortInUseError(err: unknown): boolean {
  if (!err || typeof err !== 'object') { return false; }
  return (err as { code?: unknown }).code === 'EADDRINUSE';
}

/**
 * Registers the user-facing commands that drive the MCP lifecycle. The
 * returned disposables should be pushed into `context.subscriptions`.
 */
export function registerMcpCommands(
  lifecycle: McpLifecycle,
  cfgMgr: IConfigManager,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('warpBridge.mcp.start', async () => {
      await lifecycle.start();
      const ep = lifecycle.endpoint;
      await vscode.window.showInformationMessage(
        ep
          ? `Warp MCP server listening on http://${ep.address}:${ep.port}/sse`
          : 'Warp MCP server failed to start — see the Warp Bridge output channel.',
      );
    }),

    vscode.commands.registerCommand('warpBridge.mcp.stop', async () => {
      await lifecycle.stop();
      await vscode.window.showInformationMessage('Warp MCP server stopped.');
    }),

    vscode.commands.registerCommand('warpBridge.mcp.status', async () => {
      const cfg = readMcpConfig(cfgMgr.getConfig() as unknown as WarpBridgeConfig);
      const ep = lifecycle.endpoint;
      const tokenLabel = cfg.bearerToken ? 'bearer token required' : 'no bearer token';
      const state = lifecycle.running
        ? `running — http://${ep?.address}:${ep?.port}/sse · ${tokenLabel}`
        : 'stopped';
      await vscode.window.showInformationMessage(`Warp MCP server: ${state}`);
    }),

    vscode.commands.registerCommand('warpBridge.mcp.copyEndpointUrl', async () => {
      const ep = lifecycle.endpoint;
      if (!ep) {
        await vscode.window.showWarningMessage('Warp MCP server is not running.');
        return;
      }
      const url = `http://${ep.address}:${ep.port}/sse`;
      await vscode.env.clipboard.writeText(url);
      await vscode.window.showInformationMessage(`Copied MCP endpoint URL: ${url}`);
    }),

    vscode.commands.registerCommand('warpBridge.mcp.registerClient', async () => {
      await runRegistrarCommand('register', lifecycle, cfgMgr);
    }),

    vscode.commands.registerCommand('warpBridge.mcp.unregisterClient', async () => {
      await runRegistrarCommand('unregister', lifecycle, cfgMgr);
    }),
  ];
}

// ===========================================================================
// Client auto-registration orchestration
// ===========================================================================

/**
 * Factory hook — overridable by tests to inject a deterministic set
 * of registrars without touching the real `~/.claude.json` etc.
 */
let registrarFactory: () => IMcpClientRegistrar[] = defaultRegistrars;

/** Test-only: swap the registrar factory. Pass `undefined` to reset. */
export function __setRegistrarFactoryForTests(factory?: () => IMcpClientRegistrar[]): void {
  registrarFactory = factory ?? defaultRegistrars;
}

function defaultRegistrars(): IMcpClientRegistrar[] {
  return [new ClaudeCodeRegistrar(), new CursorRegistrar(), new CodexRegistrar()];
}

/** Server name advertised to every MCP client we register with. */
export const MCP_SERVER_NAME = 'warp-vsc-bridge';

/**
 * Shared implementation behind the `registerClient` / `unregisterClient`
 * commands. Presents a QuickPick of the available registrars and
 * performs the corresponding side effect on the selection.
 */
async function runRegistrarCommand(
  action: 'register' | 'unregister',
  lifecycle: McpLifecycle,
  cfgMgr: IConfigManager,
): Promise<void> {
  if (action === 'register' && !lifecycle.running) {
    await vscode.window.showWarningMessage(
      'Warp MCP server is not running. Start it first with "Warp: Start MCP server".',
    );
    return;
  }
  const registrars = registrarFactory();
  const items = registrars.map((r) => ({
    label: r.displayName,
    description: r.configPath,
    registrar: r,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: action === 'register'
      ? 'Warp Bridge · Register MCP client'
      : 'Warp Bridge · Unregister MCP client',
    placeHolder: 'Choose the client whose config file should be updated',
    canPickMany: false,
  });
  if (!picked || Array.isArray(picked)) { return; }
  const target = (picked as { registrar: IMcpClientRegistrar }).registrar;

  try {
    if (action === 'register') {
      const endpoint = buildLocalEndpoint(lifecycle, cfgMgr);
      await target.register(endpoint);
      await vscode.window.showInformationMessage(
        `Registered ${MCP_SERVER_NAME} in ${target.displayName} (${target.configPath}).`,
      );
    } else {
      await target.unregister(MCP_SERVER_NAME);
      await vscode.window.showInformationMessage(
        `Unregistered ${MCP_SERVER_NAME} from ${target.displayName}.`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await vscode.window.showErrorMessage(`Warp MCP ${action} failed: ${msg}`);
    logError(`mcp.${action}Client(${target.clientId}) failed: ${msg}`);
  }
}

/**
 * Computes the endpoint descriptor a client should store, based on
 * the currently running MCP server and the user's bearer-token
 * setting.
 */
export function buildLocalEndpoint(lifecycle: McpLifecycle, cfgMgr: IConfigManager): McpClientEndpoint {
  const ep = lifecycle.endpoint;
  const cfg = readMcpConfig(cfgMgr.getConfig() as unknown as WarpBridgeConfig);
  const address = ep?.address ?? cfg.bindAddress;
  const port = ep?.port ?? cfg.port;
  return {
    name: MCP_SERVER_NAME,
    url: `http://${address}:${port}/sse`,
    bearerToken: cfg.bearerToken || undefined,
  };
}
