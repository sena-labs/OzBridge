import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildModelQuickPickItems,
  registerModelSelectorCommands,
  SELECT_MODEL_COMMAND,
} from '../../src/ui/modelSelector.js';
import * as vscodeMock from '../mocks/vscode.js';
import { createMockCli, createMockConfigManager, makeListResult } from '../helpers.js';

describe('buildModelQuickPickItems', () => {
  it('marks the current model and leaves the rest undescribed', () => {
    expect(buildModelQuickPickItems(['auto', 'gpt-5-5-high'], 'gpt-5-5-high')).toEqual([
      { label: 'auto', description: undefined },
      { label: 'gpt-5-5-high', description: '(current)' },
    ]);
  });
});

describe('registerModelSelectorCommands', () => {
  let cli: ReturnType<typeof createMockCli>;
  let updateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vscodeMock.commands._resetCommands();
    vi.clearAllMocks();
    cli = createMockCli();
    updateSpy = vi.fn(() => Promise.resolve());
    vscodeMock.workspace.getConfiguration.mockReturnValue({
      get: vi.fn((_k: string, d?: unknown) => d),
      update: updateSpy,
    } as never);
  });

  afterEach(() => {
    // Restore the shared mock's default impls (test files share mock state
    // because fileParallelism is disabled).
    vscodeMock.workspace.getConfiguration.mockImplementation((_section?: string) => ({
      get: vi.fn((_k: string, d?: unknown) => d),
      update: vi.fn(() => Promise.resolve()),
    } as never));
    vscodeMock.window.showQuickPick.mockImplementation(() => Promise.resolve(undefined as never));
  });

  it('writes the picked model to the Global setting', async () => {
    cli.modelList.mockResolvedValue(makeListResult([{ id: 'auto' }, { id: 'gpt-5-5-high' }]));
    vscodeMock.window.showQuickPick.mockResolvedValueOnce({ label: 'gpt-5-5-high' } as never);

    registerModelSelectorCommands(cli, createMockConfigManager());
    await vscodeMock.commands.executeCommand(SELECT_MODEL_COMMAND);

    expect(updateSpy).toHaveBeenCalledWith(
      'defaultModel',
      'gpt-5-5-high',
      vscodeMock.ConfigurationTarget.Global,
    );
  });

  it('does nothing when the QuickPick is cancelled', async () => {
    cli.modelList.mockResolvedValue(makeListResult([{ id: 'auto' }]));
    vscodeMock.window.showQuickPick.mockResolvedValueOnce(undefined as never);

    registerModelSelectorCommands(cli, createMockConfigManager());
    await vscodeMock.commands.executeCommand(SELECT_MODEL_COMMAND);

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('warns and skips the picker when no models are reported', async () => {
    cli.modelList.mockResolvedValue(makeListResult([]));

    registerModelSelectorCommands(cli, createMockConfigManager());
    await vscodeMock.commands.executeCommand(SELECT_MODEL_COMMAND);

    expect(vscodeMock.window.showQuickPick).not.toHaveBeenCalled();
    expect(vscodeMock.window.showWarningMessage).toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('surfaces an error when the model list call fails', async () => {
    cli.modelList.mockRejectedValue(new Error('not logged in'));

    registerModelSelectorCommands(cli, createMockConfigManager());
    await vscodeMock.commands.executeCommand(SELECT_MODEL_COMMAND);

    expect(vscodeMock.window.showErrorMessage).toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
