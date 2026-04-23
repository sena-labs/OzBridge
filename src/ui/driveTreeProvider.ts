import * as vscode from 'vscode';
import {
  DriveCategory,
  DriveEntry,
  DrivePrompt,
  DriveRule,
  DriveSkill,
  IDriveSource,
} from '../drive/warpDriveSource.js';
import { logWarn } from '../services/logger.js';

/**
 * Node kinds rendered by {@link OzDriveTreeProvider}. The `kind`
 * discriminator drives both the icon and the `contextValue` used by
 * `package.json`'s `view/item/context` menus.
 */
export type DriveTreeNode = CategoryNode | EntryNode | MessageNode;

interface CategoryNode {
  readonly kind: 'category';
  readonly id: string;
  readonly category: DriveCategory;
  readonly label: string;
}

type CategorySourceMode = 'unknown' | 'cli' | 'filesystem' | 'mixed';

interface EntryNode {
  readonly kind: 'entry';
  readonly id: string;
  readonly entry: DriveEntry;
}

interface MessageNode {
  readonly kind: 'message';
  readonly id: string;
  readonly label: string;
}

/**
 * `TreeDataProvider<DriveTreeNode>` for the Warp Drive sidebar view
 * (`ozBridge.driveView`). Lists three top-level categories
 * (Prompts, Rules, Skills), each populated from an
 * {@link IDriveSource}.
 *
 * The provider caches the last-fetched entries per category so the
 * tree refresh stays snappy. Callers invoke {@link refresh} to drop
 * the cache and re-query the source.
 */
export class OzDriveTreeProvider implements vscode.TreeDataProvider<DriveTreeNode>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<DriveTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly cache = new Map<DriveCategory, DriveEntry[]>();
  private readonly categorySources = new Map<DriveCategory, CategorySourceMode>();
  private disposed = false;

  constructor(private readonly source: IDriveSource) {}

  refresh(): void {
    this.cache.clear();
    this.categorySources.clear();
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true;
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(element: DriveTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case 'category': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = element.id;
        item.iconPath = new vscode.ThemeIcon(categoryIcon(element.category));
        const sourceMode = this.categorySources.get(element.category) ?? 'unknown';
        if (sourceMode !== 'unknown') {
          item.description = sourceMode;
        }
        item.contextValue = `warpDriveCategory:${element.category}`;
        item.tooltip = sourceMode === 'unknown'
          ? `${element.label} category`
          : `${element.label} category · source: ${sourceMode}`;
        // v1.0 deliverable S — WCAG 2.1 AA: every tree node carries an
        // explicit a11y label + role so screen readers announce a
        // semantic value rather than the raw display string.
        item.accessibilityInformation = {
          label: `${element.label} category`,
          role: 'treeitem',
        };
        return item;
      }
      case 'entry': {
        const item = new vscode.TreeItem(element.entry.name, vscode.TreeItemCollapsibleState.None);
        item.id = element.id;
        item.description = element.entry.source === 'cli' ? 'cli' : 'local';
        item.iconPath = new vscode.ThemeIcon(entryIcon(element.entry.category));
        item.tooltip = buildTooltip(element.entry);
        item.contextValue = `warpDrive${capitalise(element.entry.category)}`;
        item.command = {
          command: 'ozBridge.drive.openInEditor',
          title: 'Open in Editor',
          arguments: [element],
        };
        item.accessibilityInformation = {
          label: `${element.entry.category} ${element.entry.name}, source ${element.entry.source}`,
          role: 'treeitem',
        };
        return item;
      }
      case 'message': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.id = element.id;
        item.iconPath = new vscode.ThemeIcon('info');
        item.contextValue = 'warpDriveMessage';
        item.tooltip = element.label;
        item.accessibilityInformation = {
          label: `Information: ${element.label}`,
          role: 'treeitem',
        };
        return item;
      }
    }
  }

  async getChildren(element?: DriveTreeNode): Promise<DriveTreeNode[]> {
    if (!element) {
      return [
        cat('prompt', 'Prompts'),
        cat('rule', 'Rules'),
        cat('skill', 'Skills'),
      ];
    }
    if (element.kind !== 'category') { return []; }

    try {
      const entries = await this.loadCategory(element.category);
      if (entries.length === 0) {
        return [msg(`${element.category}:empty`, emptyLabelFor(element.category))];
      }
      return entries.map<EntryNode>((e) => ({ kind: 'entry', id: `entry:${e.id}`, entry: e }));
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      logWarn(`OzDriveTreeProvider: ${element.category} load failed: ${text}`);
      return [msg(`${element.category}:error`, `Error: ${text}`)];
    }
  }

  private async loadCategory(category: DriveCategory): Promise<DriveEntry[]> {
    const cached = this.cache.get(category);
    if (cached) { return cached; }
    let entries: DriveEntry[];
    switch (category) {
      case 'prompt': entries = await this.source.listPrompts(); break;
      case 'rule': entries = await this.source.listRules(); break;
      case 'skill': entries = await this.source.listSkills(); break;
    }
    this.cache.set(category, entries);
    this.categorySources.set(category, computeSourceMode(entries));
    return entries;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cat(category: DriveCategory, label: string): CategoryNode {
  return { kind: 'category', id: `category:${category}`, category, label };
}
function msg(id: string, label: string): MessageNode {
  return { kind: 'message', id: `message:${id}`, label };
}
function emptyLabelFor(category: DriveCategory): string {
  switch (category) {
    case 'prompt': return 'No prompts available';
    case 'rule': return 'No rules available';
    case 'skill': return 'No skills available';
  }
}
function categoryIcon(category: DriveCategory): string {
  switch (category) {
    case 'prompt': return 'comment-discussion';
    case 'rule': return 'shield';
    case 'skill': return 'mortar-board';
  }
}
function entryIcon(category: DriveCategory): string {
  switch (category) {
    case 'prompt': return 'file-text';
    case 'rule': return 'shield';
    case 'skill': return 'mortar-board';
  }
}
function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function buildTooltip(entry: DriveEntry): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${entry.name}**\n\n`);
  if (entry.description) {
    md.appendMarkdown(`${entry.description}\n\n`);
  }
  md.appendMarkdown(`_source: ${entry.source}_`);
  if (entry.tags && entry.tags.length > 0) {
    md.appendMarkdown(`  ·  _tags: ${entry.tags.join(', ')}_`);
  }
  if (entry.updatedAt) {
    md.appendMarkdown(`\n\n_updated: ${entry.updatedAt}_`);
  }
  return md;
}

function computeSourceMode(entries: ReadonlyArray<DriveEntry>): CategorySourceMode {
  if (entries.length === 0) {
    return 'unknown';
  }
  const hasCli = entries.some((e) => e.source === 'cli');
  const hasFs = entries.some((e) => e.source === 'filesystem');
  if (hasCli && hasFs) {
    return 'mixed';
  }
  return hasCli ? 'cli' : 'filesystem';
}
