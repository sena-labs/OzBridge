import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SlashCommandHandler } from '../types/index.js';
import { SKILL_TEMPLATES, SkillTemplate } from '../scaffold/skillTemplates.js';

/**
 * Creates the `/init` v2 slash-command handler.
 *
 * Two entry points with back-compat semantics:
 * - `@warp /init`       → interactive QuickPick, per-file overwrite
 *                         confirmation. User friendly default.
 * - `@warp /init all`   → legacy bulk scaffold; never overwrites
 *                         existing files (same behaviour as v0.2.0).
 *
 * Files are always written atomically (`.tmp` + `fs.renameSync`) so
 * partial writes never land on disk.
 */
export function createInitV2Command(): SlashCommandHandler {
  return async (prompt, stream, _token) => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.[0]) {
      stream.markdown('❌ No workspace open. Open a folder before using `/init`.\n');
      return {};
    }
    const root = folders[0].uri.fsPath;
    const normalised = (prompt ?? '').trim().toLowerCase();

    if (normalised === 'all') {
      const result = await scaffoldAll(root, SKILL_TEMPLATES);
      reportInChat(stream, result);
      return {};
    }

    const picked = await promptUser(SKILL_TEMPLATES, root);
    if (!picked || picked.length === 0) {
      stream.markdown('_No templates selected. `/init` cancelled._\n');
      return {};
    }

    const result = await scaffoldSelected(root, picked, /* askBeforeOverwrite */ true);
    reportInChat(stream, result);
    return {};
  };
}

// ===========================================================================
// Orchestration
// ===========================================================================

interface ScaffoldSummary {
  created: string[];
  overwritten: string[];
  skipped: string[];
  errored: Array<{ path: string; reason: string }>;
}

async function scaffoldAll(root: string, templates: SkillTemplate[]): Promise<ScaffoldSummary> {
  const summary = emptySummary();
  for (const t of templates) {
    const absolute = path.join(root, t.relativePath);
    if (fs.existsSync(absolute)) { summary.skipped.push(t.relativePath); continue; }
    try {
      atomicWrite(absolute, t.body());
      summary.created.push(t.relativePath);
    } catch (err) {
      summary.errored.push({ path: t.relativePath, reason: errMsg(err) });
    }
  }
  return summary;
}

async function scaffoldSelected(
  root: string,
  templates: SkillTemplate[],
  askBeforeOverwrite: boolean,
): Promise<ScaffoldSummary> {
  const summary = emptySummary();
  for (const t of templates) {
    const absolute = path.join(root, t.relativePath);
    const exists = fs.existsSync(absolute);
    if (exists && askBeforeOverwrite) {
      const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t('{0} already exists. Overwrite?', t.relativePath),
        { modal: true },
        vscode.l10n.t('Overwrite'),
      );
      if (choice !== vscode.l10n.t('Overwrite')) {
        summary.skipped.push(t.relativePath);
        continue;
      }
    }
    try {
      atomicWrite(absolute, t.body());
      (exists ? summary.overwritten : summary.created).push(t.relativePath);
    } catch (err) {
      summary.errored.push({ path: t.relativePath, reason: errMsg(err) });
    }
  }
  return summary;
}

// ===========================================================================
// UX
// ===========================================================================

interface TemplateQuickPickItem extends vscode.QuickPickItem {
  template: SkillTemplate;
}

/**
 * Shows the QuickPick and returns the selected templates (or
 * `undefined` if the user cancelled). Each item carries a state badge
 * (`[new]` / `[exists]`) so the user knows what the next step will do
 * before confirming.
 */
async function promptUser(templates: SkillTemplate[], root: string): Promise<SkillTemplate[] | undefined> {
  const items: TemplateQuickPickItem[] = templates.map((t) => {
    const absolute = path.join(root, t.relativePath);
    const exists = fs.existsSync(absolute);
    return {
      template: t,
      label: `$(${exists ? 'file' : 'new-file'}) ${t.relativePath}`,
      description: exists ? '[exists]' : '[new]',
      detail: t.description,
      picked: !exists,
    };
  });
  const picked = await vscode.window.showQuickPick<TemplateQuickPickItem>(items, {
    canPickMany: true,
    title: 'Warp Bridge · /init templates',
    placeHolder: 'Pick the skill / rule files to scaffold',
  });
  if (!picked) { return undefined; }
  return (picked as TemplateQuickPickItem[]).map((i) => i.template);
}

function reportInChat(stream: vscode.ChatResponseStream, summary: ScaffoldSummary): void {
  stream.markdown('## ✅ `/init` complete\n\n');
  if (summary.created.length > 0) {
    stream.markdown(`- **${summary.created.length}** created\n`);
    for (const p of summary.created) { stream.markdown(`  - \`${p}\`\n`); }
  }
  if (summary.overwritten.length > 0) {
    stream.markdown(`- **${summary.overwritten.length}** overwritten\n`);
    for (const p of summary.overwritten) { stream.markdown(`  - \`${p}\`\n`); }
  }
  if (summary.skipped.length > 0) {
    stream.markdown(`- **${summary.skipped.length}** skipped\n`);
    for (const p of summary.skipped) { stream.markdown(`  - \`${p}\`\n`); }
  }
  if (summary.errored.length > 0) {
    stream.markdown(`- **${summary.errored.length}** failed:\n`);
    for (const e of summary.errored) { stream.markdown(`  - \`${e.path}\`: ${e.reason}\n`); }
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

function emptySummary(): ScaffoldSummary {
  return { created: [], overwritten: [], skipped: [], errored: [] };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Atomic write: stage content in a sibling `.tmp` file, then
 * `fs.renameSync` on top of the final path. `mkdirSync` on the parent
 * directory is always recursive.
 */
export function atomicWrite(file: string, content: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}
