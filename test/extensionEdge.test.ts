/**
 * Coverage gap tests for extension.ts — fire-and-forget branches in activate().
 *
 * Covers:
 * - Line 43: configManager.onConfigChanged callback
 * - lazy activation does not probe Oz CLI or show install prompts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter as NodeEventEmitter } from 'node:events';
import { workspace, window, chat, Uri, env } from './mocks/vscode.js';

// Mutable ref to control spawn behavior per-test
let spawnBehavior: 'available' | 'not-available' | 'sync-throw' = 'available';

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
  // C-M3: deterministic drain via setImmediate (was setTimeout(50) — flaky).
  return new Promise((resolve) => { setImmediate(resolve); });
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
  // Lazy activation: checkAvailability is no longer run during activate()
  // -----------------------------------------------------------------------
  it('non dovrebbe mostrare warning se Oz CLI non è disponibile durante activate()', async () => {
    spawnBehavior = 'not-available';

    const { activate } = await import('../src/extension.js');
    activate(createMockExtensionContext() as any);
    await flushMicrotasks();
    expect(window.showWarningMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('Oz CLI not found'),
      expect.anything(),
    );
  });

  it('non dovrebbe aprire URL download durante activate()', async () => {
    spawnBehavior = 'not-available';
    window.showWarningMessage.mockResolvedValue('Install Warp' as any);

    const { activate } = await import('../src/extension.js');
    activate(createMockExtensionContext() as any);
    await flushMicrotasks();

    expect(env.openExternal).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Sync spawn errors must not affect activation because no spawn is attempted.
  // -----------------------------------------------------------------------
  it('non dovrebbe loggare availability failure durante activate()', async () => {
    spawnBehavior = 'sync-throw';

    const { activate } = await import('../src/extension.js');
    activate(createMockExtensionContext() as any);
    await flushMicrotasks();

    const ch = window.createOutputChannel.mock.results[0]?.value;
    const logs: string[] = ch?.appendLine.mock.calls.map((c: unknown[]) => c[0]) ?? [];
    expect(logs.some((l: string) => l.includes('Availability check failed'))).toBe(false);
  });
});
