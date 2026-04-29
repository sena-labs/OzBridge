#!/usr/bin/env node
// ---------------------------------------------------------------------------
// capture.mjs — Playwright + @vscode/test-electron screenshot harness
// ---------------------------------------------------------------------------
//
// Downloads a stable VS Code build, launches it via Playwright's
// `_electron` driver with the OzBridge extension loaded in development
// mode, then captures a deterministic set of screenshots into `media/`.
//
// Why Playwright + test-electron (not just one of them):
//   - `@vscode/test-electron` knows how to download + cache VS Code per
//     platform, but it only exposes a CDP port — we still need an actual
//     driver to control the window.
//   - Playwright's `_electron` consumes a path to an Electron binary
//     and gives back full DOM access (locators, screenshots, waits).
//   - Combining the two is the pattern Playwright's own VS Code
//     extension uses (see microsoft/playwright-vscode).
//
// CLI: `npm run screenshots:build`
// Optional env:
//   - SHOTS=hero,runs,drive,mcp,dashboard  (default: all)
//   - KEEP_OPEN=1  (leave VS Code open after capture; useful for tweaking)
//
// All artefacts land in `media/` and are committed by the human after a
// visual inspection.

import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MEDIA_DIR = path.join(REPO_ROOT, 'media');
const FIXTURE_DIR = path.join(__dirname, 'fixture');
const FAKE_OZ_BIN = process.platform === 'win32'
  ? path.join(__dirname, 'fake-oz.cmd')
  : path.join(__dirname, 'fake-oz.sh');

const VIEWPORT = { width: 1440, height: 900 };

const SHOTS = (process.env.SHOTS ?? 'hero,runs,drive,mcp,dashboard')
  .split(',').map((s) => s.trim()).filter(Boolean);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  process.stdout.write(`[capture] ${msg}\n`);
}

function ensureFakeOzExecutable() {
  if (process.platform !== 'win32') {
    // chmod +x on the .sh wrapper so VS Code can spawn it directly.
    chmodSync(FAKE_OZ_BIN, 0o755);
    chmodSync(path.join(__dirname, 'fake-oz.mjs'), 0o755);
  }
}

function buildUserDataDir() {
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'ozbridge-shots-'));
  const userDir = path.join(userDataDir, 'User');
  mkdirSync(userDir, { recursive: true });

  const tmpl = path.join(FIXTURE_DIR, 'settings.template.json');
  const settingsRaw = readFileSync(tmpl, 'utf8');
  // Settings JSON requires forward slashes on Windows too (avoids escape
  // hassles). VS Code accepts both, so normalise.
  const settings = settingsRaw.replace('__OZ_PATH__',
    FAKE_OZ_BIN.replace(/\\/g, '/'));
  writeFileSync(path.join(userDir, 'settings.json'), settings, 'utf8');
  return userDataDir;
}

async function waitMs(page, ms) {
  await page.waitForTimeout(ms);
}

async function executeCommand(page, command) {
  // Open command palette and run a VS Code command id deterministically.
  await page.keyboard.press('F1');
  // Wait for the quick input box to be visible.
  const input = page.locator('.quick-input-widget input.input').first();
  await input.waitFor({ state: 'visible', timeout: 10_000 });
  // Use ">command" syntax to ensure command palette mode.
  await input.fill(`>${command}`);
  await waitMs(page, 250);
  await page.keyboard.press('Enter');
}

async function focusOzBridgeSidebar(page) {
  await executeCommand(page, 'View: Show OzBridge');
  await waitMs(page, 800);
}

async function snapshot(page, name) {
  const file = path.join(MEDIA_DIR, name);
  await page.screenshot({ path: file, type: 'png' });
  log(`wrote ${path.relative(REPO_ROOT, file)}`);
}

