/**
 * Coverage gap tests for extension.ts — fire-and-forget branches in activate().
 *
 * Covers:
 * - Line 43: configManager.onConfigChanged callback
 * - Lines 54-62: checkAvailability() → !available branch (warning + button)
 * - Line 65: checkAvailability() → .catch() branch
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter as NodeEventEmitter } from 'node:events';
import { workspace, window, chat, Uri, env } from './mocks/vscode.js';

// Mutable ref to control spawn behavior per-test
let spawnBehavior: 'available' | 'not-available' = 'available';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    if (spawnBehavior === 'sync-throw') {
      throw new Error('EPERM: operation not permitted');
    }
    const proc = Object.assign(new NodeEventEmitter(), {
      stdout: new NodeEventEmitter(),
      stderr: new NodeEventEmitter(),
      kill: vi.fn(),
    });
    process.nextTick(() => {
      if (spawnBehavior === 'not-available') {
        proc.emit('error', new Error('ENOENT: spawn oz not found'));
        return;
      }
      proc.stdout.emit('data', Buffer.from('{"version":"mock-1.0.0"}'));
      proc.emit('close', 0);
    });
    return proc;
  }),
}));

// Captured workspace.onDidChangeConfiguration listener
let configChangedListener: ((cfg: any) => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  spawnBehavior = 'available';
  configChangedListener = undefined;

  workspace.getConfiguration.mockReturnValue({
    get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
  });
  workspace.onDidChangeConfiguration.mockImplementation((cb: any) => {
    configChangedListener = cb;
    return { dispose: vi.fn() };
  });

  window.createOutputChannel.mockReturnValue({
    appendLine: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  });
  window.showWarningMessage.mockResolvedValue(undefined);

  chat.createChatParticipant.mockReturnValue({
    iconPath: undefined,
    followupProvider: undefined,
    dispose: vi.fn(),
  });
});

/** Flushes fire-and-forget promises. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 50); });
}

function createMockExtensionContext() {
  return {
    extensionUri: Uri.file('/ext'),
    subscriptions: [] as Array<{ dispose: () => void }>,
  };
}

describe('extension.ts — coverage gaps', () => {
  // -----------------------------------------------------------------------
  // Line 43: configManager.onConfigChanged callback
  // -----------------------------------------------------------------------
  it('dovrebbe loggare quando la configurazione cambia (riga 43)', async () => {
    const { activate } = await import('../src/extension.js');
    activate(createMockExtensionContext() as any);
    await flushMicrotasks();

    // Trigger workspace config change → ConfigManager fires onConfigChanged
    if (configChangedListener) {
      configChangedListener({ affectsConfiguration: () => true });
    }

    const ch = window.createOutputChannel.mock.results[0]?.value;
    const logs: string[] = ch?.appendLine.mock.calls.map((c: unknown[]) => c[0]) ?? [];
    expect(logs.some((l: string) => l.includes('Configuration changed'))).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Lines 54-62: checkAvailability → !available → warning + button
  // -----------------------------------------------------------------------
  it('dovrebbe mostrare warning se Oz CLI non è disponibile (righe 54-62)', async () => {
    spawnBehavior = 'not-available';

    const { activate } = await import('../src/extension.js');
    activate(createMockExtensionContext() as any);
    await flushMicrotasks();

    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Oz CLI not found'),
      'Install Warp',
    );
  });

  it('dovrebbe aprire URL download quando utente clicca "Installa Warp" (righe 58-61)', async () => {
    spawnBehavior = 'not-available';
    window.showWarningMessage.mockResolvedValue('Install Warp' as any);

    const { activate } = await import('../src/extension.js');
    activate(createMockExtensionContext() as any);
    await flushMicrotasks();

    expect(env.openExternal).toHaveBeenCalledWith(
      expect.objectContaining({
        fsPath: expect.stringContaining('warp.dev/download'),
      }),
    );
  });

  // -----------------------------------------------------------------------
  // Line 65: .catch() on the checkAvailability promise chain
  // Triggered when something inside the .then() handler throws.
  // -----------------------------------------------------------------------
  it('dovrebbe loggare errore se il .then() di checkAvailability lancia (riga 65)', async () => {
    spawnBehavior = 'not-available';
    // Make showWarningMessage throw synchronously → propagates to .catch()
    window.showWarningMessage.mockImplementation(() => {
      throw new Error('showWarningMessage exploded');
    });

    const { activate } = await import('../src/extension.js');
    activate(createMockExtensionContext() as any);
    await flushMicrotasks();

    const ch = window.createOutputChannel.mock.results[0]?.value;
    const logs: string[] = ch?.appendLine.mock.calls.map((c: unknown[]) => c[0]) ?? [];
    expect(logs.some((l: string) => l.includes('Availability check failed'))).toBe(true);
  });
});
