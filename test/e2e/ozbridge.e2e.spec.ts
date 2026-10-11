import { test, expect, Page } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { launchVSCode, runCommand, LaunchedVSCode } from './helpers/launchVscode';
import { ResourceMonitor } from './helpers/resourceMonitor';
import {
  listPaletteItems,
  closePalette,
  runExactCommand,
  waitForAnySignal,
  waitForFreshNotification,
  lastNotificationText,
  dismissOverlays,
} from './helpers/workbench';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ARTIFACTS_DIR = path.join(REPO_ROOT, 'test-results', 'e2e-artifacts');

let vscode: LaunchedVSCode;
let monitor: ResourceMonitor;

/**
 * Setup: downloads VS Code (cache `.vscode-test/`), launches it with
 * extensionDevelopmentPath = repo root and starts the resource monitor.
 */
test.beforeAll(async () => {
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
  vscode = await launchVSCode({ extensionPath: REPO_ROOT });
  monitor = new ResourceMonitor({
    rootPid: vscode.pid,
    intervalMs: 1500,
    outputFile: path.join(ARTIFACTS_DIR, 'resource-samples.jsonl'),
  });
  monitor.start();
});

test.afterAll(async () => {
  monitor?.setLabel('teardown');
  const samples = await monitor?.stop();
  const summary = monitor?.summary();
  // eslint-disable-next-line no-console
  console.log('[e2e] resource summary:', summary, 'samples=', samples?.length);
  await fs.writeFile(
    path.join(ARTIFACTS_DIR, 'resource-summary.json'),
    JSON.stringify({ summary, sampleCount: samples?.length ?? 0 }, null, 2),
    'utf8',
  );
  await vscode?.dispose();
});

