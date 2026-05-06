import { _electron, ElectronApplication, Page } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { LaunchedVSCode } from './launchVscode';

/**
 * Cursor IDE is a fork of VS Code Electron with the same Extension API,
 * so we can drive it with the exact same Playwright Electron client used
 * for VS Code — we just need to skip the `@vscode/test-electron` download
 * step and point `executablePath` at the user's locally installed Cursor
 * binary instead.
 *
 * Gated launcher: returns `undefined` when `OZBRIDGE_E2E_CURSOR_PATH` is
 * unset so the suite can `test.skip` cleanly on CI machines without
 * Cursor installed. When set, the path must point at the Cursor.exe (or
 * Cursor.app) entry binary — typical locations:
 *
 *   Windows: `%LOCALAPPDATA%\Programs\cursor\Cursor.exe`
 *   macOS:   `/Applications/Cursor.app/Contents/MacOS/Cursor`
 *   Linux:   `/opt/Cursor/cursor` (or wherever your distro put it)
 */
export interface LaunchCursorOptions {
  /** Path absolute root of the extension (folder with package.json). */
  extensionPath: string;
  /** Optional override for the Cursor binary. Default: env var. */
  cursorBinaryPath?: string;
}

export function getCursorBinaryPath(opts: { cursorBinaryPath?: string }): string | undefined {
  const candidate = opts.cursorBinaryPath ?? process.env.OZBRIDGE_E2E_CURSOR_PATH;
  return candidate && candidate.trim().length > 0 ? candidate.trim() : undefined;
}

/** Cursor launcher result — extends `LaunchedVSCode` with the hermetic HOME path. */
export interface LaunchedCursor extends LaunchedVSCode {
  /** Tmp HOME directory the Cursor process was started with. The
   *  registrars resolve `~/.cursor/mcp.json` (and friends) under here. */
  homeDir: string;
}

export async function launchCursor(opts: LaunchCursorOptions): Promise<LaunchedCursor> {
  const cursorBinary = getCursorBinaryPath(opts);
  if (!cursorBinary) {
    throw new Error(
      'launchCursor: OZBRIDGE_E2E_CURSOR_PATH is not set. '
      + 'Point it at the Cursor binary (e.g. %LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe).',
    );
  }
  // Verify the binary exists before we try to spawn it; produces a much
  // friendlier error than Electron's silent launch failure.
  try {
    await fs.access(cursorBinary);
  } catch {
    throw new Error(`launchCursor: Cursor binary not found at ${cursorBinary}`);
  }

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozbridge-e2e-cursor-'));
  const workspacePath = path.join(tmpRoot, 'workspace');
  const userDataDir = path.join(tmpRoot, 'user-data');
  const extensionsDir = path.join(tmpRoot, 'extensions');
  // Hermetic HOME so the registrars (which write to `~/.cursor/mcp.json`,
  // `~/.claude.json`, etc. derived from `os.homedir()`) cannot mutate the
  // developer's real dotfiles. The cleanup in `dispose()` then wipes
  // every file the suite touched along with `tmpRoot`.
  const tmpHome = path.join(tmpRoot, 'home');
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.mkdir(userDataDir, { recursive: true });
  await fs.mkdir(extensionsDir, { recursive: true });
  await fs.mkdir(tmpHome, { recursive: true });
  await fs.writeFile(path.join(workspacePath, 'README.md'), '# OzBridge E2E workspace (Cursor)\n', 'utf8');

  const settingsDir = path.join(userDataDir, 'User');
  await fs.mkdir(settingsDir, { recursive: true });
  await fs.writeFile(
    path.join(settingsDir, 'settings.json'),
    JSON.stringify({
      'git.enabled': false,
      'git.autoRepositoryDetection': false,
      'git.openRepositoryInParentFolders': 'never',
      'workbench.startupEditor': 'none',
      'telemetry.telemetryLevel': 'off',
      'update.mode': 'none',
      'extensions.autoCheckUpdates': false,
      'extensions.autoUpdate': false,
    }, null, 2),
    'utf8',
  );

  const app = await _electron.launch({
    executablePath: cursorBinary,
    args: [
      `--extensionDevelopmentPath=${opts.extensionPath}`,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      '--disable-workspace-trust',
      '--disable-telemetry',
      '--disable-updates',
      '--disable-gpu',
      '--no-sandbox',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-extensions',
      '--locale=en',
      workspacePath,
    ],
    env: {
      ...process.env,
      OZBRIDGE_E2E: '1',
      // Hermetic HOME — see comment where `tmpHome` is created. Both
      // POSIX (`HOME`) and Windows (`USERPROFILE`) are set so
      // `os.homedir()` resolves to the temp directory regardless of
      // platform.
      HOME: tmpHome,
      USERPROFILE: tmpHome,
    },
  });

  const window = await app.firstWindow({ timeout: 90_000 });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('.monaco-workbench', { timeout: 90_000 });

  const pid = (await getMainProcessPid(app)) ?? process.pid;

  const dispose = async (): Promise<void> => {
    try { await app.close(); } catch { /* ignore */ }
    try { await fs.rm(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  return { app, window, pid, workspacePath, userDataDir, extensionsDir, homeDir: tmpHome, dispose };
}

async function getMainProcessPid(app: ElectronApplication): Promise<number | undefined> {
  try {
    return await app.evaluate(() => process.pid);
  } catch {
    return undefined;
  }
}

/**
 * Same Command-Palette helper as `launchVscode.ts`, copied here so the
 * Cursor spec doesn't need to import the VS Code helper just for one
 * function (and so a future Cursor-specific keyboard shortcut quirk
 * can be patched without touching the main suite).
 */
export async function runCommand(window: Page, commandTitle: string): Promise<void> {
  const isMac = process.platform === 'darwin';
  await window.keyboard.press(isMac ? 'Meta+Shift+P' : 'Control+Shift+P');
  const input = window.locator('.quick-input-widget input.input');
  await input.waitFor({ state: 'visible', timeout: 15_000 });
  await input.fill(`>${commandTitle}`);
  await window.waitForTimeout(250);
  await window.keyboard.press('Enter');
}
