import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import { ConfigManager } from './services/configManager.js';
import {
  WorkspaceConfigResolver,
  firstWorkspaceFolderPath,
} from './services/workspaceConfigResolver.js';
import { ContextCollector } from './services/contextCollector.js';
import { OzCliService } from './services/ozCliService.js';
import { RunPoller } from './services/runPoller.js';
import { ActiveRunsTracker } from './services/activeRunsTracker.js';
import { registerChatParticipant } from './participant/handler.js';
import { registerOzTools } from './tools/index.js';
import { StatusBarManager } from './ui/statusBarItem.js';
import { OzRunsTreeProvider, RunTreeDragAndDropController } from './ui/runsTreeProvider.js';
import { registerTreeCommands } from './ui/treeCommands.js';
import { registerHandoffCommands } from './ui/handoff.js';
import { McpLifecycle, registerMcpCommands, MCP_SERVER_NAME, buildLocalEndpoint } from './mcp/lifecycle.js';
import { createOzBridgeDriveSource } from './drive/driveSourceFactory.js';
import { IDriveSource } from './drive/warpDriveSource.js';
import { OzDriveTreeProvider } from './ui/driveTreeProvider.js';
import { registerDriveCommands } from './ui/driveCommands.js';
import { registerSkillEditorCommands } from './ui/skillEditor.js';
import { maybeOpenGettingStartedWalkthrough } from './ui/walkthrough.js';
import { DashboardPanel } from './ui/dashboardPanel.js';
import { RunStatsService } from './services/runStats.js';
import { FailureTriageService } from './services/failureTriage.js';
import { createVsCodeLanguageModelClient } from './services/languageModelClient.js';
import { DatasetExportService, DatasetFormat } from './services/datasetExport.js';
import { initLogger, logInfo, logError } from './services/logger.js';
import { createTelemetryReporter, ITelemetryReporter } from './services/telemetry.js';
import { getErrorMessage } from './utils/error.js';
import { StartupCoordinator, type StartupGateResult } from './services/startupCoordinator.js';




/**
 * Best-effort host detection fallback used when the dedicated host utility
 * module is not present in the source tree.
 */
