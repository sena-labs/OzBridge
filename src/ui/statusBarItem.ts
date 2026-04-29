import * as vscode from 'vscode';
import { ActiveRunsTracker, TrackedRun } from '../services/activeRunsTracker.js';
import { OzRunStatus } from '../types/index.js';

/**
 * Manages the `$(cloud) OzBridge: N active` status bar indicator.
 *
 * The item subscribes to an {@link ActiveRunsTracker} for live updates and
 * colour-codes the count:
 *
 * - `0`       → default foreground (idle)
 * - `1`–`2`   → `statusBarItem.warningBackground`
 * - `3` +     → `statusBarItem.errorBackground`
 *
 * Clicking the item runs the `ozBridge.sidebar.focus` command, bringing the
 * OzBridge Activity Bar view into focus.
 */
export class StatusBarManager implements vscode.Disposable {
  static readonly FOCUS_COMMAND = 'ozBridge.sidebar.focus';

  private readonly item: vscode.StatusBarItem;
  private readonly subscriptions: vscode.Disposable[] = [];
  private disposed = false;

  constructor(private readonly tracker: ActiveRunsTracker) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.name = 'OzBridge';
    this.item.command = StatusBarManager.FOCUS_COMMAND;
    this.render([]);
    this.item.show();

    this.subscriptions.push(
      this.tracker.onDidChange((runs) => this.render(runs)),
      this.tracker.onDidError(() => this.renderError()),
    );
  }

  /** Exposes the underlying item for tests and external wiring. */
  get statusBarItem(): vscode.StatusBarItem {
    return this.item;
  }

  dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true;
    for (const s of this.subscriptions) { s.dispose(); }
    this.item.dispose();
  }

  private render(runs: ReadonlyArray<TrackedRun>): void {
    const activeCount = runs.filter((r) => isActive(r.status)).length;
    // l10n: short label rendered in the status bar — `{0}` is the active run count.
    this.item.text = `$(cloud) ${vscode.l10n.t('OzBridge: {0} active', activeCount)}`;
    this.item.tooltip = buildTooltip(runs);
    // v1.0 deliverable S — WCAG 2.1 AA: codicon glyphs ($cloud) are
    // not announced by screen readers; expose a plain-language label.
    this.item.accessibilityInformation = {
      label: activeCount === 1
        ? vscode.l10n.t('OzBridge: 1 active run')
        : vscode.l10n.t('OzBridge: {0} active runs', activeCount),
      role: 'button',
    };

    if (activeCount >= 3) {
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (activeCount >= 1) {
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.item.backgroundColor = undefined;
    }
  }

  private renderError(): void {
    // Keep the last-known count but mark the tooltip so the user knows
    // polling is currently failing (e.g. Oz CLI missing or logged out).
    this.item.text = `$(cloud-outline) ${vscode.l10n.t('OzBridge: unavailable')}`;
    this.item.tooltip = vscode.l10n.t('OzBridge: unable to list runs. Check Oz CLI availability and authentication.');
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.item.accessibilityInformation = {
      label: vscode.l10n.t('OzBridge: unavailable. Check Oz CLI availability and authentication.'),
      role: 'button',
    };
  }
}

function isActive(status: OzRunStatus): boolean {
  return status === 'QUEUED' || status === 'INPROGRESS';
}

function buildTooltip(runs: ReadonlyArray<TrackedRun>): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`**OzBridge** — ${vscode.l10n.t('active & recent runs')}\n\n`);

  if (runs.length === 0) {
    md.appendMarkdown(`_${vscode.l10n.t('No runs reported by Oz CLI.')}_\n\n`);
  } else {
    md.appendMarkdown(`| ${vscode.l10n.t('Status')} | ${vscode.l10n.t('Run ID')} |\n| --- | --- |\n`);
    for (const r of runs.slice(0, 8)) {
      md.appendMarkdown(`| ${statusIcon(r.status)} ${r.status} | \`${r.id}\` |\n`);
    }
    if (runs.length > 8) {
      md.appendMarkdown(`\n_${vscode.l10n.t('…and {0} more — click to open the sidebar.', runs.length - 8)}_`);
    }
  }

  md.appendMarkdown(`\n\n${vscode.l10n.t('Click to focus the OzBridge sidebar.')}`);
  return md;
}

function statusIcon(status: OzRunStatus): string {
  switch (status) {
    case 'QUEUED': return '$(clock)';
    case 'INPROGRESS': return '$(sync~spin)';
    case 'SUCCEEDED': return '$(check)';
    case 'FAILED': return '$(error)';
    default: return '$(question)';
  }
}
