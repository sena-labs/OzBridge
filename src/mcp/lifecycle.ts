import * as vscode from 'vscode';
import { IConfigManager, IOzCliService, WarpBridgeConfig } from '../types/index.js';
// OPT-4: Type-only import — McpServer is loaded lazily via import('./mcp-bundle.js')
// inside start(). The actual code lives in dist/mcp-bundle.js (separate esbuild chunk).
import type { McpServer } from './server.js';
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
  maxSseSessions: number;
  sseMaxLifetimeMs: number;
}

/** Extracts the `ozBridge.mcp.*` slice from the full config snapshot. */
export function readMcpConfig(full: WarpBridgeConfig): McpConfig {
  const port =
    typeof full.mcpPort === 'number'
    && Number.isInteger(full.mcpPort)
    && Number.isFinite(full.mcpPort)
    && full.mcpPort >= 0
    && full.mcpPort <= 65_535
      ? full.mcpPort
      : 3847;

  const maxSseSessions =
    typeof full.mcpMaxSseSessions === 'number'
    && Number.isInteger(full.mcpMaxSseSessions)
    && full.mcpMaxSseSessions >= 1
    && full.mcpMaxSseSessions <= 256
      ? full.mcpMaxSseSessions
      : 16;

  return {
    enabled: full.mcpEnabled === true,
    port,
    bindAddress: full.mcpBindAddress || '127.0.0.1',
    bearerToken: full.mcpBearerToken || '',
    maxSseSessions,
    sseMaxLifetimeMs:
      typeof full.mcpSseMaxLifetimeMs === 'number'
      && Number.isInteger(full.mcpSseMaxLifetimeMs)
      && full.mcpSseMaxLifetimeMs >= 60_000
      && full.mcpSseMaxLifetimeMs <= 86_400_000
        ? full.mcpSseMaxLifetimeMs
        : 1_800_000,
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
  /**
   * Promise chain that serializes external `start()` / `stop()` invocations.
   * Without this serialization, fire-and-forget toggles (e.g. the
   * `onConfigChanged` listener flipping `mcpEnabled` rapidly) can interleave
   * a pending `stop()` with a fresh `start()`, leaving the OS port still
   * held by the closing server when the next bind attempts — which silently
   * falls back to an ephemeral port and breaks every registered client.
   */
  private transitionChain: Promise<void> = Promise.resolve();

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

  /** Snapshot of the current `ozBridge.mcp.*` settings. */
  get config(): McpConfig | undefined {
    return this.current;
  }

  /**
   * Enqueues `work` after any in-flight transition. The chain stores only
   * resolved sentinels (`undefined`) so a single failure never poisons later
   * transitions — every caller still observes its own rejection.
   */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.transitionChain.then(work, work);
    this.transitionChain = next.then(() => undefined, () => undefined);
    return next;
  }

  /**
   * Starts (or restarts) the server with the latest settings. If the socket
   * fails to bind, logs the error and resolves without re-throwing so that
   * extension activation is never blocked.
   *
   * Concurrency: serialized through {@link transitionChain}; safe to invoke
   * concurrently with `stop()` or other `start()` calls.
   */
  async start(): Promise<void> {
    return this.enqueue(() => this.doStart());
  }

  private async doStart(): Promise<void> {
    if (this.disposed) { return; }
    await this.doStop();
    const cfg = readMcpConfig(this.cfgMgr.getConfig());
    this.current = { ...cfg };

    // Security gate: when the user binds the MCP socket to an address other
    // than loopback, refuse to start without a bearer token. This prevents
    // exposing the JSON-RPC surface (which can spawn the Oz CLI) to the
    // local network without authentication.
    if (!isLoopbackAddress(cfg.bindAddress) && !cfg.bearerToken) {
      logError(
        `MCP server refused to start: bindAddress="${cfg.bindAddress}" requires `
        + 'a non-empty ozBridge.mcpBearerToken. Either set 127.0.0.1 or configure a token.',
      );
      this.server = undefined;
      return;
    }

    // OPT-4: Lazy-load the MCP server bundle. esbuild inlines this as an __esm
    // lazy chunk within extension.js (CJS format doesn't support true splitting),
    // so the HTTP-server code is initialised only on first start() call.
    const { McpServer, buildToolRegistry } = await import('./mcp-bundle.js');

    const registry = buildToolRegistry({
      cli: this.cli,
      cfgMgr: this.cfgMgr,
      workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    });
    const serverInfo = { name: 'oz-bridge', version: this.extensionVersion };

    try {
      const server = new McpServer(registry, serverInfo, {
        port: cfg.port,
        bindAddress: cfg.bindAddress,
        bearerToken: cfg.bearerToken || undefined,
        maxSseSessions: cfg.maxSseSessions,
        sseMaxLifetimeMs: cfg.sseMaxLifetimeMs,
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
            maxSseSessions: cfg.maxSseSessions,
            sseMaxLifetimeMs: cfg.sseMaxLifetimeMs,
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

  /**
   * Stops the server if running. Idempotent.
   *
   * Concurrency: serialized through {@link transitionChain}; safe to invoke
   * concurrently with `start()` or other `stop()` calls.
   */
  async stop(): Promise<void> {
    return this.enqueue(() => this.doStop());
  }

  private async doStop(): Promise<void> {
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

/** Returns true for IPv4/IPv6 loopback bind addresses. */
function isLoopbackAddress(address: string): boolean {
  const a = address.trim().toLowerCase();
  return a === '127.0.0.1' || a === 'localhost' || a === '::1';
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
    vscode.commands.registerCommand('ozBridge.mcp.start', async () => {
      await lifecycle.start();
      const ep = lifecycle.endpoint;
      // UX: a missing endpoint after `start()` means the server failed to
      // bind. Surface it as an error toast (red) instead of an info toast
      // (blue) so the failure is communicated correctly.
      if (ep) {
        await vscode.window.showInformationMessage(
          vscode.l10n.t('OzBridge MCP server listening on http://{0}:{1}/sse', ep.address, String(ep.port)),
        );
      } else {
        await vscode.window.showErrorMessage(
          vscode.l10n.t('OzBridge MCP server failed to start — see the OzBridge output channel.'),
        );
      }
    }),

    vscode.commands.registerCommand('ozBridge.mcp.stop', async () => {
      await lifecycle.stop();
      await vscode.window.showInformationMessage(vscode.l10n.t('OzBridge MCP server stopped.'));
    }),

    vscode.commands.registerCommand('ozBridge.mcp.status', async () => {
      const cfg = readMcpConfig(cfgMgr.getConfig());
      const ep = lifecycle.endpoint;
      const tokenLabel = cfg.bearerToken ? 'bearer token required' : 'no bearer token';
      const state = lifecycle.running
        ? `running — http://${ep?.address}:${ep?.port}/sse · ${tokenLabel}`
        : 'stopped';
      await vscode.window.showInformationMessage(vscode.l10n.t('OzBridge MCP server: {0}', state));
    }),

    vscode.commands.registerCommand('ozBridge.mcp.copyEndpointUrl', async () => {
      const ep = lifecycle.endpoint;
      if (!ep) {
        await vscode.window.showWarningMessage(vscode.l10n.t('OzBridge MCP server is not running.'));
        return;
      }
      const url = `http://${ep.address}:${ep.port}/sse`;
      await vscode.env.clipboard.writeText(url);
      await vscode.window.showInformationMessage(vscode.l10n.t('Copied MCP endpoint URL: {0}', url));
    }),

    vscode.commands.registerCommand('ozBridge.mcp.registerClient', async () => {
      await runRegistrarCommand('register', lifecycle, cfgMgr);
    }),

    vscode.commands.registerCommand('ozBridge.mcp.unregisterClient', async () => {
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
export const MCP_SERVER_NAME = 'oz-bridge';

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
      vscode.l10n.t('OzBridge MCP server is not running. Start it first with "OzBridge: Start MCP server".'),
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
      ? vscode.l10n.t('OzBridge · Register MCP client')
      : vscode.l10n.t('OzBridge · Unregister MCP client'),
    placeHolder: vscode.l10n.t('Choose the client whose config file should be updated'),
    canPickMany: false,
    ignoreFocusOut: true,
  });
  if (!picked || Array.isArray(picked)) { return; }
  const target = (picked as { registrar: IMcpClientRegistrar }).registrar;

  try {
    if (action === 'register') {
      const endpoint = buildLocalEndpoint(lifecycle, cfgMgr);
      await target.register(endpoint);
      await vscode.window.showInformationMessage(
        vscode.l10n.t('Registered {0} in {1} ({2}).', MCP_SERVER_NAME, target.displayName, target.configPath),
      );
    } else {
      await target.unregister(MCP_SERVER_NAME);
      await vscode.window.showInformationMessage(
        vscode.l10n.t('Unregistered {0} from {1}.', MCP_SERVER_NAME, target.displayName),
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await vscode.window.showErrorMessage(vscode.l10n.t('OzBridge MCP {0} failed: {1}', action, msg));
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
  const cfg = readMcpConfig(cfgMgr.getConfig());
  const address = ep?.address ?? cfg.bindAddress;
  const port = ep?.port ?? cfg.port;
  return {
    name: MCP_SERVER_NAME,
    url: `http://${address}:${port}/sse`,
    bearerToken: cfg.bearerToken || undefined,
  };
}
