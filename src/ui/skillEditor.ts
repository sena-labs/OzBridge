import * as vscode from 'vscode';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Command IDs contributed by the skill & rule editor surface. */
export const SKILL_EDITOR_COMMANDS = {
  /** Opens an existing skill / rule / prompt file in the editor. */
  edit: 'ozBridge.skill.edit',
  /** Creates a new scaffolded skill file and opens it. */
  newSkill: 'ozBridge.skill.new',
  /** Saves the currently active editor's skill file as a global skill. */
  saveGlobal: 'ozBridge.skill.saveGlobal',
  /** Saves the currently active editor's skill file as a project skill. */
  saveWorkspace: 'ozBridge.skill.saveWorkspace',
} as const;

/**
 * Options accepted by {@link registerSkillEditorCommands}. The only
 * dependency is a function that returns the first workspace folder
 * path, abstracted so tests can inject deterministic values.
 */
export interface SkillEditorDeps {
  getWorkspacePath?: () => string | undefined;
  getHomeDir?: () => string;
}

/**
 * Built-in skill / rule editor commands.
 *
 * Deliberately uses the **native VS Code editor** rather than a
 * custom Monaco webview:
 *
 * 1. Markdown live preview is already available via
 *    `Ctrl+K V` / `markdown.showPreviewToSide`.
 * 2. CSP / nonce concerns go away.
 * 3. Bundle size stays within budget for v0.7.
 *
 * A richer in-extension editor (webview + frontmatter validator) is
 * an explicit v0.8 stretch item.
 */
export function registerSkillEditorCommands(deps: SkillEditorDeps = {}): vscode.Disposable[] {
  const getWorkspace = deps.getWorkspacePath ?? defaultWorkspacePath;
  const getHome = deps.getHomeDir ?? (() => os.homedir());

  return [
    vscode.commands.registerCommand(SKILL_EDITOR_COMMANDS.edit, async (target?: string | vscode.Uri) => {
      const uri = await resolveEditTarget(target);
      if (!uri) { return; }
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
    }),

    vscode.commands.registerCommand(SKILL_EDITOR_COMMANDS.newSkill, async () => {
      const name = await vscode.window.showInputBox({
        title: 'OzBridge · New Skill',
        prompt: 'Name of the new skill (lower-case, hyphen-separated)',
        placeHolder: 'e.g. 9-security-agent',
        validateInput: (v) => {
          if (!v || !v.trim()) { return 'Skill name is required'; }
          if (!/^[a-z0-9][a-z0-9-]*$/.test(v.trim())) {
            return 'Use lower-case letters, digits and hyphens only';
          }
          return null;
        },
      });
      if (!name) { return; }

      const target = await pickSaveTarget(['Project', 'Global'], `Where should \`${name}\` be saved?`);
      if (!target) { return; }

      const base = target === 'Project' ? getWorkspace() : getHome();
      if (!base) {
        await vscode.window.showErrorMessage(vscode.l10n.t('OzBridge: no folder available for Project save.'));
        return;
      }
      const dir = target === 'Project'
        ? path.join(base, '.agents', 'skills', name.trim())
        : path.join(base, '.agents', 'skills', name.trim());
      const file = path.join(dir, 'SKILL.md');

      try {
        if (await pathExists(file)) {
          const overwrite = await vscode.window.showWarningMessage(
            vscode.l10n.t('{0} already exists. Overwrite?', file),
            { modal: true },
            vscode.l10n.t('Overwrite'),
          );
          if (overwrite !== vscode.l10n.t('Overwrite')) { return; }
        }
        await atomicWrite(file, skillTemplate(name.trim()));
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        await vscode.window.showTextDocument(doc);
      } catch (err) {
        await vscode.window.showErrorMessage(vscode.l10n.t('Failed to create skill: {0}', errMsg(err)));
      }
    }),

    vscode.commands.registerCommand(SKILL_EDITOR_COMMANDS.saveGlobal, async () => {
      await saveCurrentAs('Global', getHome(), getWorkspace());
    }),

    vscode.commands.registerCommand(SKILL_EDITOR_COMMANDS.saveWorkspace, async () => {
      await saveCurrentAs('Project', getHome(), getWorkspace());
    }),
  ];
}

// ===========================================================================
// Internals
// ===========================================================================

async function resolveEditTarget(target?: string | vscode.Uri): Promise<vscode.Uri | undefined> {
  if (target instanceof vscode.Uri) { return target; }
  if (typeof target === 'string' && target.trim()) { return vscode.Uri.file(target.trim()); }
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectMany: false,
    filters: { Markdown: ['md'] },
    title: 'OzBridge · Edit skill / rule',
  });
  return picked?.[0];
}

async function pickSaveTarget(items: string[], placeHolder: string): Promise<string | undefined> {
  const picked = await vscode.window.showQuickPick(items, { placeHolder, canPickMany: false });
  return typeof picked === 'string' ? picked : undefined;
}

async function saveCurrentAs(
  target: 'Global' | 'Project',
  homeDir: string,
  workspaceDir: string | undefined,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    await vscode.window.showWarningMessage(vscode.l10n.t('OzBridge: no active editor to save.'));
    return;
  }
  const content = editor.document.getText();
  const inferredName = path.basename(editor.document.uri.fsPath, path.extname(editor.document.uri.fsPath)) || 'skill';
  const name = await vscode.window.showInputBox({
    title: `Save as ${target} skill`,
    prompt: 'Skill name (directory name under skills/)',
    value: inferredName,
    validateInput: (v) => /^[a-z0-9][a-z0-9-]*$/.test(v.trim()) ? null : 'Use lower-case letters, digits and hyphens only',
  });
  if (!name) { return; }
  const base = target === 'Global' ? homeDir : workspaceDir;
  if (!base) {
    await vscode.window.showErrorMessage(vscode.l10n.t('OzBridge: no {0} directory available.', target.toLowerCase()));
    return;
  }
  const dir = path.join(base, '.agents', 'skills', name.trim());
  const file = path.join(dir, 'SKILL.md');
  try {
    if (await pathExists(file)) {
      const overwrite = await vscode.window.showWarningMessage(
        vscode.l10n.t('{0} already exists. Overwrite?', file),
        { modal: true },
        vscode.l10n.t('Overwrite'),
      );
      if (overwrite !== vscode.l10n.t('Overwrite')) { return; }
    }
    await atomicWrite(file, content);
    await vscode.window.showInformationMessage(vscode.l10n.t('Saved {0} skill to {1}', target.toLowerCase(), file));
  } catch (err) {
    await vscode.window.showErrorMessage(vscode.l10n.t('Save failed: {0}', errMsg(err)));
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes `content` to `file` atomically via a sibling `.tmp` file
 * followed by `fs.promises.rename`. Prevents readers from observing
 * a partially-written file. Asynchronous to keep the extension-host
 * event loop responsive on slower filesystems.
 */
export async function atomicWrite(file: string, content: string): Promise<void> {
  // B-L6: ensure parent directory exists inside the helper so callers do not
  // need a separate mkdir step (was previously done via `ensureDirectoryExists`).
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, content, 'utf8');
  await fsp.rename(tmp, file);
}

function skillTemplate(name: string): string {
  return `---\nname: ${name}\ndescription: ""\n---\n\n# ${name}\n\n## Instructions\n\nProvide specific instructions for this skill.\n`;
}

function defaultWorkspacePath(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
