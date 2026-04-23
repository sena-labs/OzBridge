import * as vscode from 'vscode';
import { ActiveRunsTracker, TrackedRun } from '../services/activeRunsTracker.js';
import { OzRunStatus } from '../types/index.js';

/**
 * Manages the `$(cloud) Warp: N active` status bar indicator.
 *
 * The item subscribes to an {@link ActiveRunsTracker} for live updates and
 * colour-codes the count:
 *
 * - `0`       → default foreground (idle)
 * - `1`–`2`   → `statusBarItem.warningBackground`
 * - `3` +     → `statusBarItem.errorBackground`
 *
 * Clicking the item runs the `ozBridge.sidebar.focus` command, bringing the
 * Warp Activity Bar view into focus.
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
    this.item.text = `$(cloud) Warp: ${activeCount} active`;
    this.item.tooltip = buildTooltip(runs);
    // v1.0 deliverable S — WCAG 2.1 AA: codicon glyphs ($cloud) are
    // not announced by screen readers; expose a plain-language label.
    this.item.accessibilityInformation = {
      label: `OzBridge: ${activeCount} active run${activeCount === 1 ? '' : 's'}`,
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
    this.item.text = `$(cloud-outline) Warp: unavailable`;
    this.item.tooltip = 'OzBridge: unable to list runs. Check Oz CLI availability and authentication.';
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.item.accessibilityInformation = {
      label: 'OzBridge: unavailable. Check Oz CLI availability and authentication.',
      role: 'button',
    };
  }
}

function isActive(status: OzRunStatus): boolean {
  return status === 'QUEUED' || status === 'INPROGRESS';
}

function buildTooltip(runs: ReadonlyArray<TrackedRun>): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  md.appendMarkdown('**OzBridge** — active & recent runs\n\n');

  if (runs.length === 0) {
    md.appendMarkdown('_No runs reported by Oz CLI._\n\n');
  } else {
    md.appendMarkdown('| Status | Run ID |\n| --- | --- |\n');
    for (const r of runs.slice(0, 8)) {
      md.appendMarkdown(`| ${statusIcon(r.status)} ${r.status} | \`${r.id}\` |\n`);
    }
    if (runs.length > 8) {
      md.appendMarkdown(`\n_…and ${runs.length - 8} more — click to open the sidebar._`);
    }
  }

  md.appendMarkdown('\n\nClick to focus the Warp sidebar.');
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