async function snapshotElement(page, selector, name) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible', timeout: 10_000 });
  const file = path.join(MEDIA_DIR, name);
  await el.screenshot({ path: file, type: 'png' });
  log(`wrote ${path.relative(REPO_ROOT, file)} (clip: ${selector})`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  ensureFakeOzExecutable();

  log('downloading VS Code (cached after first run)…');
  const vscodeExecutable = await downloadAndUnzipVSCode('stable');
  log(`vscode binary: ${vscodeExecutable}`);

  const userDataDir = buildUserDataDir();
  log(`user-data-dir: ${userDataDir}`);

  // Use the repo root itself as the workspace folder — it has tsconfig,
  // package.json, etc., which keeps the explorer realistic without
  // needing fake content.
  const workspaceFolder = REPO_ROOT;

  log('launching VS Code…');
  const electronApp = await electron.launch({
    executablePath: vscodeExecutable,
    args: [
      `--extensionDevelopmentPath=${REPO_ROOT}`,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${path.join(userDataDir, 'extensions')}`,
      '--disable-workspace-trust',
      '--disable-telemetry',
      '--disable-updates',
      '--disable-gpu-sandbox',
      '--no-sandbox',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-extension=ms-vscode.references-view',
      workspaceFolder,
    ],
    env: {
      ...process.env,
      VSCODE_SKIP_PRELAUNCH: '1',
    },
    timeout: 60_000,
  });

  const page = await electronApp.firstWindow();
  await page.setViewportSize(VIEWPORT);

  // Wait until the workbench shell is rendered. The status bar is the
  // last bit to appear.
  log('waiting for workbench…');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('.statusbar').waitFor({ state: 'visible', timeout: 30_000 });
  // Wait for extension activation to finish ("Activating Extensions…" item
  // disappears from the status bar).
  log('waiting for extensions to activate…');
  await page.waitForFunction(
    () => !document.body.innerText.includes('Activating Extensions'),
    { timeout: 60_000 },
  ).catch(() => { /* best-effort */ });
  await waitMs(page, 2500);

  try {
    if (SHOTS.includes('hero') || SHOTS.includes('runs') || SHOTS.includes('mcp')) {
      log('focusing OzBridge sidebar…');
      await focusOzBridgeSidebar(page);
      await waitMs(page, 1200);
      // Trigger explicit refresh on both providers so they spawn the
      // fake-oz CLI and populate fixture data instead of the
      // "No runs yet" / "No prompts yet" placeholders.
      await executeCommand(page, 'OzBridge: Refresh');
      await waitMs(page, 1500);
      await executeCommand(page, 'Warp Drive: Refresh');
      await waitMs(page, 1500);

      if (SHOTS.includes('hero')) {
        await snapshot(page, 'screenshot.png');
      }
      if (SHOTS.includes('runs')) {
        // Capture just the sidebar pane.
        await snapshotElement(
          page,
          '.part.sidebar',
          'screenshot-runs.png',
        );
      }
      if (SHOTS.includes('mcp')) {
        // Same sidebar; the MCP category is one of the 5 visible.
        await snapshotElement(
          page,
          '.part.sidebar',
          'screenshot-mcp.png',
        );
      }
    }

    if (SHOTS.includes('drive')) {
      log('opening Drive view…');
      // Focus the Warp Drive view (auto-generated command from view id).
      await executeCommand(page, 'Focus on Warp Drive View');
      await waitMs(page, 800);
      await executeCommand(page, 'Warp Drive: Refresh');
      await waitMs(page, 1500);
      // Expand Prompts / Rules / Skills categories so the screenshot
      // shows actual fixture entries instead of three collapsed headers.
      for (const label of ['Prompts', 'Rules', 'Skills']) {
        const row = page
          .locator(`.pane:has(.title:has-text("Warp Drive")) .monaco-list-row[aria-label^="${label}"]`)
          .first();
        if (await row.count()) {
          await row.click();
          // Right arrow guarantees expansion (idempotent if already open).
          await page.keyboard.press('ArrowRight');
          await waitMs(page, 250);
        }
      }
      await waitMs(page, 600);
      await snapshotElement(
        page,
        '.part.sidebar',
        'screenshot-drive.png',
      );
    }

    if (SHOTS.includes('dashboard')) {
      log('opening dashboard webview…');
      await executeCommand(page, 'OzBridge: Open Dashboard');
      // The webview lives in an <iframe> inside the editor area.
      const editor = page.locator('.editor-instance, .part.editor').first();
      await editor.waitFor({ state: 'visible', timeout: 15_000 });
      // Webview render + computeSummary needs to finish (10 fixture runs
      // x 2 calls each = ~20 fake-oz spawns).
      await waitMs(page, 6000);
      await snapshot(page, 'screenshot-dashboard.png');
    }
  } finally {
    if (process.env.KEEP_OPEN === '1') {
      log('KEEP_OPEN=1 — leaving VS Code open. Press Ctrl+C to exit.');
      await new Promise(() => {});
    }
    await electronApp.close().catch(() => {});
    rmSync(userDataDir, { recursive: true, force: true });
  }

  log('done.');
}

main().catch((err) => {
  process.stderr.write(`[capture] FATAL: ${err?.stack ?? String(err)}\n`);
  process.exit(1);
});