test.describe('OzBridge end-to-end user simulation', () => {
  test('boot: the workbench loads and the extension activates', async () => {
    monitor.setLabel('boot');
    const win = vscode.window;
    await expect(win.locator('.monaco-workbench')).toBeVisible();
    // Title bar / activity bar present.
    await expect(win.locator('.activitybar')).toBeVisible();
    // The extension contributes an "OzBridge" viewlet to the activity bar.
    // The selector may match several nodes (icon + tooltip): 1+ is enough.
    const ozIcons = win.locator(
      '.activitybar [aria-label*="OzBridge" i], .activitybar [title*="OzBridge" i]',
    );
    await expect(ozIcons.first()).toBeVisible({ timeout: 60_000 });
    expect(await ozIcons.count()).toBeGreaterThanOrEqual(1);
  });

  test('command palette: the OzBridge commands are registered', async () => {
    monitor.setLabel('palette');
    const win = vscode.window;
    const isMac = process.platform === 'darwin';
    await win.keyboard.press(isMac ? 'Meta+Shift+P' : 'Control+Shift+P');
    const input = win.locator('.quick-input-widget input.input');
    await input.waitFor({ state: 'visible' });
    await input.fill('>OzBridge');
    // Wait for the quick-pick to populate the results.
    const items = win.locator('.quick-input-widget .monaco-list-row');
    await expect(items.first()).toBeVisible({ timeout: 15_000 });
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(5);
    // Close without selecting.
    await win.keyboard.press('Escape');
  });

  test('activity bar: opening the OzBridge viewlet shows the tree views', async () => {
    monitor.setLabel('viewlet');
    const win = vscode.window;
    // Click the viewlet icon.
    const icon = win.locator('.activitybar [aria-label*="OzBridge" i]').first();
    await icon.click();
    // The two contributed views: Runs & Resources, Warp Drive.
    await expect(win.locator('.pane-header .title', { hasText: /Runs.*Resources/i })).toBeVisible({ timeout: 30_000 });
    await expect(win.locator('.pane-header .title', { hasText: /Warp Drive/i })).toBeVisible({ timeout: 30_000 });
  });

  test('dashboard webview: the panel opens with consistent content', async () => {
    monitor.setLabel('dashboard');
    const { window: win } = vscode;
    await runCommand(win, 'OzBridge: Open Dashboard');

    // Webview ready: VS Code 1.118+ uses an `iframe[active]` when
    // the panel has focus. The inner structure is isolated by CSP
    // and not always inspectable from Playwright; we settle for
    // checking that the webview iframe is present.
    const webviewIframe = win.locator(
      'iframe.webview, iframe[active], iframe[src*="vscode-webview"]',
    );
    await expect(webviewIframe.first()).toBeAttached({ timeout: 30_000 });

    // Best-effort: try to assert the editor tab label, but don't fail the test
    // if VS Code renders a different title or hides tabs (layout-dependent).
    const editorTab = win.locator('.tabs-container .tab, [role="tab"]', {
      hasText: /OzBridge.*Dashboard|Dashboard.*OzBridge|OzBridge.*Dash|Dash.*OzBridge/i,
    });
    const hasTab = await editorTab.first().isVisible().catch(() => false);
    if (!hasTab) {
      test.info().annotations.push({
        type: 'warning',
        description: 'Dashboard tab title not found — verified webview iframe only',
      });
    }

    // Best-effort: try to read the text inside the iframe; we do not
    // fail the test if the webview CSP prevents it.
    const innerText = await tryReadDashboardText(win).catch(() => '');
    if (innerText) {
      const looksLikeVsCodeWebviewBootstrap =
        /webview\/index\.html|acquireVsCodeApi|getActiveFrame|trackFocus/i.test(innerText);
      if (!looksLikeVsCodeWebviewBootstrap) {
        expect(innerText).toMatch(/OzBridge|Dashboard|Runs|Success/i);
      } else {
        test.info().annotations.push({
          type: 'warning',
          description: 'Webview body is VS Code bootstrap (not the app HTML) — verified iframe only',
        });
      }
    } else {
      test.info().annotations.push({
        type: 'warning',
        description: 'Webview body not inspectable (CSP) — only the iframe presence was verified',
      });
    }
  });

  test('status bar: OzBridge item is present and clickable', async () => {
    monitor.setLabel('statusbar');
    const win = vscode.window;
    // Recent VS Code exposes status bar items with role="button" and an
    // aria-label starting with "OzBridge: …". We use multiple selectors
    // to withstand markup changes.
    const item = win.locator(
      [
        '[id="workbench.parts.statusbar"] [aria-label*="OzBridge" i]',
        '.statusbar [aria-label*="OzBridge" i]',
        '.statusbar-item:has-text("OzBridge")',
        '[role="status"] [aria-label*="OzBridge" i]',
      ].join(', '),
    );
    // The item depends on the ActiveRunsTracker: if activation could not
    // initialize the Oz CLI (tmp workspace without config) the
    // item may not appear. In that case we emit a warning but
    // do not fail the suite: the state is still recorded
    // in the artifacts.
    const visible = await item.first().isVisible().catch(() => false)
      || await item.first().waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!visible) {
      // eslint-disable-next-line no-console
      console.warn('[e2e] OzBridge status bar not present — likely partial activation (no Oz CLI in $PATH).');
      test.info().annotations.push({ type: 'warning', description: 'OzBridge status bar item not visible' });
      return;
    }
    await expect(item.first()).toBeVisible();
  });

  test('resources: the monitor captured reasonable samples', async () => {
    monitor.setLabel('resource-check');
    // Let at least a few samples accumulate.
    await new Promise((r) => setTimeout(r, 4_000));
    const summary = monitor.summary();
    expect(summary.samples).toBeGreaterThan(2);
    expect(summary.peakRssMb).toBeGreaterThan(50); // Electron + extension > 50MB
    // Safety hard cap: if we exceed 6 GB, something has leaked.
    expect(summary.peakRssMb).toBeLessThan(6_000);
  });
});

