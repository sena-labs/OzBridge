import * as vscode from 'vscode';
import { IConfigManager } from '../types/index.js';
import { WarpTreeNode } from './runsTreeProvider.js';

/**
 * Public command IDs contributed by the handoff surface.
 * Kept here so both `contributes.commands` in `package.json` and the
 * handlers registered at runtime share a single source of truth.
 */
export const HANDOFF_COMMANDS = {
  /** Command Palette entry: asks the user for a prompt to seed Warp with. */
  palette: 'warpBridge.handoff',
  /** Sidebar context menu entry on run nodes. */
  tree: 'warpBridge.tree.handoff',
} as const;

/**
 * Options accepted by {@link buildHandoffUri}.
 *
 * Exactly one of `runId` or `prompt` should be provided; if both are present,
 * `prompt` wins and the run id is pre-pended as context in square brackets.
 */
export interface HandoffOptions {
  /** Optional workspace directory to open Warp in. */
  workspacePath?: string;
  /** If present, hands off `oz run get <runId>` for inspection. */
  runId?: string;
  /** If present, hands off `oz agent run --prompt "<prompt>"`. */
  prompt?: string;
}

/**
 * Builds a `warp://action/new_tab?path=…&command=…` URI for the Warp native
 * terminal.
 *
 * The Warp URI scheme accepts:
 * - `path` — initial working directory for the new tab
 * - `command` — shell command to execute on open (URL-encoded)
 *
 * This helper is deterministic and has no side effects so it is trivial to
 * unit-test. Actual URI opening is performed by {@link openHandoff}.
 */
export function buildHandoffUri(options: HandoffOptions): vscode.Uri {
  const command = buildHandoffCommand(options);
  const params = new URLSearchParams();
  if (options.workspacePath) { params.set('path', options.workspacePath); }
  params.set('command', command);
  return vscode.Uri.parse(`warp://action/new_tab?${params.toString()}`);
}

/**
 * Builds just the shell command that Warp will execute when the handoff URI
 * is opened. Exposed separately so the fallback dialog can display it.
 */
export function buildHandoffCommand(options: HandoffOptions): string {
  if (options.prompt && options.runId) {
    return `oz agent run --prompt ${shellQuote(`[CONTINUING ${options.runId}] ${options.prompt}`)}`;
  }
  if (options.prompt) {
    return `oz agent run --prompt ${shellQuote(options.prompt)}`;
  }
  if (options.runId) {
    return `oz run get ${shellQuote(options.runId)}`;
  }
  return 'oz agent run';
}

/**
 * Opens the built handoff URI through VS Code's external URI opener. If the
 * platform cannot resolve the `warp://` scheme (e.g. Warp not installed), it
 * falls back to a modal that shows the command so the user can paste it into
 * a terminal manually.
 */
export async function openHandoff(options: HandoffOptions): Promise<boolean> {
  const uri = buildHandoffUri(options);
  try {
    const ok = await vscode.env.openExternal(uri);
    if (ok) { return true; }
  } catch {
    // fall through to fallback modal
  }
  await showHandoffFallback(options);
  return false;
}

/**
 * Displays a modal with the exact command the user can copy/paste into Warp
 * when the `warp://` URI handler is not available on the platform.
 */
export async function showHandoffFallback(options: HandoffOptions): Promise<void> {
  const command = buildHandoffCommand(options);
  const copy = vscode.l10n.t('Copy command');
  const choice = await vscode.window.showWarningMessage(
    vscode.l10n.t('Warp Bridge: could not open Warp via the `warp://` URL scheme. Install Warp ≥ 0.2024.x or copy the command and run it manually.'),
    { modal: true, detail: command },
    copy,
  );
  if (choice === copy) {
    await vscode.env.clipboard.writeText(command);
  }
}

/**
 * Dependencies used by the palette and tree handoff commands.
 */
export interface HandoffDeps {
  cfgMgr: IConfigManager;
  /**
   * Returns the first workspace folder path if available, else undefined.
   * Extracted as a dependency so tests can inject a deterministic value.
   */
  getWorkspacePath?: () => string | undefined;
}

/**
 * Registers every command owned by the handoff surface. The returned
 * disposables can be pushed into `context.subscriptions`.
 */
export function registerHandoffCommands(deps: HandoffDeps): vscode.Disposable[] {
  const getWorkspace = deps.getWorkspacePath ?? defaultWorkspacePath;

  return [
    vscode.commands.registerCommand(HANDOFF_COMMANDS.palette, async () => {
      const prompt = await vscode.window.showInputBox({
        title: 'Warp Bridge · Hand off to Warp',
        prompt: 'Command or prompt to seed Warp with (leave empty for a fresh terminal)',
        placeHolder: 'e.g. fix the failing test in src/auth/login.ts',
      });
      if (prompt === undefined) { return; }
      await openHandoff({
        workspacePath: getWorkspace(),
        prompt: prompt.trim() || undefined,
      });
    }),

    vscode.commands.registerCommand(HANDOFF_COMMANDS.tree, async (node?: WarpTreeNode) => {
      if (!node || node.kind !== 'run') {
        await vscode.window.showWarningMessage(vscode.l10n.t('Warp Bridge: select a run node to hand off.'));
        return;
      }
      await openHandoff({
        workspacePath: getWorkspace(),
        runId: node.runId,
      });
    }),
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultWorkspacePath(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}

/**
 * Quotes a value for inclusion in a POSIX-style shell command. We always wrap
 * the value in double quotes and escape inner `"`, `$`, `` ` `` and `\`.
 * Warp spawns its own login shell on each tab so POSIX quoting is the right
 * default across macOS/Linux; on Windows Warp still parses double quotes.
 */
function shellQuote(value: string): string {
  const escaped = value.replace(/[\\$"`]/g, (ch) => `\\${ch}`);
  return `"${escaped}"`;
}
