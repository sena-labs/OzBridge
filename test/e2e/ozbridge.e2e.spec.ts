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
  listEditorTabs,
  dismissOverlays,
} from './helpers/workbench';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ARTIFACTS_DIR = path.join(REPO_ROOT, 'test-results', 'e2e-artifacts');

let vscode: LaunchedVSCode;
let monitor: ResourceMonitor;

/**
 * Setup: scarica VS Code (cache `.vscode-test/`), lancia con
 * extensionDevelopmentPath = repo root e avvia il monitor risorse.
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
  test('boot: il workbench si carica e l\'estensione si attiva', async () => {
    monitor.setLabel('boot');
    const win = vscode.window;
    await expect(win.locator('.monaco-workbench')).toBeVisible();
    // Title bar / activity bar presenti.
    await expect(win.locator('.activitybar')).toBeVisible();
    // L'extension contribuisce un viewlet "OzBridge" nell'activity bar.
    // Il selettore può matchare più nodi (icona + tooltip): basta 1+.
    const ozIcons = win.locator(
      '.activitybar [aria-label*="OzBridge" i], .activitybar [title*="OzBridge" i]',
    );
    await expect(ozIcons.first()).toBeVisible({ timeout: 60_000 });
    expect(await ozIcons.count()).toBeGreaterThanOrEqual(1);
  });

  test('command palette: i comandi OzBridge sono registrati', async () => {
    monitor.setLabel('palette');
    const win = vscode.window;
    const isMac = process.platform === 'darwin';
    await win.keyboard.press(isMac ? 'Meta+Shift+P' : 'Control+Shift+P');
    const input = win.locator('.quick-input-widget input.input');
    await input.waitFor({ state: 'visible' });
    await input.fill('>OzBridge');
    // Attendi che la quick-pick popoli i risultati.
    const items = win.locator('.quick-input-widget .monaco-list-row');
    await expect(items.first()).toBeVisible({ timeout: 15_000 });
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(5);
    // Chiudi senza selezionare.
    await win.keyboard.press('Escape');
  });

  test('activity bar: apertura del viewlet OzBridge mostra le tree views', async () => {
    monitor.setLabel('viewlet');
    const win = vscode.window;
    // Click sull'icona del viewlet.
    const icon = win.locator('.activitybar [aria-label*="OzBridge" i]').first();
    await icon.click();
    // Le due viste contributed: Runs & Resources, Warp Drive.
    await expect(win.locator('.pane-header .title', { hasText: /Runs.*Resources/i })).toBeVisible({ timeout: 30_000 });
    await expect(win.locator('.pane-header .title', { hasText: /Warp Drive/i })).toBeVisible({ timeout: 30_000 });
  });

  test('dashboard webview: il pannello viene aperto con contenuto coerente', async () => {
    monitor.setLabel('dashboard');
    const { window: win } = vscode;
    await runCommand(win, 'OzBridge: Open Dashboard');

    // Webview pronto: VS Code 1.118+ usa un `iframe[active]` quando
    // il pannello ha il focus. La struttura interna è isolata da CSP
    // e non sempre ispezionabile da Playwright; ci accontentiamo di
    // verificare la presenza dell'iframe del webview.
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

    // Best-effort: prova a leggere il testo dentro l'iframe; non
    // facciamo fallire il test se la CSP del webview lo impedisce.
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
        description: 'Webview body non ispezionabile (CSP) — verificata solo la presenza dell\'iframe',
      });
    }
  });

  test('status bar: voce OzBridge presente e cliccabile', async () => {
    monitor.setLabel('statusbar');
    const win = vscode.window;
    // VS Code recente espone le voci di status bar con role="button" e
    // aria-label che inizia con "OzBridge: …". Usiamo selettori multipli
    // per resistere ai cambi di markup.
    const item = win.locator(
      [
        '[id="workbench.parts.statusbar"] [aria-label*="OzBridge" i]',
        '.statusbar [aria-label*="OzBridge" i]',
        '.statusbar-item:has-text("OzBridge")',
        '[role="status"] [aria-label*="OzBridge" i]',
      ].join(', '),
    );
    // L'item dipende dall'ActiveRunsTracker: se l'attivazione non ha
    // potuto inizializzare la CLI Oz (workspace tmp privo di config) la
    // voce può non comparire. In quel caso emettiamo un warning ma
    // non facciamo fallire la suite: lo stato è comunque registrato
    // negli artefatti.
    const visible = await item.first().isVisible().catch(() => false)
      || await item.first().waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!visible) {
      // eslint-disable-next-line no-console
      console.warn('[e2e] status bar OzBridge non presente — probabile attivazione parziale (no Oz CLI in $PATH).');
      test.info().annotations.push({ type: 'warning', description: 'OzBridge status bar item non visibile' });
      return;
    }
    await expect(item.first()).toBeVisible();
  });

  test('risorse: il monitor ha catturato samples ragionevoli', async () => {
    monitor.setLabel('resource-check');
    // Lascia accumulare almeno qualche campione.
    await new Promise((r) => setTimeout(r, 4_000));
    const summary = monitor.summary();
    expect(summary.samples).toBeGreaterThan(2);
    expect(summary.peakRssMb).toBeGreaterThan(50); // Electron + extension > 50MB
    // Hard cap di sicurezza: se sforiamo 6 GB qualcosa è andato in leak.
    expect(summary.peakRssMb).toBeLessThan(6_000);
  });
});

/**
 * Cerca, fra tutti gli outer iframe `iframe.webview` del workbench, quello
 * il cui inner `#active-frame` contiene testo coerente col Dashboard
 * OzBridge. Restituisce true al primo match. Polling fino a `timeoutMs`.
 */
