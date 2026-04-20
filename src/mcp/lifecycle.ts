import * as vscode from 'vscode';
import { IConfigManager, IOzCliService, WarpBridgeConfig } from '../types/index.js';
import { McpServer, McpServerOptions } from './server.js';
import { buildToolRegistry } from './tools.js';
import { logError, logInfo } from '../services/logger.js';

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
    this.current = cfg;

    const registry = buildToolRegistry({ cli: this.cli, cfgMgr: this.cfgMgr });
    const options: McpServerOptions = {
      port: cfg.port,
      bindAddress: cfg.bindAddress,
      bearerToken: cfg.bearerToken || undefined,
    };
    this.server = new McpServer(
      registry,
      { name: 'warp-vsc-bridge', version: this.extensionVersion },
      options,
    );
    try {
      await this.server.start();
      const ep = this.server.endpoint;
      logInfo(`MCP server listening on http://${ep?.address}:${ep?.port}/sse (${registry.size} tools)`);
    } catch (err) {
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
  ];
}
