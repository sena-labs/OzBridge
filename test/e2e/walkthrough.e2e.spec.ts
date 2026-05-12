import { test, expect } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { launchVSCode, runCommand, LaunchedVSCode } from './helpers/launchVscode';

/**
 * Walkthrough end-to-end: simula un utente reale che usa l'estensione su
 * VS Code (Electron) e cattura screenshot + un video da consegnare come
 * artefatti (`/opt/cursor/artifacts`). Voluto piccolo e deterministico:
 * apre il workbench, ispeziona l'activity bar, la palette, le tree views,
 * la dashboard e la Settings UI con `ozBridge.*`. Verifica anche che il
 * fix di `promptExpander` (alias `#warp.*`) sia presente nel bundle
 * caricato da VS Code.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ARTIFACTS_DIR = path.join(REPO_ROOT, 'test-results', 'e2e-artifacts');

let vscode: LaunchedVSCode;

test.beforeAll(async () => {
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
  vscode = await launchVSCode({ extensionPath: REPO_ROOT });
});

test.afterAll(async () => {
  await vscode?.dispose();
});

test('walkthrough: utente reale apre VS Code, sidebar, palette, dashboard, settings', async () => {
  test.setTimeout(180_000);
  const win = vscode.window;

  // 1) Workbench loaded.
  await expect(win.locator('.monaco-workbench')).toBeVisible({ timeout: 60_000 });

  // 2) Activity bar mostra l'icona OzBridge.
  const ozIcons = win.locator('.activitybar [aria-label*="OzBridge" i]');
  await expect(ozIcons.first()).toBeVisible({ timeout: 60_000 });
  await win.screenshot({ path: path.join(ARTIFACTS_DIR, 'screenshot_e2e_1_workbench.png') });

  // 3) Apri il viewlet OzBridge dall'activity bar.
  await ozIcons.first().click();
  await expect(win.locator('.pane-header .title', { hasText: /Runs.*Resources/i })).toBeVisible({ timeout: 30_000 });
  await expect(win.locator('.pane-header .title', { hasText: /Warp Drive/i })).toBeVisible({ timeout: 30_000 });
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(ARTIFACTS_DIR, 'screenshot_e2e_2_sidebar.png') });

  // 4) Command palette: comandi OzBridge presenti.
  const isMac = process.platform === 'darwin';
  await win.keyboard.press(isMac ? 'Meta+Shift+P' : 'Control+Shift+P');
  const input = win.locator('.quick-input-widget input.input');
  await input.waitFor({ state: 'visible', timeout: 15_000 });
  await input.click();
  await win.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
  await win.keyboard.press('Backspace');
  await win.keyboard.type('>OzBridge');
  await win.waitForTimeout(900);
  const items = win.locator('.quick-input-widget .monaco-list-row');
  await expect(items.first()).toBeVisible({ timeout: 15_000 });
  const paletteCount = await items.count();
  expect(paletteCount).toBeGreaterThanOrEqual(5);
  await win.screenshot({ path: path.join(ARTIFACTS_DIR, 'screenshot_e2e_3_palette.png') });
  await win.keyboard.press('Escape');
  await win.locator('.quick-input-widget').waitFor({ state: 'hidden', timeout: 4_000 }).catch(() => undefined);

  // 5) Apri Settings UI e filtra per ozBridge.*
  await runCommand(win, 'Preferences: Open Settings (UI)');
  await win.locator('.settings-editor').first().waitFor({ state: 'visible', timeout: 30_000 });
  const searchBox = win
    .locator('.settings-editor .suggest-input-container input.input')
    .or(win.locator('.settings-editor input[type="text"]:not([readonly])'))
    .first();
  await searchBox.waitFor({ state: 'visible', timeout: 15_000 });
  await searchBox.click();
  await searchBox.fill('ozBridge');
  await win.waitForTimeout(2_500);
  const settingTitles = win.locator('.settings-editor .setting-item .setting-item-label, .settings-editor .setting-item-title');
  expect(await settingTitles.count()).toBeGreaterThanOrEqual(5);
  await win.screenshot({ path: path.join(ARTIFACTS_DIR, 'screenshot_e2e_4_settings.png') });

  // 6) Dashboard: apri il webview e attendi che la tab editor compaia.
  await win.keyboard.press('Escape');
  await runCommand(win, 'OzBridge: Open Dashboard');
  // Attendi un po' qualunque tab/iframe webview comparire.
  const webviewIframe = win.locator('iframe.webview, iframe[src*="vscode-webview"]');
  await expect(webviewIframe.first()).toBeAttached({ timeout: 60_000 });
  await win.waitForTimeout(1_500);
  await win.screenshot({ path: path.join(ARTIFACTS_DIR, 'screenshot_e2e_5_dashboard.png') });

  // 7) Verifica che il bundle di estensione caricato contenga il fix
  // del promptExpander: leggiamo dist/extension.js e cerchiamo i
  // marcatori del nuovo TOKEN_REGEX (`warp.env|warp.profile|warp.model`).
  const bundle = await fs.readFile(path.join(REPO_ROOT, 'dist', 'extension.js'), 'utf8');
  expect(bundle).toContain('warp\\.env');
  expect(bundle).toContain('warp\\.profile');
  expect(bundle).toContain('warp\\.model');
});
