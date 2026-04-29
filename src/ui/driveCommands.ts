import * as vscode from 'vscode';
import { IDriveSource } from '../drive/warpDriveSource.js';
import { OzDriveTreeProvider, DriveTreeNode } from './driveTreeProvider.js';

// Rebrand aliases for in-file usage; original names retained for legacy refs.
type IWarpDriveSource = IDriveSource;
const WarpDriveTreeProvider = OzDriveTreeProvider;
type WarpDriveTreeProvider = OzDriveTreeProvider;

/** Command IDs contributed by the Warp Drive sidebar surface. */
export const DRIVE_COMMANDS = {
  refresh: 'ozBridge.drive.refresh',
  insertIntoChat: 'ozBridge.drive.insertIntoChat',
  copyContent: 'ozBridge.drive.copyContent',
  openInEditor: 'ozBridge.drive.openInEditor',
} as const;

export interface DriveCommandDeps {
  source: IWarpDriveSource;
  provider: WarpDriveTreeProvider;
}

/**
 * Registers every Warp Drive sidebar command. Returned disposables
 * should be pushed into `context.subscriptions`.
 *
 * Every command that operates on a node gracefully handles the
 * "invoked without a selection" case by showing a friendly warning —
 * this happens when the user triggers the command from the palette
 * rather than a context menu.
 */
export function registerDriveCommands(deps: DriveCommandDeps): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(DRIVE_COMMANDS.refresh, () => {
      deps.provider.refresh();
    }),

    vscode.commands.registerCommand(DRIVE_COMMANDS.insertIntoChat, async (node?: DriveTreeNode) => {
      const entry = getEntry(node);
      if (!entry) {
        await vscode.window.showWarningMessage(vscode.l10n.t('Select a Warp Drive entry to insert into chat.'));
        return;
      }
      let body: string;
      try {
        body = await deps.source.read(entry.id);
      } catch (err) {
        await vscode.window.showErrorMessage(vscode.l10n.t('Warp Drive read failed: {0}', errMsg(err)));
        return;
      }
      const preview = body.length > 1500 ? `${body.slice(0, 1500)}\n… (truncated)` : body;
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: `@oz /run ${preview}`,
      });
    }),

    vscode.commands.registerCommand(DRIVE_COMMANDS.copyContent, async (node?: DriveTreeNode) => {
      const entry = getEntry(node);
      if (!entry) {
        await vscode.window.showWarningMessage(vscode.l10n.t('Select a Warp Drive entry to copy.'));
        return;
      }
      try {
        const body = await deps.source.read(entry.id);
        await vscode.env.clipboard.writeText(body);
        await vscode.window.showInformationMessage(vscode.l10n.t('Copied {0} to clipboard.', entry.name));
      } catch (err) {
        await vscode.window.showErrorMessage(vscode.l10n.t('Warp Drive read failed: {0}', errMsg(err)));
      }
    }),

    vscode.commands.registerCommand(DRIVE_COMMANDS.openInEditor, async (node?: DriveTreeNode) => {
      const entry = getEntry(node);
      if (!entry) {
        await vscode.window.showWarningMessage(vscode.l10n.t('Select a Warp Drive entry to open.'));
        return;
      }
      // Filesystem entries carry an absolute path as the id; we can
      // open them directly in the built-in editor.
      if (entry.source === 'filesystem') {
        try {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(entry.id));
          await vscode.window.showTextDocument(doc);
        } catch (err) {
          await vscode.window.showErrorMessage(vscode.l10n.t('Failed to open {0}: {1}', entry.name, errMsg(err)));
        }
        return;
      }
      // CLI entries don't live on disk — fall back to an untitled
      // markdown document seeded with the content.
      try {
        const body = await deps.source.read(entry.id);
        const doc = await vscode.workspace.openTextDocument({
          content: body,
          language: 'markdown',
        });
        await vscode.window.showTextDocument(doc);
      } catch (err) {
        await vscode.window.showErrorMessage(vscode.l10n.t('Failed to open {0}: {1}', entry.name, errMsg(err)));
      }
    }),
  ];
}

function getEntry(node: DriveTreeNode | undefined) {
  return node?.kind === 'entry' ? node.entry : undefined;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
