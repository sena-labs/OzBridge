import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { IRunStatsService, RunStatsSummary } from '../services/runStats.js';
import { logError, logWarn } from '../services/logger.js';

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
  // Area fill path: trace points then close back along the bottom
  const areaPoints = values
    .map((v, i) => {
      const x = (i * stepX).toFixed(2);
      const y = (height - (v / max) * height).toFixed(2);
      return `${x},${y}`;
    })
    .join(' L ');
  const firstX = '0.00';
  const lastX = ((values.length - 1) * stepX).toFixed(2);
  return [
    `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="sparkline" aria-hidden="true">`,
    `<defs>`,
    `<linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0%" stop-color="var(--vscode-charts-blue)" stop-opacity="0.35"/>`,
    `<stop offset="100%" stop-color="var(--vscode-charts-blue)" stop-opacity="0"/>`,
    `</linearGradient>`,
    `</defs>`,
    `<path fill="url(#sg)" d="M ${areaPoints} L ${lastX},${height} L ${firstX},${height} Z" />`,
    `<polyline fill="none" stroke="var(--vscode-charts-blue)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points="${points}" />`,
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

  const maxTotal = Math.max(1, ...summary.buckets.map((b) => b.total));
  const rows = summary.buckets
    .map((b) => {
      const barPct = Math.round((b.total / maxTotal) * 100);
      return [
        '<tr>',
        `<td class="date">${escapeHtml(b.date)}</td>`,
        `<td class="num">${b.total}</td>`,
        `<td class="num ok">${b.succeeded}</td>`,
        `<td class="num err">${b.failed}</td>`,
        `<td class="num inf">${b.inFlight}</td>`,
        `<td class="bar-cell"><div class="bar-wrap"><div class="bar-track"><div class="bar-fill" style="width:${barPct}%"></div></div></div></td>`,
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
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-foreground);
    --fg-muted: var(--vscode-descriptionForeground);
    --widget-bg: var(--vscode-editorWidget-background);
    --widget-border: var(--vscode-editorWidget-border, rgba(128,128,128,0.3));
    --accent: var(--vscode-charts-blue);
    --ok: var(--vscode-charts-green);
    --err: var(--vscode-charts-red);
    --warn: var(--vscode-charts-yellow);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
    --font: var(--vscode-font-family);
    --font-mono: var(--vscode-editor-font-family, 'Cascadia Code', 'Fira Code', monospace);
    --radius: 8px;
  }

  *, *::before, *::after { box-sizing: border-box; }

  body {
    font-family: var(--font);
    font-size: 15px;
    color: var(--fg);
    background: var(--bg);
    margin: 0;
    padding: 20px 24px 32px;
    line-height: 1.6;
  }

  /* ── Header ─────────────────────────────────────────────────── */
  .header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 4px;
    flex-wrap: wrap;
    gap: 8px;
  }
  .header h1 {
    font-size: 1.25em;
    font-weight: 700;
    letter-spacing: 0.03em;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
  }
  .header h1::before {
    content: '';
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 8px var(--accent);
    animation: pulse 2.4s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }
  .meta {
    color: var(--fg-muted);
    font-size: 0.85em;
    font-family: var(--font-mono);
    margin-bottom: 18px;
    opacity: 0.8;
  }

  /* ── Actions ─────────────────────────────────────────────────── */
  .actions { margin-bottom: 16px; }
  button {
    background: var(--btn-bg);
    color: var(--btn-fg);
    border: none;
    padding: 6px 16px;
    cursor: pointer;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.9em;
    letter-spacing: 0.03em;
    transition: background 0.12s;
  }
  button:hover { background: var(--btn-hover); }
  button:active { opacity: 0.8; }

  /* ── KPI Cards ───────────────────────────────────────────────── */
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
    margin-bottom: 20px;
  }
  .card {
    background: var(--widget-bg);
    border: 1px solid var(--widget-border);
    border-radius: var(--radius);
    padding: 16px 18px;
    position: relative;
    overflow: hidden;
    animation: fadeUp 0.3s ease both;
  }
  .card::after {
    content: '';
    position: absolute;
    inset: 0 0 auto 0;
    height: 3px;
    background: var(--card-accent, var(--accent));
    border-radius: var(--radius) var(--radius) 0 0;
  }
  .card--ok { --card-accent: var(--ok); }
  .card--err { --card-accent: var(--err); }
  .card--inflight { --card-accent: var(--warn); }
  .card--wide { grid-column: span 2; }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .card h2 {
    font-size: 0.77em;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--fg-muted);
    margin: 0 0 8px 0;
    font-weight: 600;
  }
  .card .v {
    font-size: 2.2em;
    font-weight: 700;
    font-family: var(--font-mono);
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .card .v-ok  { color: var(--ok); }
  .card .v-err { color: var(--err); }

  /* ── Sparkline ───────────────────────────────────────────────── */
  .sparkline { width: 100%; height: 52px; display: block; margin-top: 6px; }

  /* ── Table ───────────────────────────────────────────────────── */
  .table-wrap {
    border: 1px solid var(--widget-border);
    border-radius: var(--radius);
    overflow: hidden;
    animation: fadeUp 0.3s ease 0.1s both;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.92em;
  }
  thead { background: var(--widget-bg); }
  th {
    padding: 9px 14px;
    text-align: left;
    color: var(--fg-muted);
    font-weight: 600;
    font-size: 0.8em;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    border-bottom: 1px solid var(--widget-border);
    font-family: var(--font-mono);
  }
  th.num { text-align: right; }
  tbody tr {
    border-bottom: 1px solid var(--widget-border);
    transition: background 0.1s;
  }
  tbody tr:last-child { border-bottom: none; }
  tbody tr:hover { background: var(--widget-bg); }
  td {
    padding: 8px 14px;
    font-family: var(--font-mono);
    font-size: 0.95em;
  }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.ok  { color: var(--ok); }
  td.err { color: var(--err); }
  td.inf { color: var(--warn); }
  td.date { font-family: var(--font-mono); color: var(--fg-muted); font-size: 0.9em; }

  /* ── Bar sparkbars in table ──────────────────────────────────── */
  .bar-cell { width: 90px; padding-right: 14px; }
  .bar-wrap { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
  .bar-track { flex: 1; height: 4px; background: var(--widget-border); border-radius: 2px; overflow: hidden; min-width: 36px; }
  .bar-fill  { height: 100%; border-radius: 2px; background: var(--accent); }
</style>
</head>
<body>
<div class="header">
  <h1>OzBridge Dashboard</h1>
</div>
<div class="meta">window: ${summary.windowDays}d &nbsp;·&nbsp; ${escapeHtml(generatedAt)}${summary.undatedCount > 0 ? ` &nbsp;·&nbsp; undated: ${summary.undatedCount}` : ''}</div>
<div class="actions"><button id="refresh" type="button">↺ Refresh</button></div>
<div class="cards">
  <div class="card"><h2>Total runs</h2><div class="v">${summary.totalRuns}</div></div>
  <div class="card card--ok"><h2>Success rate</h2><div class="v v-ok">${successPct}%</div></div>
  <div class="card card--err"><h2>Failed</h2><div class="v v-err">${summary.buckets.reduce((s, b) => s + b.failed, 0)}</div></div>
  <div class="card card--inflight"><h2>In-flight</h2><div class="v">${summary.buckets.reduce((s, b) => s + b.inFlight, 0)}</div></div>
  <div class="card card--wide"><h2>Daily volume</h2>${sparkline || '<div class="meta" style="padding-top:4px">no data</div>'}</div>
</div>
<div class="table-wrap">
<table>
  <thead><tr><th>Date</th><th class="num">Total</th><th class="num">OK</th><th class="num">Failed</th><th class="num">In-flight</th><th></th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</div>
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
 * Validates the structure of a message received from the dashboard webview.
 * Returns `null` for any payload that doesn't match the strict shape we
 * accept, so a compromised/malformed renderer cannot drive arbitrary
 * branches in the host.
 */
type DashboardMessage = { type: 'refresh' };
function parseDashboardMessage(msg: unknown): DashboardMessage | null {
  if (typeof msg !== 'object' || msg === null) {
    // LOW-4: surface malformed payloads in the output channel so support
    // can correlate webview misbehaviour with host logs. We deliberately
    // truncate to avoid dumping arbitrarily large objects.
    logWarn(`Dashboard: dropped non-object message (typeof=${typeof msg}).`);
    return null;
  }
  const obj = msg as Record<string, unknown>;
  if (obj.type === 'refresh') { return { type: 'refresh' }; }
  // LOW-4: log the rejected `type` discriminator (clipped to 64 chars to
  // bound log size) so unknown commands sent by a stale or compromised
  // renderer are visible during debugging.
  const rawType = typeof obj.type === 'string' ? obj.type.slice(0, 64) : `<${typeof obj.type}>`;
  logWarn(`Dashboard: rejected unexpected message type "${rawType}".`);
  return null;
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
  // C-M1 (audit v4): in-flight guard to coalesce rapid Refresh button
  // clicks. Without this, two parallel `computeSummary()` calls race and
  // the second one's HTML overwrites the first — wasted work and a brief
  // flicker. The flag is reset in `refresh()`'s `finally` block.
  private refreshing = false;
  // When a refresh is requested while one is already in-flight, set this
  // flag so the finally block fires another refresh with the latest state
  // (e.g. after stats.invalidate() was called mid-flight).
  private refreshQueued = false;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly stats: IRunStatsService,
    private readonly windowDays: number,
  ) {
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: unknown) => {
        const parsed = parseDashboardMessage(msg);
        if (parsed?.type === 'refresh') {
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
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        // The dashboard HTML is fully self-contained (inline CSS, no external
        // assets). Locking `localResourceRoots` to an empty list prevents the
        // webview from loading any file via `asWebviewUri`, which is the
        // safest default per VS Code webview hardening guidance.
        localResourceRoots: [],
      },
    );
    const instance = new DashboardPanel(panel, stats, windowDays);
    DashboardPanel.current = instance;
    // Show a placeholder so the user gets immediate feedback instead of a
    // blank panel while `computeSummary` is in flight.
    const loadingNonce = generateNonce();
    panel.webview.html = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource} 'nonce-${loadingNonce}';" /><style nonce="${loadingNonce}">body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:16px;opacity:0.85;}</style></head><body>Loading dashboard…</body></html>`;
    void instance.refresh();
    return instance;
  }

  /** Recomputes the summary and rerenders the webview HTML. */
  async refresh(): Promise<void> {
    if (this.disposed) {
      return;
    }
    // C-M1: skip when an earlier refresh is still in-flight, but remember
    // to re-run once the current one completes so that any stats
    // invalidated mid-flight are reflected in the final render.
    if (this.refreshing) {
      this.refreshQueued = true;
      return;
    }
    this.refreshing = true;
    this.refreshQueued = false;
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
      // Surface an actionable hint when the failure looks like an Oz CLI
      // idle-timeout, so the user knows where to look (Output channel,
      // Warp app, idle-timeout setting) instead of staring at a generic
      // "Failed to load" line.
      const isIdle = /produced no output|unresponsive|idle/i.test(message);
      const hint = isIdle
        ? '<p style="margin-top:12px;font-size:12px;opacity:0.85;">The Oz CLI did not respond in time. Check that the Warp desktop app is running, your network is reachable, and that no interactive prompt is waiting outside VS Code. You can also raise <code>OzBridge → Idle Timeout Ms</code> in Settings.</p>'
        : '';
      this.panel.webview.html = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'nonce-${nonce}'; img-src ${this.panel.webview.cspSource};" /><style nonce="${nonce}">body{font-family:var(--vscode-font-family);color:var(--vscode-errorForeground);padding:16px;} code{background:var(--vscode-textBlockQuote-background);padding:1px 4px;border-radius:3px;}</style></head><body><strong>Failed to load dashboard:</strong> ${escapeHtml(message)}${hint}</body></html>`;
    } finally {
      this.refreshing = false;
      if (this.refreshQueued && !this.disposed) {
        this.refreshQueued = false;
        void this.refresh();
      }
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