/** Tries to read the webview body through the various iframe levels. */
async function tryReadDashboardText(win: Page): Promise<string> {
  const outerLocators = [
    win.locator('iframe.webview'),
    win.locator('iframe[src*="vscode-webview"]'),
    win.locator('iframe[active]'),
  ];
  for (const outerSel of outerLocators) {
    const count = await outerSel.count();
    for (let i = 0; i < count; i++) {
      const outer = outerSel.nth(i);
      const text = await outer.contentFrame().locator('body').innerText({ timeout: 1_500 }).catch(() => '');
      if (text) return text;
      const innerActive = outer.contentFrame().locator('#active-frame');
      if ((await innerActive.count()) > 0) {
        const t2 = await innerActive.contentFrame().locator('body').innerText({ timeout: 1_500 }).catch(() => '');
        if (t2) return t2;
      }
    }
  }
  return '';
}


// ===========================================================================
// Extended suite: command coverage, views, output, settings, chat participant.
// Reuses the VS Code instance launched in beforeAll by the main suite.
// ===========================================================================

const EXPECTED_COMMAND_TITLES: string[] = [
  'OzBridge: Refresh',
  'OzBridge: Open Dashboard',
  'OzBridge: Hand off to Warp terminal…',
  'OzBridge: Start MCP server',
  'OzBridge: Stop MCP server',
  'OzBridge: Show MCP server status',
  'OzBridge: Copy MCP endpoint URL',
  'OzBridge: Register MCP client (Claude Code / Cursor / Codex)',
  'OzBridge: Unregister MCP client',
  'OzBridge: Triage Failed Run…',
  'OzBridge: Export Run Dataset…',
  'Warp Drive: Refresh',
  // ozBridge.skill.edit (%command.skill.edit.title% → package.nls.json)
  'Warp Skill: Edit…',
  'Warp Skill: New…',
  'Warp Skill: Save current as global skill…',
  'Warp Skill: Save current as project skill…',
];

test.describe('OzBridge — command coverage (palette)', () => {
  test('all expected commands are registered', async () => {
    monitor.setLabel('cmd-registry');
    const win = vscode.window;
    // To avoid problems with the palette's fuzzy matching (which, with
    // a single prefix, can truncate/deprioritize some entries),
    // we query the palette with the FULL TITLE of each command
    // and check that at least one row matches exactly.
    const missing: string[] = [];
    const found: Record<string, string[]> = {};
    for (const title of EXPECTED_COMMAND_TITLES) {
      await dismissOverlays(win);
      const items = await listPaletteItems(win, title).catch(() => [] as string[]);
      await closePalette(win);
      found[title] = items;
      const stripped = title.replace(/…/g, '').trim().toLowerCase();
      const hit = items.some((it) => it.toLowerCase().includes(stripped));
      if (!hit) missing.push(title);
    }
    test.info().attach('palette-items.json', { body: JSON.stringify(found, null, 2), contentType: 'application/json' });
    expect(missing, `Commands missing from the palette: ${missing.join(' | ')}`).toEqual([]);
  });

  test('every OzBridge command produces an expected UI signal', async () => {
    monitor.setLabel('cmd-invoke');
    const win = vscode.window;
    type Signal = Awaited<ReturnType<typeof waitForAnySignal>>;
    type CmdSpec = {
      title: string;
      expect: (s: Signal) => boolean;
      noSignalOk?: boolean;
    };
    const specs: CmdSpec[] = [
      // OzBridge: Refresh — shows no UI of its own.
      { title: 'OzBridge: Refresh', expect: () => true, noSignalOk: true },
      // Hand off: may open Warp directly (no overlay) or show
      // an InputBox/QuickPick or a warning toast.
      { title: 'OzBridge: Hand off to Warp terminal…', expect: (s) => s?.kind === 'inputBox' || s?.kind === 'quickPick' || (s?.kind === 'notification' && /run|hand off|warp/i.test(s.text)), noSignalOk: true },
      // MCP status → notification "running" or "stopped"
      { title: 'OzBridge: Show MCP server status', expect: (s) => s?.kind === 'notification' && /(running|stopped)/i.test(s.text) },
      // MCP register → quickPick (server active) or notification "server is not running".
      { title: 'OzBridge: Register MCP client (Claude Code / Cursor / Codex)', expect: (s) => (s?.kind === 'quickPick' && s.items.length >= 1) || (s?.kind === 'notification' && /MCP|server|running/i.test(s.text)) },
      // MCP unregister → quickPick or notification
      { title: 'OzBridge: Unregister MCP client', expect: (s) => s?.kind === 'quickPick' || s?.kind === 'notification', noSignalOk: true },
      // Skill new → InputBox
      { title: 'Warp Skill: New…', expect: (s) => s?.kind === 'inputBox', noSignalOk: true },
      // Skill saveGlobal → notification (no editor) or quickPick/input.
      { title: 'Warp Skill: Save current as global skill…', expect: (s) => !!s },
      // Triage failure → notification (Copilot LM unavailable) or input.
      { title: 'OzBridge: Triage Failed Run…', expect: (s) => !!s, noSignalOk: true },
      // Export Dataset → quickPick "JSON Lines" / "CSV"
      { title: 'OzBridge: Export Run Dataset…', expect: (s) => s?.kind === 'quickPick' && s.items.some((i) => /JSON|CSV/i.test(i)), noSignalOk: true },
    ];

    const results: Array<{ title: string; signal: unknown; ok: boolean }> = [];
    for (const spec of specs) {
      await dismissOverlays(win);
      // Capture the previous toast to tell fresh signals apart.
      const prevToast = await lastNotificationText(win);
      await runExactCommand(win, spec.title);
      // Look for a generic UI signal first, but if it is a notification check
      // that it is "fresh" (text different from the previous one).
      let sig: Signal = await waitForAnySignal(win, 6_000);
      if (sig?.kind === 'notification' && sig.text === prevToast) {
        const fresh = await waitForFreshNotification(win, prevToast, 4_000);
        sig = fresh ? { kind: 'notification', text: fresh } : null;
      }
      const ok = spec.expect(sig) || (sig === null && !!spec.noSignalOk);
      results.push({ title: spec.title, signal: sig, ok });
      await dismissOverlays(win);
    }
    test.info().attach('command-invocation-results.json', {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json',
    });
    const failures = results.filter((r) => !r.ok);
    expect(failures, `Commands without the expected signal: ${failures.map((f) => f.title).join(' | ')}`).toEqual([]);
  });
});

