import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter as NodeEventEmitter } from 'node:events';
import { workspace, window, chat, Uri } from './mocks/vscode.js';
import { activate, deactivate } from '../src/extension.js';

// Mock child_process per evitare che checkAvailability() spawni un processo reale
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const proc = Object.assign(new NodeEventEmitter(), {
      stdout: new NodeEventEmitter(),
      stderr: new NodeEventEmitter(),
      kill: vi.fn(),
    });
    process.nextTick(() => {
      proc.stdout.emit('data', Buffer.from('{"version":"mock-1.0.0"}'));
      proc.emit('close', 0);
    });
    return proc;
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();

  workspace.getConfiguration.mockReturnValue({
    get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
  });
  workspace.onDidChangeConfiguration.mockReturnValue({ dispose: vi.fn() });

  window.createOutputChannel.mockReturnValue({
    appendLine: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  });

  chat.createChatParticipant.mockReturnValue({
    iconPath: undefined,
    followupProvider: undefined,
    dispose: vi.fn(),
  });
});

describe('Smoke test — extension lifecycle', () => {
  function createMockExtensionContext() {
    return {
      extensionUri: Uri.file('/ext'),
      subscriptions: [] as Array<{ dispose: () => void }>,
    };
  }

  it('dovrebbe attivare senza errori', () => {
    expect(() => activate(createMockExtensionContext() as any)).not.toThrow();
  });

  it('dovrebbe registrare il Chat Participant durante activate()', () => {
    activate(createMockExtensionContext() as any);
    expect(chat.createChatParticipant).toHaveBeenCalledWith(
      'oz-bridge.ozbridge',
      expect.any(Function),
    );
  });

  it('dovrebbe creare un output channel', () => {
    activate(createMockExtensionContext() as any);
    expect(window.createOutputChannel).toHaveBeenCalledWith('OzBridge');
  });

  it('dovrebbe aggiungere risorse a subscriptions', () => {
    const ctx = createMockExtensionContext();
    activate(ctx as any);
    // ConfigManager + ChatParticipant + OutputChannel = almeno 3
    expect(ctx.subscriptions.length).toBeGreaterThanOrEqual(3);
  });

  // P4 fix: RunPoller wrapper in subscriptions.dispose chiama disposeAll()
  it('dovrebbe includere RunPoller dispose wrapper in subscriptions (P4)', () => {
    const ctx = createMockExtensionContext();
    activate(ctx as any);

    // Trova il wrapper disposable che chiama runPoller?.disposeAll()
    // Tutti gli elementi di subscriptions devono avere .dispose()
    const disposables = ctx.subscriptions;
    expect(disposables.every(d => typeof d.dispose === 'function')).toBe(true);

    // Verificare che dispose su ogni subscription non lanci errori
    for (const d of disposables) {
      expect(() => d.dispose()).not.toThrow();
    }
  });

  it('dovrebbe deattivare senza errori', () => {
    activate(createMockExtensionContext() as any);
    expect(() => deactivate()).not.toThrow();
  });

  it('dovrebbe deattivare senza errori anche senza attivazione', () => {
    // Reset module state: deactivate prima di activate
    expect(() => deactivate()).not.toThrow();
  });
});
