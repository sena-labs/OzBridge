import { _electron, ElectronApplication, Page } from '@playwright/test';
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export interface LaunchedVSCode {
  app: ElectronApplication;
  window: Page;
  /** PID del processo principale (root dell'albero da monitorare). */
  pid: number;
  /** Cartella tmp usata come workspace. */
  workspacePath: string;
  /** Cartella tmp user-data. */
  userDataDir: string;
  /** Cartella tmp extensions-dir. */
  extensionsDir: string;
  /** Cleanup completo (chiude app + rimuove dirs). */
  dispose: () => Promise<void>;
}

export interface LaunchOptions {
  /** Path assoluto della radice dell'estensione (cartella con package.json). */
  extensionPath: string;
  /** Versione VS Code da scaricare (default: stable). */
  vscodeVersion?: string;
}

/**
 * Scarica VS Code (cache `.vscode-test/`), prepara workspace tmp e
 * lancia l'app con Playwright Electron + extensionDevelopmentPath.
 */
export async function launchVSCode(opts: LaunchOptions): Promise<LaunchedVSCode> {
  const vscodeExecutable = await downloadAndUnzipVSCode(opts.vscodeVersion ?? 'stable');
  const [cliArg] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutable);

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozbridge-e2e-'));
  const workspacePath = path.join(tmpRoot, 'workspace');
  const userDataDir = path.join(tmpRoot, 'user-data');
  const extensionsDir = path.join(tmpRoot, 'extensions');
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.mkdir(userDataDir, { recursive: true });
  await fs.mkdir(extensionsDir, { recursive: true });
  // Seed minimo del workspace.
  await fs.writeFile(path.join(workspacePath, 'README.md'), '# OzBridge E2E workspace\n', 'utf8');

  // Pre-seed user settings: disabilita Git autodetection (evita prompt
  // "A git repository was found in the parent folders…") e altri toast
  // che possono interferire con l'asserzione dei segnali UI.
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
    executablePath: vscodeExecutable,
    args: [
      // CLI bootstrap: alcuni VS Code richiedono di passare il modulo CLI come primo arg.
      cliArg,
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
      '--disable-extensions', // disabilita le estensioni utente; quella in dev resta attiva
      '--locale=en',
      workspacePath,
    ],
    env: {
      ...process.env,
      // Evita che l'estensione provi a scaricare/spawnare la CLI Oz vera.
      OZBRIDGE_E2E: '1',
    },
  });

  const window = await app.firstWindow({ timeout: 90_000 });
  await window.waitForLoadState('domcontentloaded');
  // Attendi che il workbench sia montato.
  await window.waitForSelector('.monaco-workbench', { timeout: 90_000 });

  const pid = (await getMainProcessPid(app)) ?? process.pid;

  const dispose = async () => {
    try {
      await app.close();
    } catch {
      /* ignora */
    }
    try {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignora */
    }
  };

  return { app, window, pid, workspacePath, userDataDir, extensionsDir, dispose };
}

async function getMainProcessPid(app: ElectronApplication): Promise<number | undefined> {
  try {
    return await app.evaluate(() => process.pid);
  } catch {
    return undefined;
  }
}

/** Apre la Command Palette ed esegue un comando esatto. */
export async function runCommand(window: Page, commandTitle: string): Promise<void> {
  // Ctrl+Shift+P / Cmd+Shift+P
  const isMac = process.platform === 'darwin';
  await window.keyboard.press(isMac ? 'Meta+Shift+P' : 'Control+Shift+P');
  const input = window.locator('.quick-input-widget input.input');
  await input.waitFor({ state: 'visible', timeout: 15_000 });
  await input.fill(`>${commandTitle}`);
  // Aspetta che la prima entry combaci.
  await window.waitForTimeout(250);
  await window.keyboard.press('Enter');
}
