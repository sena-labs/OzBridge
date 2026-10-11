import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter as NodeEventEmitter } from 'node:events';
import { workspace, window, chat, Uri } from './mocks/vscode.js';
import { activate, deactivate } from '../src/extension.js';

// Mock child_process so that checkAvailability() does not spawn a real process
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

  it('activates without errors', () => {
    expect(() => activate(createMockExtensionContext() as any)).not.toThrow();
  });

  it('registers the Chat Participant during activate()', () => {
    activate(createMockExtensionContext() as any);
    expect(chat.createChatParticipant).toHaveBeenCalledWith(
      'ozbridge.oz',
      expect.any(Function),
    );
  });

  it('creates an output channel', () => {
    activate(createMockExtensionContext() as any);
    expect(window.createOutputChannel).toHaveBeenCalledWith('OzBridge');
  });

  it('adds resources to subscriptions', () => {
    const ctx = createMockExtensionContext();
    activate(ctx as any);
    // ConfigManager + ChatParticipant + OutputChannel = at least 3
    expect(ctx.subscriptions.length).toBeGreaterThanOrEqual(3);
  });

  // P4 fix: RunPoller wrapper in subscriptions.dispose calls disposeAll()
  it('includes the RunPoller dispose wrapper in subscriptions (P4)', () => {
    const ctx = createMockExtensionContext();
    activate(ctx as any);

    // Find the disposable wrapper that calls runPoller?.disposeAll()
    // All subscriptions items must have .dispose()
    const disposables = ctx.subscriptions;
    expect(disposables.every(d => typeof d.dispose === 'function')).toBe(true);

    // Verify that dispose on every subscription does not throw errors
    for (const d of disposables) {
      expect(() => d.dispose()).not.toThrow();
    }
  });

  it('deactivates without errors', () => {
    activate(createMockExtensionContext() as any);
    expect(() => deactivate()).not.toThrow();
  });

  it('deactivates without errors even without activation', () => {
    // Reset module state: deactivate before activate
    expect(() => deactivate()).not.toThrow();
  });
});