function detectHost(): string {
  const appName = typeof vscode.env.appName === 'string' ? vscode.env.appName.toLowerCase() : '';
  if (appName.includes('cursor')) { return 'cursor'; }
  if (appName.includes('vscodium')) { return 'vscodium'; }
  if (appName.includes('visual studio code') || appName.includes('code - insiders') || appName.includes('vs code')) {
    return 'vscode';
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Cursor-specific MCP API stubs
// Cursor AI editor exposes `vscode.cursor.mcp` for in-editor MCP registration.
// These helpers are no-ops in regular VS Code where the API is absent.
// ---------------------------------------------------------------------------

interface CursorMcpApi {
  registerServer?: (name: string, url: string) => void;
  unregisterServer?: (name: string) => void;
}

function getCursorMcp(): CursorMcpApi | undefined {
  return (vscode as unknown as { cursor?: { mcp?: CursorMcpApi } }).cursor?.mcp;
}

function canRegisterCursorMcpServers(): boolean {
  return typeof getCursorMcp()?.registerServer === 'function';
}

function registerCursorMcpServer(endpoint: string): void {
  getCursorMcp()?.registerServer?.(MCP_SERVER_NAME, endpoint);
}

function unregisterCursorMcpServer(name: string): void {
  getCursorMcp()?.unregisterServer?.(name);
}

/**
 * Entry point of the OzBridge extension.
 *
 * Initialises all core services ({@link ConfigManager}, {@link OzCliService},
 * {@link ContextCollector}, {@link RunPoller}), registers the `@oz` Chat
 * Participant, and starts the Oz CLI availability check in the background.
 *
 * @param context - VS Code extension context for subscriptions and lifecycle.
 */

/** Module-level state — encapsulates extension lifecycle objects. */
const state: {
  configManager?: ConfigManager;
  workspaceConfigResolver?: WorkspaceConfigResolver;
  runPoller?: RunPoller;
  tracker?: ActiveRunsTracker;
  mcp?: McpLifecycle;
  driveSource?: IDriveSource;
  telemetry?: ITelemetryReporter;
  /**
   * Extension-lifetime cancellation source. Cancelled in `deactivate()`
   * before any other cleanup so in-flight Oz CLI invocations terminate
   * promptly instead of being left orphaned by the host shutdown.
   */
  extensionLifetimeCts?: vscode.CancellationTokenSource;
  /** Cursor-only: whether we registered `vscode.cursor.mcp` entry. */
  cursorMcpRegistered?: boolean;
  /** Single-flight guard for Cursor MCP auto-registration. */
  cursorMcpRegistrationFlight?: Promise<void> | null;
  /** Startup orchestrator for deferred warmup tasks. */
  startup?: StartupCoordinator;
  /** Prevent duplicate warmup hint toasts. */
  startupWarmupHintShown?: boolean;
} = {};

/** Extension version sourced from `package.json` at activation time. */
function readExtensionVersion(context: vscode.ExtensionContext): string {
  const v = (context.extension?.packageJSON as { version?: unknown } | undefined)?.version;
  return typeof v === 'string' && v.length > 0 ? v : '0.0.0';
}

/**
 * Replace the user's home directory with `~` in a filesystem path before
 * logging. Avoids leaking the OS username in the OutputChannel (privacy:
 * B-L1). Best-effort — falls back to the original string when `os.homedir()`
 * is empty or not a prefix.
 */
function redactHome(p: string): string {
  if (typeof p !== 'string' || p.length === 0) { return p; }
  let home = '';
  try { home = os.homedir(); } catch { home = ''; }
  if (!home || home.length < 2) { return p; }
  // Normalise separators for Windows (`C:\Users\foo` vs forward slashes).
  const norm = (s: string) => s.replace(/\\/g, '/');
  const homeN = norm(home).replace(/\/+$/, '');
  const pN = norm(p);
  if (pN === homeN) { return '~'; }
  if (pN.startsWith(homeN + '/')) { return '~' + pN.slice(homeN.length); }
  return p;
}

/**
 * Type guard for `vscode.Uri`-shaped values restricted to the `warp://` scheme.
 *
 * Hardened (B-L7) to also validate `authority` and `path` so a crafted
 * `warp://attacker.com/...` URI cannot be passed to `vscode.env.openExternal`
 * via the public `ozBridge.openConversation` command. We accept only the two
 * shapes Warp itself emits: `warp://block/<id>` and `warp://action/<verb>?...`.
 */
function isWarpUri(value: unknown): value is vscode.Uri {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { scheme?: unknown; authority?: unknown; path?: unknown };
  if (typeof candidate.scheme !== 'string' || candidate.scheme.toLowerCase() !== 'warp') {
    return false;
  }
  const authority = typeof candidate.authority === 'string' ? candidate.authority.toLowerCase() : '';
  if (authority !== 'block' && authority !== 'action') {
    return false;
  }
  // path must start with '/' and contain at least one non-slash char
  return typeof candidate.path === 'string' && /^\/[^/].*/.test(candidate.path);
}

export function activate(context: vscode.ExtensionContext): void {
  // Startup log
  const outputChannel = vscode.window.createOutputChannel('OzBridge');
  context.subscriptions.push(outputChannel);
  initLogger(outputChannel, '[ozbridge]');
  const host = detectHost();

  const extensionVersion = readExtensionVersion(context);

  // ── Kill-switch (v1.0 deliverable T) ──────────────────────────────
  // Operator escape hatch for emergencies (critical regression in
  // production, supply-chain incident, etc.). When
  // `ozBridge.killSwitch.enabled === true` we skip every wiring
  // step and surface a single warning notification so users know
  // the extension is intentionally inert. The setting is workspace-
  // overridable so an org can ship it via shared `settings.json`.
  // No commands, tools, MCP server or chat participant are
  // registered — `deactivate()` remains safe to call.
  const killSwitchEnabled =
    vscode.workspace
      .getConfiguration('ozBridge')
      .get<boolean>('killSwitch.enabled', false) === true;
  if (killSwitchEnabled) {
    const reason =
      vscode.workspace.getConfiguration('ozBridge').get<string>('killSwitch.reason', '') || '';
    const detail = reason ? ` Reason: ${reason}` : '';
    logInfo(`[KILL-SWITCH] active — extension will not register any features.${detail}`);
    void vscode.window.showWarningMessage(
      `OzBridge is disabled by the kill-switch (ozBridge.killSwitch.enabled).${detail}`,
    );
    // Escape hatch: always available even when kill-switch is on, so users
    // are not trapped if the flag was set inadvertently (e.g. shared
    // workspace settings.json). The command resets the flag at Global
    // scope and offers a window reload to re-activate the extension.
    context.subscriptions.push(
      vscode.commands.registerCommand('ozBridge.killSwitch.disable', async () => {
        try {
          await vscode.workspace
            .getConfiguration('ozBridge')
            .update('killSwitch.enabled', false, vscode.ConfigurationTarget.Global);
          const reload = 'Reload Window';
          const action = await vscode.window.showInformationMessage(
            'OzBridge kill-switch disabled. Reload the window to re-activate the extension.',
            reload,
          );
          if (action === reload) {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        } catch (err) {
          logError(`Failed to disable kill-switch: ${getErrorMessage(err)}`);
          void vscode.window.showErrorMessage(
            `Failed to disable kill-switch: ${getErrorMessage(err)}`,
          );
        }
      }),
    );
    return;
  }

  // Initialize services.
  // WorkspaceConfigResolver loads `.warp/warp-bridge.yaml` from the workspace
  // corrente e offre override typed che vincono sui settings VS Code.
  state.workspaceConfigResolver = new WorkspaceConfigResolver(firstWorkspaceFolderPath());
  context.subscriptions.push(state.workspaceConfigResolver);
  if (typeof vscode.workspace.onDidChangeWorkspaceFolders === 'function') {
    context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        state.workspaceConfigResolver?.setWorkspaceRoot(firstWorkspaceFolderPath());
      }),
    );
  }
  state.configManager = new ConfigManager(state.workspaceConfigResolver);
  context.subscriptions.push(state.configManager);

  const cli = new OzCliService(state.configManager);
  // Broadcast extension shutdown to every spawned `oz` process. The token
  // source is cancelled in `deactivate()` before tracker/mcp disposal so
  // long-running CLI calls do not survive a host reload.
  state.extensionLifetimeCts = new vscode.CancellationTokenSource();
  cli.setExtensionToken(state.extensionLifetimeCts.token);
  context.subscriptions.push({
    dispose: () => {
      state.extensionLifetimeCts?.dispose();
    },
  });
  const ctx = new ContextCollector();
  // NOTE: cli/ctx are intentionally not pushed onto context.subscriptions:
  // OzCliService spawns one short-lived child process per call (with its
  // own cleanup) and ContextCollector is a stateless aggregator. Neither
  // owns long-lived OS resources, so there is no Disposable to release.
  state.runPoller = new RunPoller(cli, state.configManager);
  context.subscriptions.push({ dispose: () => state.runPoller?.disposeAll() });

  // Start the ActiveRunsTracker — event-driven feed for Status Bar and sidebar.
  // Created here (before the chat participant) so it can be threaded into
  // the cloud command, enabling immediate sidebar updates on terminal status.
  //
  // OPT-3: supplement the fallback polling timer (60 s) with a reactive
  // file-system watcher on ~/.warp/runs/**. The watcher triggers an immediate
  // `oz run list` poll whenever the Oz CLI writes new run-state files, cutting
  // observed latency from up to 10 s down to <1 s in the common case.
  const warpRunsDir = vscode.Uri.file(path.join(os.homedir(), '.warp', 'runs'));
  const warpRunsGlob = new vscode.RelativePattern(warpRunsDir, '**');
  state.tracker = new ActiveRunsTracker(cli, 60_000, [warpRunsGlob]);
  context.subscriptions.push(state.tracker);
  const ensureRunsTrackerStarted = () => {
    state.tracker?.start();
  };

  // Startup coordinator: keeps activate() lightweight and runs fragile
  // boot tasks in deferred, fail-open mode.
  state.startup = new StartupCoordinator(1500);
  context.subscriptions.push(state.startup);
  state.startupWarmupHintShown = false;

  const gateStartupReady = async (label: string): Promise<StartupGateResult> => {
    const startup = state.startup;
    if (!startup) {
      return 'degraded';
    }
    const gate = await startup.ensureReady({ softTimeoutMs: 1500 });
    if (gate === 'timeout' && !state.startupWarmupHintShown) {
      state.startupWarmupHintShown = true;
      void vscode.window.showInformationMessage(
        vscode.l10n.t('OzBridge is still starting up. Retrying now may work.'),
      );
      logInfo(`[startup] gate timeout while running "${label}".`);
    }
    return gate;
  };

  // Register command to open conversations directly in Warp (bypassing the browser).
  const openConvCmd = vscode.commands.registerCommand(
    'ozBridge.openConversation',
    async (uri: unknown) => {
      if (!isWarpUri(uri)) {
        await vscode.window.showErrorMessage(
          vscode.l10n.t('OzBridge: openConversation accepts only warp:// URIs.'),
        );
        return false;
      }
      return vscode.env.openExternal(uri);
    },
  );
  context.subscriptions.push(openConvCmd);

  // Register Chat Participant.
  registerChatParticipant(context, cli, ctx, state.configManager, state.runPoller, state.tracker);

  // Register Language Model Tools — Agent-Native integration.
  // These tools allow Copilot Agent mode to invoke Oz without @oz.
  // VS Code < 1.96 runtimes (missing `vscode.lm`) are handled with a graceful fallback.
  if (typeof vscode.lm?.registerTool === 'function') {
    registerOzTools(context, cli, state.configManager, ctx, state.runPoller);
  } else {
    logInfo('vscode.lm.registerTool not available — Language Model Tools not registered');
  }

  // Status Bar indicator $(cloud) OzBridge: N active
  const statusBar = new StatusBarManager(state.tracker);
  context.subscriptions.push(statusBar);

  // Sidebar TreeView: Active Runs / History / Schedules / Environments / MCP
  const treeProvider = new OzRunsTreeProvider(cli, state.tracker, context.globalState);
  context.subscriptions.push(treeProvider);
  const dragAndDropController = new RunTreeDragAndDropController();
  const runsTreeView = vscode.window.createTreeView('ozBridge.runsView', {
    treeDataProvider: treeProvider,
    // LOW-6: be explicit about the (default) single-selection behaviour
    // so future readers / linters don't mistake the omission for a TODO.
    canSelectMany: false,
    showCollapseAll: true,
    // OPT-5: allow dragging RunNode items to Copilot Chat.
    dragAndDropController,
  });
  context.subscriptions.push(runsTreeView);
  // MED-8: persist category collapse preference across reloads.
  // Guarded with `typeof` so test mocks of `createTreeView` that omit
  // these optional events (legacy fixtures) keep activating cleanly.
  if (typeof runsTreeView.onDidCollapseElement === 'function') {
    context.subscriptions.push(
      runsTreeView.onDidCollapseElement((e) => {
        if (e.element && (e.element as { kind?: string }).kind === 'category') {
          const cat = (e.element as { category: 'activeRuns' | 'history' | 'schedules' | 'environments' | 'mcp' | 'secrets' }).category;
          treeProvider.setCategoryCollapsed(cat, true);
        }
      }),
    );
  }
  if (typeof runsTreeView.onDidExpandElement === 'function') {
    context.subscriptions.push(
      runsTreeView.onDidExpandElement((e) => {
        if (e.element && (e.element as { kind?: string }).kind === 'category') {
          const cat = (e.element as { category: 'activeRuns' | 'history' | 'schedules' | 'environments' | 'mcp' | 'secrets' }).category;
          treeProvider.setCategoryCollapsed(cat, false);
        }
      }),
    );
  }
  context.subscriptions.push(
    runsTreeView.onDidChangeVisibility((event) => {
      if (event.visible) {
        ensureRunsTrackerStarted();
      }
    }),
  );
  for (const disposable of registerTreeCommands({ cli, tracker: state.tracker, provider: treeProvider })) {
    context.subscriptions.push(disposable);
  }

  // Warp handoff — apre un tab Warp con contesto tramite URI warp://
  for (const disposable of registerHandoffCommands({})) {
    context.subscriptions.push(disposable);
  }

  // Warp Drive source — filesystem fallback by default.
  // Do not call `oz drive` during normal activation/view rendering: current
  // Warp/Oz builds can interpret `drive` as a URL argument and return noisy
  // errors instead of a clean "subcommand unavailable" signal. The factory
  // still supports a CLI runner for tests/future gated rollout.
  state.driveSource = createOzBridgeDriveSource();

  // Warp Drive sidebar (view + context-menu commands).
  const driveTreeProvider = new OzDriveTreeProvider(state.driveSource);
  context.subscriptions.push(driveTreeProvider);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('ozBridge.driveView', driveTreeProvider),
  );
  for (const disposable of registerDriveCommands({
    source: state.driveSource,
    provider: driveTreeProvider,
  })) {
    context.subscriptions.push(disposable);
  }

  // Skill & Rules editor commands (new / edit / save-as-global / save-as-workspace).
  for (const disposable of registerSkillEditorCommands()) {
    context.subscriptions.push(disposable);
  }

  // Observability dashboard (v0.8 deliverable H).
  const runStats = new RunStatsService(cli);
  context.subscriptions.push(
    vscode.commands.registerCommand('ozBridge.dashboard.open', async () => {
      await gateStartupReady('ozBridge.dashboard.open');
      const panel = DashboardPanel.createOrShow(runStats);
      await panel.refresh();
    }),
  );

  // Failure triage (v0.8 deliverable I) — opt-in: requires vscode.lm host.
  const lmClient = createVsCodeLanguageModelClient();
  context.subscriptions.push(
    vscode.commands.registerCommand('ozBridge.triageFailure', async (runId?: string) => {
      await gateStartupReady('ozBridge.triageFailure');
      if (!lmClient) {
        await vscode.window.showWarningMessage(vscode.l10n.t('Failure triage requires VS Code 1.96+ with a Copilot chat model installed.'));
        return;
      }
      const id = typeof runId === 'string' && runId
        ? runId
        : await vscode.window.showInputBox({ prompt: vscode.l10n.t('Run id to triage'), ignoreFocusOut: true });
      if (!id) {
        return;
      }
      const triage = new FailureTriageService(cli, lmClient);
      try {
        const suggestion = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('OzBridge: triaging {0}…', id), cancellable: true },
          (_progress, token) => triage.triage(id, token),
        );
        const doc = await vscode.workspace.openTextDocument({
          language: 'markdown',
          content: [
            `# OzBridge — Failure triage`,
            `Run: \`${id}\``,
            '',
            `**Summary:** ${suggestion.summary}`,
            '',
            '## Suggested actions',
            ...(suggestion.actions.length === 0 ? ['(none provided)'] : suggestion.actions.map((a) => `- ${a}`)),
          ].join('\n'),
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (err) {
        const message = getErrorMessage(err);
        logError(`Triage failed: ${message}`);
        await vscode.window.showErrorMessage(vscode.l10n.t('OzBridge: triage failed: {0}', message));
      }
    }),
  );

  // Dataset export (v0.8 deliverable J) — stretch.
  const datasetExport = new DatasetExportService(cli);
  context.subscriptions.push(
    vscode.commands.registerCommand('ozBridge.exportDataset', async () => {
      await gateStartupReady('ozBridge.exportDataset');
      const pick = await vscode.window.showQuickPick(
        [
          { label: 'JSON Lines', value: 'jsonl' as DatasetFormat },
          { label: 'CSV', value: 'csv' as DatasetFormat },
        ],
        { placeHolder: vscode.l10n.t('Choose dataset format') },
      );
      if (!pick) {
        return;
      }
      try {
        const content = await datasetExport.export({ format: pick.value });
        const doc = await vscode.workspace.openTextDocument({
          language: pick.value === 'csv' ? 'csv' : 'jsonl',
          content,
        });
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        const message = getErrorMessage(err);
        logError(`Dataset export failed: ${message}`);
        await vscode.window.showErrorMessage(vscode.l10n.t('OzBridge: dataset export failed: {0}', message));
      }
    }),
  );

  // MCP server export — opt-in via ozBridge.mcpEnabled.
  state.mcp = new McpLifecycle(cli, state.configManager, extensionVersion);
  context.subscriptions.push({ dispose: () => { void state.mcp?.dispose(); } });
  for (const disposable of registerMcpCommands(state.mcp, state.configManager)) {
    context.subscriptions.push(disposable);
  }

  // Cursor integration (official): register OzBridge MCP server via `vscode.cursor.mcp.registerServer`.
  // This enables Cursor Agent to discover and call OzBridge tools through MCP (not via `@oz`).
  if (host === 'cursor' && canRegisterCursorMcpServers()) {
    // Ensure we always unregister when the extension is deactivated/reloaded.
    context.subscriptions.push({
      dispose: () => {
        if (state.cursorMcpRegistered) {
          try {
            unregisterCursorMcpServer(MCP_SERVER_NAME);
          } finally {
            state.cursorMcpRegistered = false;
          }
        }
      },
    });

    const ensureRegistered = async () => {
      if (state.cursorMcpRegistrationFlight) {
        await state.cursorMcpRegistrationFlight;
        return;
      }

      state.cursorMcpRegistrationFlight = (async () => {
        const cfgMgr = state.configManager;
        const mcp = state.mcp;
        if (!cfgMgr || !mcp) {
          return;
        }
        const cfg = cfgMgr.getConfig();

        if (cfg.mcpEnabled !== true) {
          const hintKey = 'ozBridge.cursor.mcpHintShown';
          const already = context.globalState.get<boolean>(hintKey, false);
          if (!already) {
            Promise.resolve(context.globalState.update(hintKey, true)).catch((err: unknown) => logError('globalState.update failed', getErrorMessage(err)));
            void vscode.window.showWarningMessage(
              vscode.l10n.t('OzBridge: Cursor integration uses MCP tools. Enable "ozBridge.mcpEnabled" to expose OzBridge tools to Cursor Agent.'),
            );
          }
          return;
        }

        // Ensure the local MCP server is running so we can provide a stable URL to Cursor.
        await mcp.start();
        const endpoint = buildLocalEndpoint(mcp, cfgMgr);
        registerCursorMcpServer(endpoint.url);
        state.cursorMcpRegistered = true;
      })();

      try {
        await state.cursorMcpRegistrationFlight;
      } finally {
        state.cursorMcpRegistrationFlight = null;
      }
    };

    // Run once after startup warmup and again when config changes.
    state.startup.enqueue('cursor.mcp.autoRegister', async () => {
      await ensureRegistered().catch((err) => logError(`Cursor MCP registration failed: ${getErrorMessage(err)}`));
    });
    state.configManager?.onConfigChanged(() => {
      void ensureRegistered().catch((err) => logError(`Cursor MCP registration failed: ${getErrorMessage(err)}`));
    });
  }

  // Deferred MCP auto-start (opt-in): keep activate() non-blocking.
  state.startup.enqueue('mcp.autoStart', async () => {
    const cfgMgr = state.configManager;
    const mcp = state.mcp;
    if (!cfgMgr || !mcp) {
      return;
    }
    if (!cfgMgr.getConfig().mcpEnabled) {
      return;
    }
    await mcp.start().catch((err) => {
      const msg = getErrorMessage(err);
      logError(`MCP start failed: ${msg}`);
      state.telemetry?.track('errorRaised', { kind: 'mcpStart' });
      void vscode.window.showWarningMessage(vscode.l10n.t('OzBridge: MCP server failed to start. {0}', msg));
    });
  });

  // Auxiliary command: focus the sidebar — invoked from the Status Bar click.
  context.subscriptions.push(
    vscode.commands.registerCommand(StatusBarManager.FOCUS_COMMAND, () => {
      ensureRunsTrackerStarted();
      return vscode.commands.executeCommand('workbench.view.extension.ozBridgeSidebar');
    }),
  );

  // I servizi leggono la config dinamicamente tramite IConfigManager,
  // quindi i cambi si applicano automaticamente alla prossima invocazione.
  state.configManager.onConfigChanged((newConfig) => {
    logInfo(`Configuration changed: model=${newConfig.defaultModel}, timeout=${newConfig.timeoutMs}`);
    // React to mcp-specific toggles without requiring an extension reload.
    if (state.mcp) {
      if (newConfig.mcpEnabled && !state.mcp.running) {
        state.mcp.start().catch((err) => {
          const msg = getErrorMessage(err);
          logError(`MCP start failed: ${msg}`);
          state.telemetry?.track('errorRaised', { kind: 'mcpStart' });
          void vscode.window.showWarningMessage(vscode.l10n.t('OzBridge: MCP server failed to start. {0}', msg));
        });
      } else if (!newConfig.mcpEnabled && state.mcp.running) {
        state.mcp.stop().catch((err) => {
          logError(`MCP stop failed: ${getErrorMessage(err)}`);
          state.telemetry?.track('errorRaised', { kind: 'mcpStop' });
        });
      }
    }
  });

  logInfo('Extension activated');
  logInfo(`Oz CLI path: ${redactHome(state.configManager.getConfig().ozPath)}`);

  // Telemetry is created in deferred startup; keep disposal wired now.
  context.subscriptions.push({
    dispose: () => {
      void state.telemetry?.dispose();
    },
  });

  // Telemetry bootstrap (deferred, fail-open).
  state.startup.enqueue('telemetry.bootstrap', async () => {
    const telemetryConnectionString = vscode.workspace
      .getConfiguration('ozBridge')
      .get<string>('telemetry.connectionString', '');
    state.telemetry = createTelemetryReporter({
      env: { isTelemetryEnabled: vscode.env.isTelemetryEnabled ?? false },
      connectionString: telemetryConnectionString,
      version: extensionVersion,
    });
    state.telemetry.track('extensionActivated', { version: extensionVersion });
  });

  // Walkthrough bootstrap (deferred, failure already non-fatal).
  state.startup.enqueue('walkthrough.bootstrap', async () => {
    await maybeOpenGettingStartedWalkthrough({ globalState: context.globalState }).catch((err) => {
      logError(`Walkthrough failed: ${getErrorMessage(err)}`);
    });
  });

  // Start deferred warmup asynchronously.
  state.startup.start();

  // Do not probe Oz CLI availability during activation. Commands and views
  // surface CLI availability/authentication problems lazily when the user
  // actually invokes Oz-backed functionality.
}

