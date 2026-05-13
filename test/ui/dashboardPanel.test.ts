import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DashboardPanel,
  generateNonce,
  escapeHtml,
  renderSparkline,
  renderDashboardHtml,
  DEFAULT_DASHBOARD_WINDOW_DAYS,
} from '../../src/ui/dashboardPanel.js';
import { RunStatsSummary, IRunStatsService } from '../../src/services/runStats.js';
import * as vscode from 'vscode';

const sampleSummary: RunStatsSummary = {
  windowDays: 7,
  totalRuns: 12,
  successRate: 0.75,
  buckets: [
    { date: '2026-04-14', total: 3, succeeded: 2, failed: 1, inFlight: 0 },
    { date: '2026-04-15', total: 0, succeeded: 0, failed: 0, inFlight: 0 },
    { date: '2026-04-16', total: 9, succeeded: 7, failed: 2, inFlight: 0 },
  ],
  undatedCount: 1,
};

function makeStats(summary = sampleSummary): IRunStatsService {
  return {
    computeSummary: vi.fn(async () => summary),
    invalidate: vi.fn(),
  };
}

describe('escapeHtml', () => {
  it('escapes the five HTML metacharacters', () => {
    expect(escapeHtml(`<a href="x" class='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; class=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('coerces non-strings to string', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(null)).toBe('null');
  });
});

describe('generateNonce', () => {
  it('produces a 32-char alphanumeric string', () => {
    const n = generateNonce();
    expect(n).toMatch(/^[A-Za-z0-9]{32}$/);
  });

  it('returns a different value on each call', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      seen.add(generateNonce());
    }
    expect(seen.size).toBe(10);
  });
});

describe('renderSparkline', () => {
  it('returns empty string for empty data', () => {
    expect(renderSparkline([])).toBe('');
  });

  it('renders a polyline with one point per value', () => {
    const svg = renderSparkline([1, 2, 3, 4]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('<polyline');
    // four points → three commas inside the points attribute
    const pointsAttr = svg.match(/points="([^"]+)"/)?.[1] ?? '';
    expect(pointsAttr.split(' ')).toHaveLength(4);
  });

  it('handles a single value without dividing by zero', () => {
    const svg = renderSparkline([5]);
    expect(svg).toContain('points="0.00,0.00"');
  });
});

describe('renderDashboardHtml', () => {
  it('includes a CSP meta tag with the supplied source and nonce', () => {
    const html = renderDashboardHtml(sampleSummary, 'NONCE123', 'vscode-webview://x');
    expect(html).toContain(`'nonce-NONCE123'`);
    expect(html).toContain('vscode-webview://x');
    expect(html).toContain(`default-src 'none'`);
    expect(html).not.toContain('img-src vscode-webview://x data:');
  });

  it('renders the totals card and success-rate percentage', () => {
    const html = renderDashboardHtml(sampleSummary, 'N', 'csp');
    expect(html).toContain('<div class="v">12</div>');
    expect(html).toContain('75.0%');
  });

  it('renders one row per bucket', () => {
    const html = renderDashboardHtml(sampleSummary, 'N', 'csp');
    expect(html.match(/<tr>/g)?.length).toBe(1 + sampleSummary.buckets.length); // header + data rows
    expect(html).toContain('2026-04-14');
    expect(html).toContain('2026-04-16');
  });

  it('mentions undated count when > 0', () => {
    const html = renderDashboardHtml(sampleSummary, 'N', 'csp');
    expect(html).toContain('undated: 1');
  });

  it('omits undated count when 0', () => {
    const html = renderDashboardHtml({ ...sampleSummary, undatedCount: 0 }, 'N', 'csp');
    expect(html).not.toContain('undated:');
  });

  it('shows "no data" placeholder when buckets are empty', () => {
    const empty: RunStatsSummary = {
      windowDays: 7,
      totalRuns: 0,
      successRate: 0,
      buckets: [],
      undatedCount: 0,
    };
    const html = renderDashboardHtml(empty, 'N', 'csp');
    expect(html).toContain('no data');
  });

  it('escapes injected text', () => {
    const evil: RunStatsSummary = {
      windowDays: 7,
      totalRuns: 0,
      successRate: 0,
      buckets: [
        { date: '<script>alert(1)</script>', total: 0, succeeded: 0, failed: 0, inFlight: 0 },
      ],
      undatedCount: 0,
    };
    const html = renderDashboardHtml(evil, 'N', 'csp');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('DashboardPanel', () => {
  beforeEach(() => {
    // Force singleton reset between tests.
    DashboardPanel['current'] = undefined;
    vi.clearAllMocks();
  });

  it('exposes a default 14-day window', () => {
    expect(DEFAULT_DASHBOARD_WINDOW_DAYS).toBe(14);
  });

  it('createOrShow creates a webview and renders summary HTML', async () => {
    const stats = makeStats();
    const panel = DashboardPanel.createOrShow(stats);
    // Wait for the async refresh queued in the constructor.
    await new Promise((r) => setTimeout(r, 0));
    expect(stats.computeSummary).toHaveBeenCalledWith(DEFAULT_DASHBOARD_WINDOW_DAYS);
    expect(panel).toBeDefined();
    expect((vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('createOrShow returns the same instance on subsequent calls', () => {
    const stats = makeStats();
    const a = DashboardPanel.createOrShow(stats);
    const b = DashboardPanel.createOrShow(stats);
    expect(a).toBe(b);
    expect((vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('refresh invalidates the cache when the webview posts a refresh message', async () => {
    const stats = makeStats();
    DashboardPanel.createOrShow(stats);
    await new Promise((r) => setTimeout(r, 0));
    const lastCall = (vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>).mock.results[0].value;
    lastCall.webview._fireMessage({ type: 'refresh' });
    await new Promise((r) => setTimeout(r, 0));
    expect(stats.invalidate).toHaveBeenCalled();
    expect((stats.computeSummary as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('refresh renders an error page when computeSummary throws', async () => {
    const stats: IRunStatsService = {
      computeSummary: vi.fn(async () => { throw new Error('boom'); }),
      invalidate: vi.fn(),
    };
    DashboardPanel.createOrShow(stats);
    await new Promise((r) => setTimeout(r, 0));
    const panel = (vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(panel.webview.html).toContain('Failed to load dashboard');
    expect(panel.webview.html).toContain('boom');
    expect(panel.webview.html).toContain('img-src vscode-webview://mock;');
  });

  it('dispose clears the singleton', () => {
    const stats = makeStats();
    const p = DashboardPanel.createOrShow(stats);
    p.dispose();
    const p2 = DashboardPanel.createOrShow(stats);
    expect(p2).not.toBe(p);
  });
});