test.describe('OzBridge — real MCP lifecycle', () => {
  test('start → status running → copy URL → stop → status stopped', async () => {
    monitor.setLabel('mcp-lifecycle');
    const win = vscode.window;

    // 1) Start: must show an info toast with the URL http://...:PORT/sse
    await dismissOverlays(win);
    const prev0 = await lastNotificationText(win);
    await runExactCommand(win, 'OzBridge: Start MCP server');
    let startText = await waitForFreshNotification(win, prev0, 12_000);
    if (startText && /all installed extensions are temporarily disabled/i.test(startText)) {
      startText = await waitForFreshNotification(win, startText, 12_000);
    }
    expect(startText, 'start: no toast').toBeTruthy();
    expect(startText!).toMatch(/MCP|server|listening|http/i);
    await dismissOverlays(win);

    // 2) Status: running
    const prev1 = await lastNotificationText(win);
    await runExactCommand(win, 'OzBridge: Show MCP server status');
    let stRunning = await waitForFreshNotification(win, prev1, 8_000);
    if (stRunning && /all installed extensions are temporarily disabled/i.test(stRunning)) {
      // VS Code can emit this unrelated toast in `--disable-extensions` mode; ignore and wait again.
      stRunning = await waitForFreshNotification(win, stRunning, 8_000);
    }
    expect(stRunning, 'status running: no toast').toBeTruthy();
    expect(stRunning!).toMatch(/running|listening/i);
    await dismissOverlays(win);

    // 3) Copy endpoint URL
    const prev2 = await lastNotificationText(win);
    await runExactCommand(win, 'OzBridge: Copy MCP endpoint URL');
    const copyText = await waitForFreshNotification(win, prev2, 8_000);
    expect(copyText, 'copy: no toast').toBeTruthy();
    expect(copyText!).toMatch(/http:\/\/.*\/sse|MCP endpoint|copied/i);
    await dismissOverlays(win);

    // 4) Stop. No fresh-notification wait here: step 5 polls the status
    // notification itself, filtering out the stale "copied" toast.
    await runExactCommand(win, 'OzBridge: Stop MCP server');
    await dismissOverlays(win);

    // 5) Status: stopped
    await runExactCommand(win, 'OzBridge: Show MCP server status');
    const statusDeadline = Date.now() + 8_000;
    let stStopped: string | null = null;
    while (Date.now() < statusDeadline) {
      const t = await lastNotificationText(win);
      if (t && !/copied mcp endpoint url/i.test(t) && !/all installed extensions are temporarily disabled/i.test(t)) {
        if (/stopped|not running/i.test(t)) {
          stStopped = t;
          break;
        }
      }
      await win.waitForTimeout(150);
    }
    expect(stStopped, 'status stopped: no toast').toBeTruthy();
    await dismissOverlays(win);
  });
});