/**
 * Deactivation hook — disposes the {@link RunPoller} to cancel outstanding polls.
 *
 * `disposeAll()` is idempotent, so calling it here (in addition to
 * `context.subscriptions`) is safe.
 */
export async function deactivate(): Promise<void> {
  // Signal cancellation FIRST so any pending `oz` child processes are
  // killed before we tear down the trackers/MCP server that own them.
  try { state.extensionLifetimeCts?.cancel(); } catch { /* ignore */ }
  // A-L14: dispose the synchronous owners directly (no need to wrap them in
  // `Promise.resolve().then(...)` just to feed `Promise.allSettled`). Only
  // `mcp.dispose()` and `telemetry.dispose()` are async and may reject, so
  // run them in parallel via `allSettled` and ignore individual failures.
  try { state.runPoller?.disposeAll(); } catch { /* ignore */ }
  try { state.tracker?.dispose(); } catch { /* ignore */ }
  // X-M1 (audit v4): await telemetry flush+dispose so buffered AppInsights
  // events are not lost when VS Code tears the extension host down. A
  // 1.5 s race guards against a hung HTTP transport blocking deactivation.
  const telemetryShutdown = (async (): Promise<void> => {
    try { await state.telemetry?.dispose(); } catch { /* ignore */ }
  })();
  const telemetryGuard = new Promise<void>((resolve) => {
    setTimeout(resolve, 1500).unref?.();
  });
  await Promise.allSettled([
    Promise.race([telemetryShutdown, telemetryGuard]),
    state.mcp?.dispose().catch(() => undefined),
  ]);
}
