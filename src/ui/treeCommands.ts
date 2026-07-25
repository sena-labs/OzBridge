import * as vscode from 'vscode';
import { IOzCliService } from '../types/index.js';
import { ActiveRunsTracker } from '../services/activeRunsTracker.js';
import { OzRunsTreeProvider, OzTreeNode } from './runsTreeProvider.js';

// Rebrand aliases for in-file usage; original names retained for legacy refs.
type WarpRunsTreeProvider = OzRunsTreeProvider;
type WarpTreeNode = OzTreeNode;

/**
 * IDs of every command contributed by the sidebar surface. Kept here so both
 * the `contributes.commands` manifest and the handlers stay in sync.
 */
export const TREE_COMMANDS = {
  refresh: 'ozBridge.tree.refresh',
  copyId: 'ozBridge.tree.copyId',
  openInBrowser: 'ozBridge.tree.openInBrowser',
  showRun: 'ozBridge.tree.showRun',
  pauseSchedule: 'ozBridge.tree.pauseSchedule',
  unpauseSchedule: 'ozBridge.tree.unpauseSchedule',
  deleteSchedule: 'ozBridge.tree.deleteSchedule',
  editSchedule: 'ozBridge.tree.editSchedule',
  downloadArtifact: 'ozBridge.tree.downloadArtifact',
  createSecret: 'ozBridge.tree.createSecret',
  updateSecret: 'ozBridge.tree.updateSecret',
  deleteSecret: 'ozBridge.tree.deleteSecret',
  copySecretName: 'ozBridge.tree.copySecretName',
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
      try {
        provider.refresh();
        await tracker.refresh();
      } catch (err) {
        await vscode.window.showErrorMessage(vscode.l10n.t('OzBridge: refresh failed: {0}', errorMessage(err)));
      }
    }),

    vscode.commands.registerCommand(TREE_COMMANDS.copyId, async (node?: WarpTreeNode) => {
      const id = extractId(node);
      if (!id) {
        await vscode.window.showWarningMessage(vscode.l10n.t('OzBridge: nothing to copy for this item.'));
        return;
      }
      await vscode.env.clipboard.writeText(id);
      await vscode.window.showInformationMessage(vscode.l10n.t('Copied `{0}` to clipboard.', id));
    }),

    vscode.commands.registerCommand(TREE_COMMANDS.openInBrowser, async (node?: WarpTreeNode) => {
      const url = extractUrl(node);
      if (!url) {
        await vscode.window.showWarningMessage(vscode.l10n.t('OzBridge: no browser URL for this item.'));
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }),

    vscode.commands.registerCommand(TREE_COMMANDS.showRun, async (runId?: string) => {
      if (!runId) { return; }
      // Delegate to the chat participant: open the chat with a /status <id> prompt.
      // The user can hit Enter to execute, giving them a chance to inspect first.
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: `@oz /status ${runId}`,
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

    vscode.commands.registerCommand(TREE_COMMANDS.editSchedule, async (node?: WarpTreeNode) => {
      const sched = node?.kind === 'schedule' ? node.schedule : undefined;
      if (!sched) { return; }
      // Multi-step InputBox flow: name → cron → prompt. Empty input on
      // any step preserves the existing value; pressing Escape aborts.
      const newName = await vscode.window.showInputBox({
        title: vscode.l10n.t('Edit schedule — name'),
        value: sched.name,
        prompt: vscode.l10n.t('Schedule name (leave unchanged to keep current).'),
        ignoreFocusOut: true,
      });
      if (newName === undefined) { return; }

      const newCron = await vscode.window.showInputBox({
        title: vscode.l10n.t('Edit schedule — cron'),
        value: sched.cron,
        prompt: vscode.l10n.t('Cron expression (e.g. `0 9 * * *`).'),
        ignoreFocusOut: true,
      });
      if (newCron === undefined) { return; }

      const newPrompt = await vscode.window.showInputBox({
        title: vscode.l10n.t('Edit schedule — prompt'),
        value: sched.prompt,
        prompt: vscode.l10n.t('Prompt sent to the agent on every trigger.'),
        ignoreFocusOut: true,
      });
      if (newPrompt === undefined) { return; }

      // Only forward the fields that actually changed so the upstream
      // CLI does not log no-op edits, and so omitted-value validation
      // (e.g. empty cron rejecting) never trips on the unchanged path.
      const updates: { name?: string; cron?: string; prompt?: string } = {};
      if (newName.trim() && newName !== sched.name) { updates.name = newName.trim(); }
      if (newCron.trim() && newCron !== sched.cron) { updates.cron = newCron.trim(); }
      if (newPrompt !== sched.prompt) { updates.prompt = newPrompt; }
      if (Object.keys(updates).length === 0) {
        await vscode.window.showInformationMessage(vscode.l10n.t('No changes to apply.'));
        return;
      }

      try {
        await cli.scheduleUpdate({ id: sched.id, ...updates });
        await vscode.window.showInformationMessage(vscode.l10n.t('Updated schedule `{0}`.', sched.id));
        provider.refresh();
      } catch (err) {
        await vscode.window.showErrorMessage(vscode.l10n.t('Failed to update schedule: {0}', errorMessage(err)));
      }
    }),

    vscode.commands.registerCommand(TREE_COMMANDS.downloadArtifact, async (uidArg?: string) => {
      // Accept the artifact UID either positionally (when invoked from
      // a webview / chat link) or via an InputBox prompt.
      let uid = typeof uidArg === 'string' && uidArg.length > 0 ? uidArg : undefined;
      if (!uid) {
        uid = await vscode.window.showInputBox({
          title: vscode.l10n.t('Download artifact'),
          prompt: vscode.l10n.t('Artifact UID (from `oz run get`).'),
          ignoreFocusOut: true,
        });
      }
      if (!uid) { return; }

      // Pre-fetch metadata so we can offer a sensible default filename
      // and warn the user about size before the binary download starts.
      let suggestedName = uid;
      try {
        const meta = await cli.artifactGet(uid);
        if (meta.name) { suggestedName = meta.name; }
      } catch {
        // Metadata is best-effort: an older CLI without `artifact get`
        // still supports `artifact download`, so do not abort here.
      }

      const target = await vscode.window.showSaveDialog({
        title: vscode.l10n.t('Save artifact'),
        defaultUri: vscode.Uri.file(suggestedName),
      });
      if (!target) { return; }

      try {
        await cli.artifactDownload(uid, target.fsPath);
        const open = vscode.l10n.t('Reveal in Explorer');
        const choice = await vscode.window.showInformationMessage(
          vscode.l10n.t('Downloaded artifact to `{0}`.', target.fsPath),
          open,
        );
        if (choice === open) {
          await vscode.commands.executeCommand('revealFileInOS', target);
        }
      } catch (err) {
        await vscode.window.showErrorMessage(vscode.l10n.t('Failed to download artifact: {0}', errorMessage(err)));
      }
    }),

    vscode.commands.registerCommand(TREE_COMMANDS.createSecret, async () => {
      const name = await vscode.window.showInputBox({
        title: vscode.l10n.t('New secret — name'),
        prompt: vscode.l10n.t('Unique name (alphanumeric, dashes, underscores).'),
        ignoreFocusOut: true,
        validateInput: (v) => /^[A-Za-z0-9_.\-]+$/.test(v) ? undefined : vscode.l10n.t('Use only A-Z, a-z, 0-9, dot, dash, underscore.'),
      });
      if (!name) { return; }

      // SECURITY: password=true masks the value in the InputBox; the
      // value is then piped through stdin in `secretCreate` so it never
      // reaches the OS process listing.
      const value = await vscode.window.showInputBox({
        title: vscode.l10n.t('New secret — value'),
        prompt: vscode.l10n.t('Secret value (will be hidden).'),
        password: true,
        ignoreFocusOut: true,
      });
      if (value === undefined || value.length === 0) { return; }

      const description = await vscode.window.showInputBox({
        title: vscode.l10n.t('New secret — description (optional)'),
        prompt: vscode.l10n.t('Optional human-readable description.'),
        ignoreFocusOut: true,
      });
      // Empty/undefined description is fine — we just omit the flag.

      const scopePick = await vscode.window.showQuickPick(
        [
          { label: vscode.l10n.t('Personal'), value: 'personal' as const },
          { label: vscode.l10n.t('Team'), value: 'team' as const },
          { label: vscode.l10n.t('Default'), value: undefined },
        ],
        { title: vscode.l10n.t('New secret — scope'), ignoreFocusOut: true },
      );
      if (!scopePick) { return; }

      try {
        await cli.secretCreate({
          name,
          value,
          description: description || undefined,
          scope: scopePick.value,
        });
        await vscode.window.showInformationMessage(vscode.l10n.t('Created secret `{0}`.', name));
        provider.refresh();
      } catch (err) {
        await vscode.window.showErrorMessage(vscode.l10n.t('Failed to create secret: {0}', errorMessage(err)));
      }
    }),

    vscode.commands.registerCommand(TREE_COMMANDS.updateSecret, async (node?: WarpTreeNode) => {
      const secret = node?.kind === 'secret' ? node.secret : undefined;
      if (!secret) { return; }

      const value = await vscode.window.showInputBox({
        title: vscode.l10n.t('Update secret `{0}` — new value', secret.name),
        prompt: vscode.l10n.t('Leave empty to keep the current value.'),
        password: true,
        ignoreFocusOut: true,
      });
      if (value === undefined) { return; }

      const description = await vscode.window.showInputBox({
        title: vscode.l10n.t('Update secret `{0}` — description', secret.name),
        value: secret.description ?? '',
        prompt: vscode.l10n.t('Leave unchanged to keep the current description.'),
        ignoreFocusOut: true,
      });
      if (description === undefined) { return; }

      const updates: { name: string; value?: string; description?: string; scope?: 'team' | 'personal' } = { name: secret.name };
      if (value.length > 0) { updates.value = value; }
      if (description !== (secret.description ?? '')) {
        updates.description = description.length > 0 ? description : undefined;
      }
      if (secret.scope === 'team' || secret.scope === 'personal') {
        updates.scope = secret.scope;
      }

      if (updates.value === undefined && updates.description === undefined) {
        await vscode.window.showInformationMessage(vscode.l10n.t('No changes to apply.'));
        return;
      }

      try {
        await cli.secretUpdate(updates);
        await vscode.window.showInformationMessage(vscode.l10n.t('Updated secret `{0}`.', secret.name));
        provider.refresh();
      } catch (err) {
        await vscode.window.showErrorMessage(vscode.l10n.t('Failed to update secret: {0}', errorMessage(err)));
      }
    }),

    vscode.commands.registerCommand(TREE_COMMANDS.deleteSecret, async (node?: WarpTreeNode) => {
      const secret = node?.kind === 'secret' ? node.secret : undefined;
      if (!secret) { return; }
      const confirm = await vscode.window.showWarningMessage(
        vscode.l10n.t('Delete secret `{0}`? This cannot be undone.', secret.name),
        { modal: true },
        vscode.l10n.t('Delete'),
      );
      if (confirm !== vscode.l10n.t('Delete')) { return; }
      try {
        await cli.secretDelete(secret.name, {
          scope: secret.scope === 'team' || secret.scope === 'personal' ? secret.scope : undefined,
        });
        await vscode.window.showInformationMessage(vscode.l10n.t('Deleted secret `{0}`.', secret.name));
        provider.refresh();
      } catch (err) {
        await vscode.window.showErrorMessage(vscode.l10n.t('Failed to delete secret: {0}', errorMessage(err)));
      }
    }),

    vscode.commands.registerCommand(TREE_COMMANDS.copySecretName, async (node?: WarpTreeNode) => {
      const secret = node?.kind === 'secret' ? node.secret : undefined;
      if (!secret) { return; }
      await vscode.env.clipboard.writeText(secret.name);
      await vscode.window.showInformationMessage(vscode.l10n.t('Copied secret name `{0}` to clipboard.', secret.name));
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
    case 'secret': return node.secret.name;
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
