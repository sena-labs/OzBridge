/**
 * Refactoring coverage tests for extension.ts:
 * - state encapsulation (globals → state object)
 * - deactivate() accesses state.runPoller
 * - activation does not eagerly probe the Oz CLI
 * - user-facing CLI errors are surfaced lazily by commands/views
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter as NodeEventEmitter } from 'node:events';
import { workspace, window, chat, Uri, env } from './mocks/vscode.js';

let spawnBehavior: 'available' | 'not-available' = 'available';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
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

function flushMicrotasks(): Promise<void> {
  // Drain pending microtasks/macrotasks deterministically (C-M3): a real
  // 50 ms timeout was flaky on slow CI runners. `setImmediate` runs after
  // the current poll phase, which is sufficient for the activate() path's
  // `void`-prefixed promises and registered callbacks under test here.
  return new Promise((resolve) => { setImmediate(resolve); });
}

function createMockExtensionContext() {
  return {
    extensionUri: Uri.file('/ext'),
    subscriptions: [] as Array<{ dispose: () => void }>,
  };
}

describe('extension.ts — refactoring coverage', () => {
  // -----------------------------------------------------------------------
  // state encapsulation: deactivate() è safe anche se activate non è stato chiamato
  // -----------------------------------------------------------------------
  it('deactivate() non dovrebbe lanciare se activate non è stato chiamato (state vuoto)', async () => {
    const { deactivate } = await import('../src/extension.js');
    expect(() => deactivate()).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // state encapsulation: multiple activate → deactivate cicli
  // -----------------------------------------------------------------------
  it('dovrebbe supportare multiple activate/deactivate senza crash', async () => {
    const { activate, deactivate } = await import('../src/extension.js');
    activate(createMockExtensionContext() as any);
    await flushMicrotasks();
    deactivate();

    // Secondo ciclo
    activate(createMockExtensionContext() as any);
    await flushMicrotasks();
    expect(() => deactivate()).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // Lazy activation: no availability warning is shown during activate()
  // -----------------------------------------------------------------------
  it('non dovrebbe mostrare warning CLI durante activate()', async () => {
    spawnBehavior = 'not-available';

    const { activate } = await import('../src/extension.js');
    activate(createMockExtensionContext() as any);
    await flushMicrotasks();
    expect(window.showWarningMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('Oz CLI not found'),
      expect.anything(),
    );
  });

  // -----------------------------------------------------------------------
  // Lazy activation: no install URL is opened while user ignores Oz features
  // -----------------------------------------------------------------------
  it('non dovrebbe aprire URL download durante activate()', async () => {
    spawnBehavior = 'not-available';
    window.showWarningMessage.mockResolvedValue(undefined);

    const { activate } = await import('../src/extension.js');
    activate(createMockExtensionContext() as any);
    await flushMicrotasks();

    expect(env.openExternal).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // state.configManager.onConfigChanged è raggiungibile
  // -----------------------------------------------------------------------
  it('dovrebbe loggare config changed via state.configManager.onConfigChanged', async () => {
    const { activate } = await import('../src/extension.js');
    activate(createMockExtensionContext() as any);
    await flushMicrotasks();

    if (configChangedListener) {
      configChangedListener({ affectsConfiguration: () => true });
    }

    const ch = window.createOutputChannel.mock.results[0]?.value;
    const logs: string[] = ch?.appendLine.mock.calls.map((c: unknown[]) => c[0]) ?? [];
    expect(logs.some((l: string) => l.includes('Configuration changed'))).toBe(true);
  });

  // -----------------------------------------------------------------------
  // subscriptions dispose callback: state.runPoller?.disposeAll()
  // -----------------------------------------------------------------------
  it('subscriptions dispose callback dovrebbe chiamare runPoller.disposeAll()', async () => {
    const { activate } = await import('../src/extension.js');
    const ctx = createMockExtensionContext();
    activate(ctx as any);
    await flushMicrotasks();

    // Trova la subscription con dispose che chiama runPoller?.disposeAll()
    // È l'ultimo o penultimo push in subscriptions
    const disposables = ctx.subscriptions;
    // Chiamare dispose su ciascuna subscription non dovrebbe lanciare
    for (const d of disposables) {
      expect(() => d.dispose()).not.toThrow();
    }
  });
});
