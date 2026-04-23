import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, env, window, workspace, Uri } from './mocks/vscode.js';

function createMockExtensionContext() {
  return {
    extensionUri: Uri.file('/ext'),
    subscriptions: [] as Array<{ dispose: () => void }>,
  };
}

describe('ozBridge.openConversation security', () => {
  beforeEach(() => {
    commands._resetCommands();
    vi.clearAllMocks();
    workspace.getConfiguration.mockReturnValue({
      get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
    });
    window.showErrorMessage.mockResolvedValue(undefined as any);
    env.openExternal.mockResolvedValue(true as any);
  });

  it('accepts warp:// URIs', async () => {
    const { activate, deactivate } = await import('../src/extension.js');
    activate(createMockExtensionContext() as any);

    const result = await commands.executeCommand('ozBridge.openConversation', {
      scheme: 'warp',
      toString: () => 'warp://action/new_tab?command=oz+run+list',
    });

    expect(result).toBe(true);
    expect(env.openExternal).toHaveBeenCalledTimes(1);
    await Promise.resolve(deactivate());
  });

  it('rejects non-warp schemes', async () => {
    const { activate, deactivate } = await import('../src/extension.js');
    activate(createMockExtensionContext() as any);

    const result = await commands.executeCommand('ozBridge.openConversation', {
      scheme: 'https',
      toString: () => 'https://evil.example/phish',
    });

    expect(result).toBe(false);
    expect(env.openExternal).not.toHaveBeenCalled();
    expect(window.showErrorMessage).toHaveBeenCalled();
    await Promise.resolve(deactivate());
  });
});
