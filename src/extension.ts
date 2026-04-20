import * as vscode from 'vscode';
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
import { registerWarpTools } from './tools/index.js';
import { StatusBarManager } from './ui/statusBarItem.js';
import { WarpRunsTreeProvider } from './ui/runsTreeProvider.js';
import { registerTreeCommands } from './ui/treeCommands.js';
import { registerHandoffCommands } from './ui/handoff.js';
import { McpLifecycle, registerMcpCommands } from './mcp/lifecycle.js';
import { createWarpDriveSource } from './drive/driveSourceFactory.js';
import { OzCliDriveRunner } from './drive/ozCliDriveRunner.js';
import { IWarpDriveSource } from './drive/warpDriveSource.js';
import { WarpDriveTreeProvider } from './ui/driveTreeProvider.js';
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

/**
 * Entry point of the Warp Bridge extension.
 *
 * Initialises all core services ({@link ConfigManager}, {@link OzCliService},
 * {@link ContextCollector}, {@link RunPoller}), registers the `@warp` Chat
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
  driveSource?: IWarpDriveSource;
  telemetry?: ITelemetryReporter;
} = {};

/** Extension version baked into the MCP `serverInfo`. Kept in sync with `package.json`. */
const EXTENSION_VERSION = '0.9.0';

export function activate(context: vscode.ExtensionContext): void {
  // Startup log
  const outputChannel = vscode.window.createOutputChannel('Warp Bridge');
  context.subscriptions.push(outputChannel);
  initLogger(outputChannel, '[warp-vsc-bridge]');

  // Inizializza servizi
  // Il WorkspaceConfigResolver legge `.warp/warp-bridge.yaml` dal workspace
  // corrente e offre override typed che vincono sui settings VS Code.
  state.workspaceConfigResolver = new WorkspaceConfigResolver(firstWorkspaceFolderPath());
  context.subscriptions.push(state.workspaceConfigResolver);
  state.configManager = new ConfigManager(state.workspaceConfigResolver);
  context.subscriptions.push(state.configManager);

  const cli = new OzCliService(state.configManager);
  const ctx = new ContextCollector();
  state.runPoller = new RunPoller(cli, state.configManager);
  context.subscriptions.push({ dispose: () => state.runPoller?.disposeAll() });

  // Registra comando per aprire conversazioni direttamente in Warp (bypassa il browser)
  const openConvCmd = vscode.commands.registerCommand(
    'warpBridge.openConversation',
    (uri: vscode.Uri) => vscode.env.openExternal(uri),
  );
  context.subscriptions.push(openConvCmd);

  // Registra Chat Participant
  registerChatParticipant(context, cli, ctx, state.configManager, state.runPoller);

  // Registra Language Model Tools — Agent-Native integration.
  // Questi tool permettono a Copilot Agent mode di invocare Oz senza @warp.
  // Il runtime di VS Code < 1.96 (`vscode.lm` assente) è gestito con graceful fallback.
  if (typeof vscode.lm?.registerTool === 'function') {
    registerWarpTools(context, cli, state.configManager, ctx, state.runPoller);
  } else {
    logInfo('vscode.lm.registerTool not available — Language Model Tools not registered');
  }

  // Avvia l'ActiveRunsTracker — feed event-driven per Status Bar e sidebar.
  state.tracker = new ActiveRunsTracker(cli);
  context.subscriptions.push(state.tracker);
  state.tracker.start();

  // Status Bar indicator $(cloud) Warp: N active
  const statusBar = new StatusBarManager(state.tracker);
  context.subscriptions.push(statusBar);

  // Sidebar TreeView: Active Runs / History / Schedules / Environments / MCP
  const treeProvider = new WarpRunsTreeProvider(cli, state.tracker);
  context.subscriptions.push(treeProvider);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('warpBridge.runsView', treeProvider),
  );
  for (const disposable of registerTreeCommands({ cli, tracker: state.tracker, provider: treeProvider })) {
    context.subscriptions.push(disposable);
  }

  // Warp handoff — apre un tab Warp con contesto tramite URI warp://
  for (const disposable of registerHandoffCommands({ cfgMgr: state.configManager })) {
    context.subscriptions.push(disposable);
  }

  // Warp Drive source — composite (Oz CLI primary, filesystem fallback).
  // The CLI runner transparently surfaces "unknown command" stderr from
  // older Oz binaries as `CliDriveNotAvailableError`, so the factory's
  // CompositeDriveSource falls back to the filesystem implementation
  // without any user-visible error.
  state.driveSource = createWarpDriveSource({ runner: new OzCliDriveRunner(cli) });

  // Warp Drive sidebar (view + context-menu commands).
  const driveTreeProvider = new WarpDriveTreeProvider(state.driveSource);
  context.subscriptions.push(driveTreeProvider);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('warpBridge.driveView', driveTreeProvider),
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
    vscode.commands.registerCommand('warpBridge.dashboard.open', () => {
      DashboardPanel.createOrShow(runStats);
    }),
  );

  // Failure triage (v0.8 deliverable I) — opt-in: requires vscode.lm host.
  const lmClient = createVsCodeLanguageModelClient();
  context.subscriptions.push(
    vscode.commands.registerCommand('warpBridge.triageFailure', async (runId?: string) => {
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
          { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Warp: triaging {0}…', id), cancellable: true },
          (_progress, token) => triage.triage(id, token),
        );
        const doc = await vscode.workspace.openTextDocument({
          language: 'markdown',
          content: [
            `# Warp Bridge — Failure triage`,
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
        const message = err instanceof Error ? err.message : String(err);
        logError(`Triage failed: ${message}`);
        await vscode.window.showErrorMessage(vscode.l10n.t('Warp triage failed: {0}', message));
      }
    }),
  );

  // Dataset export (v0.8 deliverable J) — stretch.
  const datasetExport = new DatasetExportService(cli);
  context.subscriptions.push(
    vscode.commands.registerCommand('warpBridge.exportDataset', async () => {
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
        const message = err instanceof Error ? err.message : String(err);
        logError(`Dataset export failed: ${message}`);
        await vscode.window.showErrorMessage(vscode.l10n.t('Warp dataset export failed: {0}', message));
      }
    }),
  );

  // MCP server export — opt-in via warpBridge.mcpEnabled.
  state.mcp = new McpLifecycle(cli, state.configManager, EXTENSION_VERSION);
  context.subscriptions.push({ dispose: () => { void state.mcp?.dispose(); } });
  for (const disposable of registerMcpCommands(state.mcp, state.configManager)) {
    context.subscriptions.push(disposable);
  }
  if (state.configManager.getConfig().mcpEnabled) {
    void state.mcp.start();
  }

  // Comando aggiuntivo: focus sulla sidebar — usato dal click sulla Status Bar.
  context.subscriptions.push(
    vscode.commands.registerCommand(StatusBarManager.FOCUS_COMMAND, () =>
      vscode.commands.executeCommand('workbench.view.extension.warpBridgeSidebar'),
    ),
  );

  // I servizi leggono la config dinamicamente tramite IConfigManager,
  // quindi i cambi si applicano automaticamente alla prossima invocazione.
  state.configManager.onConfigChanged((newConfig) => {
    logInfo(`Configuration changed: model=${newConfig.defaultModel}, timeout=${newConfig.timeoutMs}`);
    // React to mcp-specific toggles without requiring an extension reload.
    if (state.mcp) {
      if (newConfig.mcpEnabled && !state.mcp.running) {
        void state.mcp.start();
      } else if (!newConfig.mcpEnabled && state.mcp.running) {
        void state.mcp.stop();
      }
    }
  });

  logInfo('Extension activated');
  logInfo(`Oz CLI path: ${state.configManager.getConfig().ozPath}`);

  // Telemetry (v1.0 deliverable P) — strictly opt-in via VS Code's
  // global `telemetry.telemetryLevel` *and* an explicit AppInsights
  // connection string. Default `connectionString = ""` ⇒ noop transport.
  // No PII ever transits: see `src/services/telemetry.ts` and PRIVACY.md.
  const telemetryConnectionString = vscode.workspace
    .getConfiguration('warpBridge')
    .get<string>('telemetry.connectionString', '');
  state.telemetry = createTelemetryReporter({
    env: { isTelemetryEnabled: vscode.env.isTelemetryEnabled ?? false },
    connectionString: telemetryConnectionString,
    version: EXTENSION_VERSION,
  });
  state.telemetry.track('extensionActivated', { version: EXTENSION_VERSION });
  context.subscriptions.push({
    dispose: () => {
      void state.telemetry?.dispose();
    },
  });

  // First-activation Getting Started walkthrough (gated via globalState so
  // it opens at most once per install; failure is non-fatal).
  void maybeOpenGettingStartedWalkthrough({ globalState: context.globalState });

  // Background availability check (does not block activation)
  cli.checkAvailability().then((avail) => {
    if (avail.available) {
      logInfo(`Oz CLI available: ${avail.version}`);
    } else {
      logInfo('WARNING: Oz CLI not found in PATH');
      const installLabel = vscode.l10n.t('Install Warp');
      vscode.window.showWarningMessage(
        vscode.l10n.t('Warp Bridge: Oz CLI not found. Install Warp to use @warp in chat.'),
        installLabel,
      ).then((action) => {
        if (action === installLabel) {
          vscode.env.openExternal(vscode.Uri.parse('https://www.warp.dev/download'));
        }
      });
    }
  }).catch((err) => {
    logError(`Availability check failed: ${err instanceof Error ? err.message : String(err)}`);
    state.telemetry?.track('errorRaised', { kind: 'availabilityCheck' });
  });
}

/**
 * Deactivation hook — disposes the {@link RunPoller} to cancel outstanding polls.
 *
 * `disposeAll()` is idempotent, so calling it here (in addition to
 * `context.subscriptions`) is safe.
 */
export function deactivate(): Promise<void> | void {
  // RunPoller è ora disposto anche via context.subscriptions,
  // ma disposeAll() è idempotente — sicuro chiamare in entrambi i punti.
  state.runPoller?.disposeAll();
  state.tracker?.dispose();
  // The MCP server owns an open socket; await its disposal so the host can
  // exit cleanly on reload/uninstall.
  return state.mcp?.dispose();
}