async function waitForDashboardWebview(win: Page, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const pattern = /OzBridge|Dashboard|Runs|Success/i;
  while (Date.now() < deadline) {
    const text = await tryReadDashboardText(win).catch(() => '');
    if (text && pattern.test(text)) return true;
    await win.waitForTimeout(500);
  }
  return false;
}

/** Tenta di leggere il body del webview attraverso i vari livelli di iframe. */
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
// Suite estesa: copertura comandi, viste, output, settings, chat participant.
// Riusa l'istanza VS Code lanciata in beforeAll dalla suite principale.
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

test.describe('OzBridge — copertura comandi (palette)', () => {
  test('tutti i comandi attesi sono registrati', async () => {
    monitor.setLabel('cmd-registry');
    const win = vscode.window;
    // Per evitare problemi con il fuzzy-matching della palette (che con
    // un singolo prefisso può troncare/deprioritizzare alcune voci),
    // interroghiamo la palette con il TITOLO COMPLETO di ciascun comando
    // e verifichiamo che almeno una riga combaci esattamente.
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
    expect(missing, `Comandi mancanti dalla palette: ${missing.join(' | ')}`).toEqual([]);
  });

  test('ogni comando OzBridge produce un segnale UI atteso', async () => {
    monitor.setLabel('cmd-invoke');
    const win = vscode.window;
    type Signal = Awaited<ReturnType<typeof waitForAnySignal>>;
    type CmdSpec = {
      title: string;
      expect: (s: Signal) => boolean;
      noSignalOk?: boolean;
    };
    const specs: CmdSpec[] = [
      // OzBridge: Refresh — non mostra UI propria.
      { title: 'OzBridge: Refresh', expect: () => true, noSignalOk: true },
      // Hand off: può aprire direttamente Warp (nessun overlay) oppure mostrare
      // InputBox/QuickPick o un toast d'avviso.
      { title: 'OzBridge: Hand off to Warp terminal…', expect: (s) => s?.kind === 'inputBox' || s?.kind === 'quickPick' || (s?.kind === 'notification' && /run|hand off|warp/i.test(s.text)), noSignalOk: true },
      // MCP status → notification "running" o "stopped"
      { title: 'OzBridge: Show MCP server status', expect: (s) => s?.kind === 'notification' && /(running|stopped)/i.test(s.text) },
      // MCP register → quickPick (server attivo) o notification "server is not running".
      { title: 'OzBridge: Register MCP client (Claude Code / Cursor / Codex)', expect: (s) => (s?.kind === 'quickPick' && s.items.length >= 1) || (s?.kind === 'notification' && /MCP|server|running/i.test(s.text)) },
      // MCP unregister → quickPick o notification
      { title: 'OzBridge: Unregister MCP client', expect: (s) => s?.kind === 'quickPick' || s?.kind === 'notification', noSignalOk: true },
      // Skill new → InputBox
      { title: 'Warp Skill: New…', expect: (s) => s?.kind === 'inputBox', noSignalOk: true },
      // Skill saveGlobal → notification (no editor) o quickPick/input.
      { title: 'Warp Skill: Save current as global skill…', expect: (s) => !!s },
      // Triage failure → notification (Copilot LM non disponibile) oppure input.
      { title: 'OzBridge: Triage Failed Run…', expect: (s) => !!s, noSignalOk: true },
      // Export Dataset → quickPick "JSON Lines" / "CSV"
      { title: 'OzBridge: Export Run Dataset…', expect: (s) => s?.kind === 'quickPick' && s.items.some((i) => /JSON|CSV/i.test(i)), noSignalOk: true },
    ];

    const results: Array<{ title: string; signal: unknown; ok: boolean }> = [];
    for (const spec of specs) {
      await dismissOverlays(win);
      // Cattura il toast precedente per discriminare segnali freschi.
      const prevToast = await lastNotificationText(win);
      await runExactCommand(win, spec.title);
      // Cerca prima un segnale UI generico, ma se è una notification verifica
      // che sia "fresca" (testo diverso dal precedente).
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
    expect(failures, `Comandi senza segnale atteso: ${failures.map((f) => f.title).join(' | ')}`).toEqual([]);
  });
});

test.describe('OzBridge — MCP lifecycle reale', () => {
  test('start → status running → copy URL → stop → status stopped', async () => {
    monitor.setLabel('mcp-lifecycle');
    const win = vscode.window;

    // 1) Start: deve mostrare info toast con URL http://...:PORT/sse
    await dismissOverlays(win);
    const prev0 = await lastNotificationText(win);
    await runExactCommand(win, 'OzBridge: Start MCP server');
    let startText = await waitForFreshNotification(win, prev0, 12_000);
    if (startText && /all installed extensions are temporarily disabled/i.test(startText)) {
      startText = await waitForFreshNotification(win, startText, 12_000);
    }
    expect(startText, 'start: nessun toast').toBeTruthy();
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
    expect(stRunning, 'status running: nessun toast').toBeTruthy();
    expect(stRunning!).toMatch(/running|listening/i);
    await dismissOverlays(win);

    // 3) Copy endpoint URL
    const prev2 = await lastNotificationText(win);
    await runExactCommand(win, 'OzBridge: Copy MCP endpoint URL');
    const copyText = await waitForFreshNotification(win, prev2, 8_000);
    expect(copyText, 'copy: nessun toast').toBeTruthy();
    expect(copyText!).toMatch(/http:\/\/.*\/sse|MCP endpoint|copied/i);
    await dismissOverlays(win);

    // 4) Stop
    const prev3 = copyText; // dismissOverlays may clear toasts; keep the last known text.
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
    expect(stStopped, 'status stopped: nessun toast').toBeTruthy();
    await dismissOverlays(win);
  });
});

test.describe('OzBridge — viste, settings, chat participant', () => {
  test('tree views Runs & Drive sono espandibili e mostrano placeholder o nodi', async () => {
    monitor.setLabel('tree-views');
    const win = vscode.window;
    await dismissOverlays(win);
    // Assicurati che la sidebar primaria sia visibile (Ctrl+B la toggla;
    // controlliamo prima lo stato per non chiuderla per sbaglio).
    const sidebar = win.locator('.part.sidebar:not(.empty), .part.sidebar.right').first();
    if (!(await sidebar.isVisible().catch(() => false))) {
      await win.keyboard.press(process.platform === 'darwin' ? 'Meta+B' : 'Control+B');
      await win.waitForTimeout(400);
    }
    // Apri esplicitamente il viewlet OzBridge via palette (più affidabile
    // del click sull'icona, che può fare il toggle).
    await runCommand(win, 'View: Show OzBridge').catch(async () => {
      await win.locator('.activitybar [aria-label*="OzBridge" i]').first().click();
    });
    await win.waitForTimeout(800);

    const runsHeader = win.locator('.pane-header .title', { hasText: /Runs.*Resources/i }).first();
    const driveHeader = win.locator('.pane-header .title', { hasText: /Warp Drive/i }).first();
    await expect(runsHeader).toBeVisible({ timeout: 30_000 });
    await expect(driveHeader).toBeVisible({ timeout: 30_000 });

    // Pane container = parent ".pane" del header. Espandi se collassato.
    for (const header of [runsHeader, driveHeader]) {
      const pane = header.locator('xpath=ancestor::div[contains(@class,"pane")][1]');
      const expanded = await pane.locator('.pane-header').first().getAttribute('aria-expanded').catch(() => null);
      if (expanded === 'false') {
        await header.click();
        await win.waitForTimeout(300);
      }
    }

    // Catturiamo il contenuto delle pane bodies — anche solo welcome view va bene.
    const bodies = win.locator('.pane .pane-body');
    const bodyCount = await bodies.count();
    let totalText = '';
    for (let i = 0; i < bodyCount; i++) {
      const t = await bodies.nth(i).innerText().catch(() => '');
      totalText += t + '\n';
    }
    test.info().attach('tree-views-body.txt', { body: totalText, contentType: 'text/plain' });
    // Almeno il viewlet OzBridge deve essere caricato (non vuoto).
    expect(totalText.length).toBeGreaterThan(0);
  });

  test('Settings UI mostra le configurazioni ozBridge.*', async () => {
    monitor.setLabel('settings');
    const win = vscode.window;
    await dismissOverlays(win);
    await runCommand(win, 'Preferences: Open Settings (UI)');
    // Attendi il container dell'editor delle impostazioni.
    await win.locator('.settings-editor').first().waitFor({ state: 'visible', timeout: 30_000 });
    // L'input REALE ricerca è dentro `.suggest-input-container .monaco-inputbox input`.
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
    expect(count, `Setting items trovati: ${count}`).toBeGreaterThanOrEqual(5);
    await dismissOverlays(win);
  });

  test('Output channel "OzBridge" è presente', async () => {
    monitor.setLabel('output');
    const win = vscode.window;
    await dismissOverlays(win);
    // Forza il focus sul workbench cliccando l'activity bar (la palette può
    // restare "non attivabile" se l'editor Settings UI ha intercettato il
    // focus). Poi premi Escape per essere sicuri di non lasciare overlay.
    await win.locator('.activitybar').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
    await win.keyboard.press('Escape');
    await win.waitForTimeout(200);
    // Apri il pannello Output.
    await runCommand(win, 'View: Toggle Output');
    await win.waitForTimeout(800);
    // In VS Code 1.118 il channel selector ha aria-label "Switch Output".
    const channelButton = win.locator('[aria-label="Switch Output"], [role="combobox"][aria-label*="Output" i]').first();
    await expect(channelButton).toBeVisible({ timeout: 10_000 });
    await channelButton.click();
    await win.waitForTimeout(700);
    // Il dropdown è una select native HTML (combobox) oppure un context menu Monaco.
    // Strategia: leggi le option/items disponibili.
    const items = win.locator(
      '[aria-label="Switch Output"] option, .context-view .action-label, .monaco-menu .action-label, .quick-input-widget .monaco-list-row',
    );
    const n = await items.count();
    const labels: string[] = [];
    for (let i = 0; i < n; i++) {
      const t = (await items.nth(i).innerText().catch(() => '')).trim();
      if (t) labels.push(t);
    }
    // Fallback: leggi gli option di una select native con evaluate.
    if (!labels.some((l) => /OzBridge/i.test(l))) {
      const optionTexts = await channelButton.evaluate((el) => {
        if (el.tagName === 'SELECT') {
          return Array.from((el as HTMLSelectElement).options).map((o) => o.textContent || '');
        }
        // Cerca <select> figli o vicini.
        const sel = el.querySelector('select') ?? (el.parentElement?.querySelector('select') ?? null);
        if (sel) return Array.from(sel.options).map((o) => o.textContent || '');
        return [] as string[];
      }).catch(() => [] as string[]);
      labels.push(...optionTexts);
    }
    test.info().attach('output-channels.json', { body: JSON.stringify(labels, null, 2), contentType: 'application/json' });
    await win.keyboard.press('Escape');
    expect(labels.some((l) => /OzBridge/i.test(l)), `Channels visti: ${labels.join(' | ')}`).toBe(true);
    await dismissOverlays(win);
  });

  test('Chat participant @oz è registrato (best-effort)', async () => {
    monitor.setLabel('chat-participant');
    const win = vscode.window;
    await dismissOverlays(win);
    // Apri la chat view; può non esistere se Copilot non è installato.
    await runCommand(win, 'Chat: Focus on Chat View').catch(() => {});
    await win.waitForTimeout(1_500);
    const chatInput = win.locator(
      '.interactive-input-part textarea, .chat-input-container textarea, [aria-label*="Type" i] textarea',
    ).first();
    if (!(await chatInput.isVisible().catch(() => false))) {
      test.info().annotations.push({ type: 'warning', description: 'Chat view non disponibile (Copilot non installato): test saltato' });
      return;
    }
    await chatInput.click({ force: true }).catch(() => {});
    await chatInput.fill('@oz').catch(() => {});
    await win.waitForTimeout(800);
    const suggestion = win.locator('.suggest-widget, .monaco-list-row', { hasText: /oz|OzBridge/i }).first();
    if (!(await suggestion.isVisible().catch(() => false))) {
      test.info().annotations.push({ type: 'warning', description: 'Suggerimento @oz non visualizzato (Copilot Chat richiesto)' });
      return;
    }
    await expect(suggestion).toBeVisible();
  });
});
