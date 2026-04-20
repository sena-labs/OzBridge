import * as vscode from 'vscode';
import { IOzCliService } from '../types/index.js';
import { ActiveRunsTracker } from '../services/activeRunsTracker.js';
import { WarpRunsTreeProvider, WarpTreeNode } from './runsTreeProvider.js';

/**
 * IDs of every command contributed by the sidebar surface. Kept here so both
 * the `contributes.commands` manifest and the handlers stay in sync.
 */
export const TREE_COMMANDS = {
  refresh: 'warpBridge.tree.refresh',
  copyId: 'warpBridge.tree.copyId',
  openInBrowser: 'warpBridge.tree.openInBrowser',
  showRun: 'warpBridge.tree.showRun',
  pauseSchedule: 'warpBridge.tree.pauseSchedule',
  unpauseSchedule: 'warpBridge.tree.unpauseSchedule',
  deleteSchedule: 'warpBridge.tree.deleteSchedule',
} as const;

export interface TreeCommandDeps {
  cli: IOzCliService;
  tracker: ActiveRunsTracker;
  provider: WarpRunsTreeProvider;
}

/**
 * Registers every sidebar-related command with VS Code and returns the list
 * of disposables so the caller can push them into `context.subscriptions`.
 */
export function registerTreeCommands(deps: TreeCommandDeps): vscode.Disposable[] {
  const { cli, tracker, provider } = deps;

  return [
    vscode.commands.registerCommand(TREE_COMMANDS.refresh, async () => {
      provider.refresh();
      await tracker.refresh();
    }),

    vscode.commands.registerCommand(TREE_COMMANDS.copyId, async (node?: WarpTreeNode) => {
      const id = extractId(node);
      if (!id) {
        await vscode.window.showWarningMessage(vscode.l10n.t('Warp Bridge: nothing to copy for this item.'));
        return;
      }
      await vscode.env.clipboard.writeText(id);
      await vscode.window.showInformationMessage(vscode.l10n.t('Copied `{0}` to clipboard.', id));
    }),

    vscode.commands.registerCommand(TREE_COMMANDS.openInBrowser, async (node?: WarpTreeNode) => {
      const url = extractUrl(node);
      if (!url) {
        await vscode.window.showWarningMessage(vscode.l10n.t('Warp Bridge: no browser URL for this item.'));
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }),

    vscode.commands.registerCommand(TREE_COMMANDS.showRun, async (runId?: string) => {
      if (!runId) { return; }
      // Delegate to the chat participant: open the chat with a /status <id> prompt.
      // The user can hit Enter to execute, giving them a chance to inspect first.
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: `@warp /status ${runId}`,
      });
    }),

    vscode.commands.registerCommand(TREE_COMMANDS.pauseSchedule, async (node?: WarpTreeNode) => {
      const id = scheduleId(node);
      if (!id) { return; }
      try {
        await cli.schedulePause(id);
        await vscode.window.showInformationMessage(vscode.l10n.t('Paused schedule `{0}`.', id));
        provider.refresh();
      } catch (err) {
        await vscode.window.showErrorMessage(vscode.l10n.t('Failed to pause schedule: {0}', errorMessage(err)));
      }
    }),

    vscode.commands.registerCommand(TREE_COMMANDS.unpauseSchedule, async (node?: WarpTreeNode) => {
      const id = scheduleId(node);
      if (!id) { return; }
      try {
        await cli.scheduleUnpause(id);
        await vscode.window.showInformationMessage(vscode.l10n.t('Resumed schedule `{0}`.', id));
        provider.refresh();
      } catch (err) {
        await vscode.window.showErrorMessage(vscode.l10n.t('Failed to resume schedule: {0}', errorMessage(err)));
      }
    }),

    vscode.commands.registerCommand(TREE_COMMANDS.deleteSchedule, async (node?: WarpTreeNode) => {
      const id = scheduleId(node);
      if (!id) { return; }
      const confirm = await vscode.window.showWarningMessage(
        vscode.l10n.t('Delete schedule `{0}`? This cannot be undone.', id),
        { modal: true },
        vscode.l10n.t('Delete'),
      );
      if (confirm !== vscode.l10n.t('Delete')) { return; }
      try {
        await cli.scheduleDelete(id);
        await vscode.window.showInformationMessage(vscode.l10n.t('Deleted schedule `{0}`.', id));
        provider.refresh();
      } catch (err) {
        await vscode.window.showErrorMessage(vscode.l10n.t('Failed to delete schedule: {0}', errorMessage(err)));
      }
    }),
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractId(node: WarpTreeNode | undefined): string | undefined {
  if (!node) { return undefined; }
  switch (node.kind) {
    case 'run': return node.runId;
    case 'schedule': return node.schedule.id;
    case 'environment': return node.environment.id;
    case 'mcp': return node.server.uuid;
    default: return undefined;
  }
}

function extractUrl(node: WarpTreeNode | undefined): string | undefined {
  if (!node) { return undefined; }
  if (node.kind === 'run') {
    return `https://app.warp.dev/agents/${encodeURIComponent(node.runId)}`;
  }
  return undefined;
}

function scheduleId(node: WarpTreeNode | undefined): string | undefined {
  return node?.kind === 'schedule' ? node.schedule.id : undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
