import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerTreeCommands, TREE_COMMANDS } from '../../src/ui/treeCommands.js';
import { OzRunsTreeProvider } from '../../src/ui/runsTreeProvider.js';
import type { ActiveRunsTracker } from '../../src/services/activeRunsTracker.js';
import { createMockCli } from '../helpers.js';
import * as vscodeMock from '../mocks/vscode.js';

function makeTracker(): ActiveRunsTracker {
  const emitter = new vscodeMock.EventEmitter<unknown>();
  return {
    onDidChange: emitter.event,
    onDidError: emitter.event,
    latest: [],
    start: vi.fn(),
    stop: vi.fn(),
    refresh: vi.fn(() => Promise.resolve()),
    dispose: vi.fn(),
  } as unknown as ActiveRunsTracker;
}

let cli: ReturnType<typeof createMockCli>;
let tracker: ActiveRunsTracker;
let provider: OzRunsTreeProvider;

beforeEach(() => {
  vscodeMock.commands._resetCommands();
  vscodeMock.env.clipboard.writeText.mockClear();
  vscodeMock.env.openExternal.mockClear();
  vscodeMock.window.showInformationMessage.mockClear();
  vscodeMock.window.showWarningMessage.mockClear();
  vscodeMock.window.showErrorMessage.mockClear();

  cli = createMockCli();
  tracker = makeTracker();
  provider = new OzRunsTreeProvider(cli, tracker);

  for (const d of registerTreeCommands({ cli, tracker, provider })) {
    void d; // keep registrations alive for the test lifecycle via the mock map
  }
});

describe('tree commands', () => {
  it('exports a stable set of command ids', () => {
    expect(TREE_COMMANDS.refresh).toBe('ozBridge.tree.refresh');
    expect(TREE_COMMANDS.copyId).toBe('ozBridge.tree.copyId');
    expect(TREE_COMMANDS.openInBrowser).toBe('ozBridge.tree.openInBrowser');
    expect(TREE_COMMANDS.showRun).toBe('ozBridge.tree.showRun');
    expect(TREE_COMMANDS.pauseSchedule).toBe('ozBridge.tree.pauseSchedule');
    expect(TREE_COMMANDS.unpauseSchedule).toBe('ozBridge.tree.unpauseSchedule');
    expect(TREE_COMMANDS.deleteSchedule).toBe('ozBridge.tree.deleteSchedule');
  });

  it('registerTreeCommands registers every TREE_COMMANDS id', () => {
    for (const id of Object.values(TREE_COMMANDS)) {
      expect(vscodeMock.commands._listCommands()).toContain(id);
    }
  });

  it('refresh calls tracker.refresh() and provider.refresh()', async () => {
    const providerSpy = vi.spyOn(provider, 'refresh');
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.refresh);
    expect(providerSpy).toHaveBeenCalled();
    expect(tracker.refresh).toHaveBeenCalled();
  });

  it('copyId writes the run id to the clipboard', async () => {
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.copyId, {
      kind: 'run',
      id: 'run:r1',
      label: 'r1',
      runId: 'r1',
      status: 'QUEUED',
      active: true,
    });

    expect(vscodeMock.env.clipboard.writeText).toHaveBeenCalledWith('r1');
    expect(vscodeMock.window.showInformationMessage).toHaveBeenCalled();
  });

  it('copyId warns when invoked with no/unsupported node', async () => {
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.copyId, undefined);
    expect(vscodeMock.env.clipboard.writeText).not.toHaveBeenCalled();
    expect(vscodeMock.window.showWarningMessage).toHaveBeenCalled();
  });

  it('openInBrowser opens app.warp.dev for a run node', async () => {
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.openInBrowser, {
      kind: 'run',
      id: 'run:r1',
      label: 'r1',
      runId: 'r1',
      status: 'SUCCEEDED',
      active: false,
    });

    expect(vscodeMock.env.openExternal).toHaveBeenCalledTimes(1);
    const arg = vscodeMock.env.openExternal.mock.calls[0][0] as any;
    expect(String(arg)).toContain('app.warp.dev/agents/r1');
  });

  it('pauseSchedule invokes cli.schedulePause and refreshes', async () => {
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.pauseSchedule, {
      kind: 'schedule',
      id: 'schedule:s1',
      label: 'Daily',
      schedule: { id: 's1', name: 'Daily', cron: '0 9 * * *', prompt: 'x', paused: false },
    });

    expect(cli.schedulePause).toHaveBeenCalledWith('s1');
    expect(vscodeMock.window.showInformationMessage).toHaveBeenCalled();
  });

  it('unpauseSchedule invokes cli.scheduleUnpause', async () => {
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.unpauseSchedule, {
      kind: 'schedule',
      id: 'schedule:s1',
      label: 'Daily',
      schedule: { id: 's1', name: 'Daily', cron: '0 9 * * *', prompt: 'x', paused: true },
    });
    expect(cli.scheduleUnpause).toHaveBeenCalledWith('s1');
  });

  it('deleteSchedule asks confirmation and deletes only if confirmed', async () => {
    vscodeMock.window.showWarningMessage.mockResolvedValueOnce('Delete' as any);

    await vscodeMock.commands.executeCommand(TREE_COMMANDS.deleteSchedule, {
      kind: 'schedule',
      id: 'schedule:s1',
      label: 'Daily',
      schedule: { id: 's1', name: 'Daily', cron: '0 9 * * *', prompt: 'x', paused: false },
    });

    expect(cli.scheduleDelete).toHaveBeenCalledWith('s1');
  });

  it('deleteSchedule is a no-op if the user cancels the confirmation', async () => {
    vscodeMock.window.showWarningMessage.mockResolvedValueOnce(undefined as any);

    await vscodeMock.commands.executeCommand(TREE_COMMANDS.deleteSchedule, {
      kind: 'schedule',
      id: 'schedule:s1',
      label: 'Daily',
      schedule: { id: 's1', name: 'Daily', cron: '0 9 * * *', prompt: 'x', paused: false },
    });

    expect(cli.scheduleDelete).not.toHaveBeenCalled();
  });

  it('pauseSchedule surfaces CLI errors as showErrorMessage', async () => {
    cli.schedulePause.mockRejectedValue(new Error('forbidden'));

    await vscodeMock.commands.executeCommand(TREE_COMMANDS.pauseSchedule, {
      kind: 'schedule',
      id: 'schedule:s1',
      label: 'Daily',
      schedule: { id: 's1', name: 'Daily', cron: '0 9 * * *', prompt: 'x', paused: false },
    });

    expect(vscodeMock.window.showErrorMessage).toHaveBeenCalled();
    const msg = vscodeMock.window.showErrorMessage.mock.calls[0][0];
    expect(String(msg)).toContain('forbidden');
  });
});
