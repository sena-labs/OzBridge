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
import { registerOzTools } from './tools/index.js';
import { StatusBarManager } from './ui/statusBarItem.js';
import { OzRunsTreeProvider } from './ui/runsTreeProvider.js';
import { registerTreeCommands } from './ui/treeCommands.js';
import { registerHandoffCommands } from './ui/handoff.js';
import { McpLifecycle, registerMcpCommands } from './mcp/lifecycle.js';
import { createOzBridgeDriveSource } from './drive/driveSourceFactory.js';
import { OzCliDriveRunner } from './drive/ozCliDriveRunner.js';
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
} = {};

/** Extension version baked into the MCP `serverInfo`. Kept in sync with `package.json`. */
const EXTENSION_VERSION = '1.1.0';

function isWarpUri(value: unknown): value is { scheme: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { scheme?: unknown }).scheme === 'string' &&
    (value as { scheme: string }).scheme.toLowerCase() === 'warp'
  );
}

export function activate(context: vscode.ExtensionContext): void {
  // Startup log
  const outputChannel = vscode.window.createOutputChannel('OzBridge');
  context.subscriptions.push(outputChannel);
  initLogger(outputChannel, '[ozbridge]');

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

  // Inizializza servizi
  // Il WorkspaceConfigResolver legge `.warp/warp-bridge.yaml` dal workspace
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
  const ctx = new ContextCollector();
  state.runPoller = new RunPoller(cli, state.configManager);
  context.subscriptions.push({ dispose: () => state.runPoller?.disposeAll() });

  // Avvia l'ActiveRunsTracker — feed event-driven per Status Bar e sidebar.
  // Created here (before the chat participant) so it can be threaded into
  // the cloud command, enabling immediate sidebar updates on terminal status.
  state.tracker = new ActiveRunsTracker(cli);
  context.subscriptions.push(state.tracker);
  state.tracker.start();

  // Registra comando per aprire conversazioni direttamente in Warp (bypassa il browser)
  const openConvCmd = vscode.commands.registerCommand(
    'ozBridge.openConversation',
    async (uri: unknown) => {
      if (!isWarpUri(uri)) {
        await vscode.window.showErrorMessage(
          vscode.l10n.t('OzBridge: openConversation accepts only warp:// URIs.'),
        );
        return false;
      }
      return vscode.env.openExternal(uri as vscode.Uri);
    },
  );
  context.subscriptions.push(openConvCmd);

  // Registra Chat Participant
  registerChatParticipant(context, cli, ctx, state.configManager, state.runPoller, state.tracker);

  // Registra Language Model Tools — Agent-Native integration.
  // Questi tool permettono a Copilot Agent mode di invocare Oz senza @oz.
  // Il runtime di VS Code < 1.96 (`vscode.lm` assente) è gestito con graceful fallback.
  if (typeof vscode.lm?.registerTool === 'function') {
    registerOzTools(context, cli, state.configManager, ctx, state.runPoller);
  } else {
    logInfo('vscode.lm.registerTool not available — Language Model Tools not registered');
  }

  // Status Bar indicator $(cloud) OzBridge: N active
  const statusBar = new StatusBarManager(state.tracker);
  context.subscriptions.push(statusBar);

  // Sidebar TreeView: Active Runs / History / Schedules / Environments / MCP
  const treeProvider = new OzRunsTreeProvider(cli, state.tracker);
  context.subscriptions.push(treeProvider);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('ozBridge.runsView', treeProvider),
  );
  for (const disposable of registerTreeCommands({ cli, tracker: state.tracker, provider: treeProvider })) {
    context.subscriptions.push(disposable);
  }

  // Warp handoff — apre un tab Warp con contesto tramite URI warp://
  for (const disposable of registerHandoffCommands({})) {
    context.subscriptions.push(disposable);
  }

  // Warp Drive source — composite (Oz CLI primary, filesystem fallback).
  // The CLI runner transparently surfaces "unknown command" stderr from
  // older Oz binaries as `CliDriveNotAvailableError`, so the factory's
  // CompositeDriveSource falls back to the filesystem implementation
  // without any user-visible error.
  state.driveSource = createOzBridgeDriveSource({ runner: new OzCliDriveRunner(cli) });

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
    vscode.commands.registerCommand('ozBridge.dashboard.open', () => {
      DashboardPanel.createOrShow(runStats);
    }),
  );

  // Failure triage (v0.8 deliverable I) — opt-in: requires vscode.lm host.
  const lmClient = createVsCodeLanguageModelClient();
  context.subscriptions.push(
    vscode.commands.registerCommand('ozBridge.triageFailure', async (runId?: string) => {
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
  state.mcp = new McpLifecycle(cli, state.configManager, EXTENSION_VERSION);
  context.subscriptions.push({ dispose: () => { void state.mcp?.dispose(); } });
  for (const disposable of registerMcpCommands(state.mcp, state.configManager)) {
    context.subscriptions.push(disposable);
  }
  if (state.configManager.getConfig().mcpEnabled) {
    state.mcp.start().catch((err) => {
      logError(`MCP start failed: ${getErrorMessage(err)}`);
      state.telemetry?.track('errorRaised', { kind: 'mcpStart' });
    });
  }

  // Comando aggiuntivo: focus sulla sidebar — usato dal click sulla Status Bar.
  context.subscriptions.push(
    vscode.commands.registerCommand(StatusBarManager.FOCUS_COMMAND, () =>
      vscode.commands.executeCommand('workbench.view.extension.ozBridgeSidebar'),
    ),
  );

  // I servizi leggono la config dinamicamente tramite IConfigManager,
  // quindi i cambi si applicano automaticamente alla prossima invocazione.
  state.configManager.onConfigChanged((newConfig) => {
    logInfo(`Configuration changed: model=${newConfig.defaultModel}, timeout=${newConfig.timeoutMs}`);
    // React to mcp-specific toggles without requiring an extension reload.
    if (state.mcp) {
      if (newConfig.mcpEnabled && !state.mcp.running) {
        state.mcp.start().catch((err) => {
          logError(`MCP start failed: ${getErrorMessage(err)}`);
          state.telemetry?.track('errorRaised', { kind: 'mcpStart' });
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
  logInfo(`Oz CLI path: ${state.configManager.getConfig().ozPath}`);

  // Telemetry (v1.0 deliverable P) — strictly opt-in via VS Code's
  // global `telemetry.telemetryLevel` *and* an explicit AppInsights
  // connection string. Default `connectionString = ""` ⇒ noop transport.
  // No PII ever transits: see `src/services/telemetry.ts` and PRIVACY.md.
  const telemetryConnectionString = vscode.workspace
    .getConfiguration('ozBridge')
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
  maybeOpenGettingStartedWalkthrough({ globalState: context.globalState }).catch((err) => {
    logError(`Walkthrough failed: ${getErrorMessage(err)}`);
  });

  // Background availability check (does not block activation)
  cli.checkAvailability().then((avail) => {
    if (avail.available) {
      logInfo(`Oz CLI available: ${avail.version}`);
    } else {
      logInfo('WARNING: Oz CLI not found in PATH');
      const installLabel = vscode.l10n.t('Install Warp');
      Promise.resolve(vscode.window.showWarningMessage(
        vscode.l10n.t('OzBridge: Oz CLI not found. Install Warp to use @oz in chat.'),
        installLabel,
      )).then((action) => {
        if (action === installLabel) {
          vscode.env.openExternal(vscode.Uri.parse('https://www.warp.dev/download'));
        }
      }).catch((err: unknown) => {
        logError(`Failed to show install warning: ${getErrorMessage(err)}`);
      });
    }
  }).catch((err) => {
    logError(`Availability check failed: ${getErrorMessage(err)}`);
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
  return Promise.allSettled([
    Promise.resolve().then(() => state.runPoller?.disposeAll()),
    Promise.resolve().then(() => state.tracker?.dispose()),
    Promise.resolve().then(() => state.mcp?.dispose()),
  ]).then(() => undefined);
}
