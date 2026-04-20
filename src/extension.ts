import * as vscode from 'vscode';
import { ConfigManager } from './services/configManager.js';
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
import { initLogger, logInfo, logError } from './services/logger.js';

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
  runPoller?: RunPoller;
  tracker?: ActiveRunsTracker;
} = {};

export function activate(context: vscode.ExtensionContext): void {
  // Startup log
  const outputChannel = vscode.window.createOutputChannel('Warp Bridge');
  context.subscriptions.push(outputChannel);
  initLogger(outputChannel, '[warp-vsc-bridge]');

  // Inizializza servizi
  state.configManager = new ConfigManager();
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
  });

  logInfo('Extension activated');
  logInfo(`Oz CLI path: ${state.configManager.getConfig().ozPath}`);

  // Background availability check (does not block activation)
  cli.checkAvailability().then((avail) => {
    if (avail.available) {
      logInfo(`Oz CLI available: ${avail.version}`);
    } else {
      logInfo('WARNING: Oz CLI not found in PATH');
      const installLabel = 'Install Warp';
      vscode.window.showWarningMessage(
        'Warp Bridge: Oz CLI not found. Install Warp to use @warp in chat.',
        installLabel,
      ).then((action) => {
        if (action === installLabel) {
          vscode.env.openExternal(vscode.Uri.parse('https://www.warp.dev/download'));
        }
      });
    }
  }).catch((err) => {
    logError(`Availability check failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

/**
 * Deactivation hook — disposes the {@link RunPoller} to cancel outstanding polls.
 *
 * `disposeAll()` is idempotent, so calling it here (in addition to
 * `context.subscriptions`) is safe.
 */
export function deactivate(): void {
  // RunPoller è ora disposto anche via context.subscriptions,
  // ma disposeAll() è idempotente — sicuro chiamare in entrambi i punti.
  state.runPoller?.disposeAll();
  state.tracker?.dispose();
}