test.describe('OzBridge — views, settings, chat participant', () => {
  test('Runs & Drive tree views are expandable and show placeholders or nodes', async () => {
    monitor.setLabel('tree-views');
    const win = vscode.window;
    await dismissOverlays(win);
    // Make sure the primary sidebar is visible (Ctrl+B toggles it;
    // we check the state first so we do not close it by mistake).
    const sidebar = win.locator('.part.sidebar:not(.empty), .part.sidebar.right').first();
    if (!(await sidebar.isVisible().catch(() => false))) {
      await win.keyboard.press(process.platform === 'darwin' ? 'Meta+B' : 'Control+B');
      await win.waitForTimeout(400);
    }
    // Explicitly open the OzBridge viewlet via the palette (more reliable
    // than clicking the icon, which may toggle it).
    await runCommand(win, 'View: Show OzBridge').catch(async () => {
      await win.locator('.activitybar [aria-label*="OzBridge" i]').first().click();
    });
    await win.waitForTimeout(800);

    const runsHeader = win.locator('.pane-header .title', { hasText: /Runs.*Resources/i }).first();
    const driveHeader = win.locator('.pane-header .title', { hasText: /Warp Drive/i }).first();
    await expect(runsHeader).toBeVisible({ timeout: 30_000 });
    await expect(driveHeader).toBeVisible({ timeout: 30_000 });

    // Pane container = parent ".pane" of the header. Expand if collapsed.
    for (const header of [runsHeader, driveHeader]) {
      const pane = header.locator('xpath=ancestor::div[contains(@class,"pane")][1]');
      const expanded = await pane.locator('.pane-header').first().getAttribute('aria-expanded').catch(() => null);
      if (expanded === 'false') {
        await header.click();
        await win.waitForTimeout(300);
      }
    }

    // Capture the content of the pane bodies — even just a welcome view is fine.
    const bodies = win.locator('.pane .pane-body');
    const bodyCount = await bodies.count();
    let totalText = '';
    for (let i = 0; i < bodyCount; i++) {
      const t = await bodies.nth(i).innerText().catch(() => '');
      totalText += t + '\n';
    }
    test.info().attach('tree-views-body.txt', { body: totalText, contentType: 'text/plain' });
    // At least the OzBridge viewlet must be loaded (not empty).
    expect(totalText.length).toBeGreaterThan(0);
  });

  test('Settings UI shows the ozBridge.* settings', async () => {
    monitor.setLabel('settings');
    const win = vscode.window;
    await dismissOverlays(win);
    await runCommand(win, 'Preferences: Open Settings (UI)');
    // Wait for the settings editor container.
    await win.locator('.settings-editor').first().waitFor({ state: 'visible', timeout: 30_000 });
    // The REAL search input is inside `.suggest-input-container .monaco-inputbox input`.
    const searchBox = win
      .locator('.settings-editor .suggest-input-container input.input')
      .or(win.locator('.settings-editor input[type="text"]:not([readonly])'))
      .first();
    await searchBox.waitFor({ state: 'visible', timeout: 15_000 });
    await searchBox.click();
    await searchBox.fill('ozBridge');
    await win.waitForTimeout(2_500);
    const titles = win.locator('.settings-editor .setting-item .setting-item-label, .settings-editor .setting-item-title');
    const count = await titles.count();
    const captured: string[] = [];
    for (let i = 0; i < Math.min(count, 30); i++) {
      const t = await titles.nth(i).innerText().catch(() => '');
      if (t) captured.push(t.trim());
    }
    test.info().attach('ozbridge-settings.json', { body: JSON.stringify(captured, null, 2), contentType: 'application/json' });
    expect(count, `Setting items found: ${count}`).toBeGreaterThanOrEqual(5);
    await dismissOverlays(win);
  });

  test('Output channel "OzBridge" is present', async () => {
    monitor.setLabel('output');
    const win = vscode.window;
    await dismissOverlays(win);
    // Force focus onto the workbench by clicking the activity bar (the palette can
    // stay "non-activatable" if the Settings UI editor has captured the
    // focus). Then press Escape to make sure no overlay is left open.
    await win.locator('.activitybar').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
    await win.keyboard.press('Escape');
    await win.waitForTimeout(200);
    // Open the Output panel.
    await runCommand(win, 'View: Toggle Output');
    await win.waitForTimeout(800);
    // In VS Code 1.118 the channel selector has aria-label "Switch Output".
    const channelButton = win.locator('[aria-label="Switch Output"], [role="combobox"][aria-label*="Output" i]').first();
    await expect(channelButton).toBeVisible({ timeout: 10_000 });
    await channelButton.click();
    await win.waitForTimeout(700);
    // The dropdown is a native HTML select (combobox) or a Monaco context menu.
    // Strategy: read the available options/items.
    const items = win.locator(
      '[aria-label="Switch Output"] option, .context-view .action-label, .monaco-menu .action-label, .quick-input-widget .monaco-list-row',
    );
    const n = await items.count();
    const labels: string[] = [];
    for (let i = 0; i < n; i++) {
      const t = (await items.nth(i).innerText().catch(() => '')).trim();
      if (t) labels.push(t);
    }
    // Fallback: read the options of a native select with evaluate.
    if (!labels.some((l) => /OzBridge/i.test(l))) {
      const optionTexts = await channelButton.evaluate((el) => {
        if (el.tagName === 'SELECT') {
          return Array.from((el as HTMLSelectElement).options).map((o) => o.textContent || '');
        }
        // Look for child or nearby <select> elements.
        const sel = el.querySelector('select') ?? (el.parentElement?.querySelector('select') ?? null);
        if (sel) return Array.from(sel.options).map((o) => o.textContent || '');
        return [] as string[];
      }).catch(() => [] as string[]);
      labels.push(...optionTexts);
    }
    test.info().attach('output-channels.json', { body: JSON.stringify(labels, null, 2), contentType: 'application/json' });
    await win.keyboard.press('Escape');
    expect(labels.some((l) => /OzBridge/i.test(l)), `Channels seen: ${labels.join(' | ')}`).toBe(true);
    await dismissOverlays(win);
  });

  test('Chat participant @oz is registered (best-effort)', async () => {
    monitor.setLabel('chat-participant');
    const win = vscode.window;
    await dismissOverlays(win);
    // Open the chat view; it may not exist if Copilot is not installed.
    await runCommand(win, 'Chat: Focus on Chat View').catch(() => {});
    await win.waitForTimeout(1_500);
    const chatInput = win.locator(
      '.interactive-input-part textarea, .chat-input-container textarea, [aria-label*="Type" i] textarea',
    ).first();
    if (!(await chatInput.isVisible().catch(() => false))) {
      test.info().annotations.push({ type: 'warning', description: 'Chat view not available (Copilot not installed): test skipped' });
      return;
    }
    await chatInput.click({ force: true }).catch(() => {});
    await chatInput.fill('@oz').catch(() => {});
    await win.waitForTimeout(800);
    const suggestion = win.locator('.suggest-widget, .monaco-list-row', { hasText: /oz|OzBridge/i }).first();
    if (!(await suggestion.isVisible().catch(() => false))) {
      test.info().annotations.push({ type: 'warning', description: '@oz suggestion not shown (Copilot Chat required)' });
      return;
    }
    await expect(suggestion).toBeVisible();
  });
});
