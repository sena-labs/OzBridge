import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { IRunStatsService, RunStatsSummary } from '../services/runStats.js';
import { logError } from '../services/logger.js';

/**
 * Default observation window for the dashboard, in days. Keeps the
 * payload light while still showing meaningful trends.
 */
export const DEFAULT_DASHBOARD_WINDOW_DAYS = 14;

/** Generates a cryptographically-strong nonce suitable for CSP. */
export function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(32);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/** Escapes a value for safe interpolation inside HTML text/attributes. */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Builds an inline SVG sparkline from the per-day totals. Returns an
 * empty string when there is no data so the rendered HTML stays
 * minimal.
 */
export function renderSparkline(values: ReadonlyArray<number>, width = 280, height = 48): string {
  if (values.length === 0) {
    return '';
  }
  const max = Math.max(1, ...values);
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((v, i) => {
      const x = (i * stepX).toFixed(2);
      const y = (height - (v / max) * height).toFixed(2);
      return `${x},${y}`;
    })
    .join(' ');
  return [
    `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="sparkline" aria-hidden="true">`,
    `<polyline fill="none" stroke="var(--vscode-charts-blue)" stroke-width="2" points="${points}" />`,
    '</svg>',
  ].join('');
}

/**
 * Renders the dashboard HTML body. Pure function — no `vscode`
 * dependency on inputs (the webview URI for the CSP source is passed
 * in by the caller). Exported for unit tests.
 */
export function renderDashboardHtml(summary: RunStatsSummary, nonce: string, cspSource: string): string {
  const successPct = (summary.successRate * 100).toFixed(1);
  const totals = summary.buckets.map((b) => b.total);
  const sparkline = renderSparkline(totals);
  const generatedAt = new Date().toISOString();

  const rows = summary.buckets
    .map((b) => {
      return [
        '<tr>',
        `<td>${escapeHtml(b.date)}</td>`,
        `<td class="num">${b.total}</td>`,
        `<td class="num ok">${b.succeeded}</td>`,
        `<td class="num err">${b.failed}</td>`,
        `<td class="num inf">${b.inFlight}</td>`,
        '</tr>',
      ].join('');
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource};" />
<title>OzBridge — Dashboard</title>
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 16px; }
  h1 { font-size: 1.2em; margin: 0 0 12px 0; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-bottom: 16px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-editorWidget-border); border-radius: 4px; padding: 12px; }
  .card h2 { font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--vscode-descriptionForeground); margin: 0 0 6px 0; font-weight: normal; }
  .card .v { font-size: 1.8em; font-weight: 600; }
  .sparkline { width: 100%; height: 48px; display: block; margin-top: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
  th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--vscode-editorWidget-border); }
  th { color: var(--vscode-descriptionForeground); font-weight: normal; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.ok { color: var(--vscode-charts-green); }
  td.err { color: var(--vscode-charts-red); }
  td.inf { color: var(--vscode-charts-blue); }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 14px; cursor: pointer; border-radius: 2px; font-family: inherit; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  .actions { margin-bottom: 12px; }
</style>
</head>
<body>
<h1>OzBridge — Dashboard</h1>
<div class="meta">Window: ${summary.windowDays} days · Generated: ${escapeHtml(generatedAt)}${summary.undatedCount > 0 ? ` · Undated runs: ${summary.undatedCount}` : ''}</div>
<div class="actions"><button id="refresh" type="button">Refresh</button></div>
<div class="cards">
  <div class="card"><h2>Total runs</h2><div class="v">${summary.totalRuns}</div></div>
  <div class="card"><h2>Success rate</h2><div class="v">${successPct}%</div></div>
  <div class="card" style="grid-column: span 2;"><h2>Daily volume</h2>${sparkline || '<div class="meta">No data</div>'}</div>
</div>
<table>
  <thead><tr><th>Date</th><th class="num">Total</th><th class="num">OK</th><th class="num">Failed</th><th class="num">In-flight</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.getElementById('refresh').addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
  });
</script>
</body>
</html>`;
}

/**
 * Singleton webview panel that renders run statistics aggregated by
 * {@link IRunStatsService}.
 */
export class DashboardPanel {
  private static current: DashboardPanel | undefined;
  public static readonly viewType = 'ozBridge.dashboard';

  private readonly disposables: vscode.Disposable[] = [];
  private disposed = false;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly stats: IRunStatsService,
    private readonly windowDays: number,
  ) {
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: { type?: string }) => {
        if (msg && msg.type === 'refresh') {
          this.stats.invalidate();
          void this.refresh();
        }
      },
      null,
      this.disposables,
    );
  }

  /**
   * Opens the dashboard or focuses the existing one. Returns the
   * panel so callers (and tests) can drive it.
   */
  static createOrShow(stats: IRunStatsService, windowDays = DEFAULT_DASHBOARD_WINDOW_DAYS): DashboardPanel {
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal();
      void DashboardPanel.current.refresh();
      return DashboardPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      'OzBridge — Dashboard',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    const instance = new DashboardPanel(panel, stats, windowDays);
    DashboardPanel.current = instance;
    void instance.refresh();
    return instance;
  }

  /** Recomputes the summary and rerenders the webview HTML. */
  async refresh(): Promise<void> {
    if (this.disposed) {
      return;
    }
    try {
      const summary = await this.stats.computeSummary(this.windowDays);
      if (this.disposed) {
        return;
      }
      const nonce = generateNonce();
      this.panel.webview.html = renderDashboardHtml(summary, nonce, this.panel.webview.cspSource);
    } catch (err) {
      if (this.disposed) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      logError(`Dashboard refresh failed: ${message}`);
      const nonce = generateNonce();
      this.panel.webview.html = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'nonce-${nonce}'; img-src ${this.panel.webview.cspSource};" /><style nonce="${nonce}">body{font-family:var(--vscode-font-family);color:var(--vscode-errorForeground);padding:16px;}</style></head><body>Failed to load dashboard: ${escapeHtml(message)}</body></html>`;
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    DashboardPanel.current = undefined;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
    this.panel.dispose();
  }
}
