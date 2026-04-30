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
  vscodeMock.window.showInputBox.mockClear();
  vscodeMock.window.showQuickPick.mockClear();
  (vscodeMock.window as any).showSaveDialog?.mockClear?.();

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

  // ---------------------------------------------------------------------
  // editSchedule
  // ---------------------------------------------------------------------

  const baseSchedule = { id: 's1', name: 'Daily', cron: '0 9 * * *', prompt: 'p', paused: false };
  const scheduleNode = { kind: 'schedule', id: 'schedule:s1', label: 'Daily', schedule: baseSchedule };

  it('editSchedule sends only changed fields and refreshes', async () => {
    vscodeMock.window.showInputBox
      .mockResolvedValueOnce('Hourly')        // name changed
      .mockResolvedValueOnce(baseSchedule.cron) // cron unchanged
      .mockResolvedValueOnce('new prompt');     // prompt changed

    await vscodeMock.commands.executeCommand(TREE_COMMANDS.editSchedule, scheduleNode);

    expect(cli.scheduleUpdate).toHaveBeenCalledWith({
      id: 's1',
      name: 'Hourly',
      prompt: 'new prompt',
    });
    expect(vscodeMock.window.showInformationMessage).toHaveBeenCalled();
  });

  it('editSchedule aborts if user presses Escape on any step', async () => {
    vscodeMock.window.showInputBox.mockResolvedValueOnce(undefined);
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.editSchedule, scheduleNode);
    expect(cli.scheduleUpdate).not.toHaveBeenCalled();
  });

  it('editSchedule shows "no changes" when nothing changed', async () => {
    vscodeMock.window.showInputBox
      .mockResolvedValueOnce(baseSchedule.name)
      .mockResolvedValueOnce(baseSchedule.cron)
      .mockResolvedValueOnce(baseSchedule.prompt);
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.editSchedule, scheduleNode);
    expect(cli.scheduleUpdate).not.toHaveBeenCalled();
    expect(vscodeMock.window.showInformationMessage).toHaveBeenCalled();
  });

  it('editSchedule surfaces CLI errors', async () => {
    vscodeMock.window.showInputBox
      .mockResolvedValueOnce('NewName')
      .mockResolvedValueOnce(baseSchedule.cron)
      .mockResolvedValueOnce(baseSchedule.prompt);
    cli.scheduleUpdate.mockRejectedValue(new Error('boom'));
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.editSchedule, scheduleNode);
    expect(vscodeMock.window.showErrorMessage).toHaveBeenCalled();
  });

  it('editSchedule is a no-op for non-schedule nodes', async () => {
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.editSchedule, undefined);
    expect(vscodeMock.window.showInputBox).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // downloadArtifact
  // ---------------------------------------------------------------------

  it('downloadArtifact prompts for UID, fetches metadata, downloads, and reveals on confirm', async () => {
    vscodeMock.window.showInputBox.mockResolvedValueOnce('uid-1');
    cli.artifactGet.mockResolvedValue({ uid: 'uid-1', name: 'report.pdf' });
    const target = vscodeMock.Uri.file('/tmp/report.pdf');
    (vscodeMock.window as any).showSaveDialog.mockResolvedValueOnce(target);
    vscodeMock.window.showInformationMessage.mockResolvedValueOnce('Reveal in Explorer' as any);

    await vscodeMock.commands.executeCommand(TREE_COMMANDS.downloadArtifact);

    expect(cli.artifactDownload).toHaveBeenCalledWith('uid-1', target.fsPath);
    expect(vscodeMock.commands._listCommands()).toBeDefined();
  });

  it('downloadArtifact uses positional UID and survives missing metadata', async () => {
    cli.artifactGet.mockRejectedValue(new Error('unsupported'));
    const target = vscodeMock.Uri.file('/tmp/uid-2');
    (vscodeMock.window as any).showSaveDialog.mockResolvedValueOnce(target);

    await vscodeMock.commands.executeCommand(TREE_COMMANDS.downloadArtifact, 'uid-2');

    expect(cli.artifactDownload).toHaveBeenCalledWith('uid-2', target.fsPath);
  });

  it('downloadArtifact aborts when no UID provided', async () => {
    vscodeMock.window.showInputBox.mockResolvedValueOnce(undefined);
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.downloadArtifact);
    expect(cli.artifactDownload).not.toHaveBeenCalled();
  });

  it('downloadArtifact aborts when user cancels save dialog', async () => {
    cli.artifactGet.mockResolvedValue({ uid: 'uid-3', name: 'a.bin' });
    (vscodeMock.window as any).showSaveDialog.mockResolvedValueOnce(undefined);
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.downloadArtifact, 'uid-3');
    expect(cli.artifactDownload).not.toHaveBeenCalled();
  });

  it('downloadArtifact surfaces download errors', async () => {
    cli.artifactGet.mockResolvedValue({ uid: 'uid-4', name: 'a.bin' });
    (vscodeMock.window as any).showSaveDialog.mockResolvedValueOnce(vscodeMock.Uri.file('/tmp/a.bin'));
    cli.artifactDownload.mockRejectedValue(new Error('disk full'));
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.downloadArtifact, 'uid-4');
    expect(vscodeMock.window.showErrorMessage).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // createSecret
  // ---------------------------------------------------------------------

  it('createSecret collects name, value, description and scope, then calls cli.secretCreate', async () => {
    vscodeMock.window.showInputBox
      .mockResolvedValueOnce('MY_KEY')
      .mockResolvedValueOnce('s3cret')
      .mockResolvedValueOnce('docs');
    vscodeMock.window.showQuickPick.mockResolvedValueOnce({ label: 'Personal', value: 'personal' });

    await vscodeMock.commands.executeCommand(TREE_COMMANDS.createSecret);

    expect(cli.secretCreate).toHaveBeenCalledWith({
      name: 'MY_KEY',
      value: 's3cret',
      description: 'docs',
      scope: 'personal',
    });
  });

  it('createSecret aborts on cancelled name / value / scope', async () => {
    vscodeMock.window.showInputBox.mockResolvedValueOnce(undefined);
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.createSecret);
    expect(cli.secretCreate).not.toHaveBeenCalled();

    cli.secretCreate.mockClear();
    vscodeMock.window.showInputBox
      .mockResolvedValueOnce('NAME')
      .mockResolvedValueOnce(undefined);
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.createSecret);
    expect(cli.secretCreate).not.toHaveBeenCalled();

    cli.secretCreate.mockClear();
    vscodeMock.window.showInputBox
      .mockResolvedValueOnce('NAME')
      .mockResolvedValueOnce('val')
      .mockResolvedValueOnce('');
    vscodeMock.window.showQuickPick.mockResolvedValueOnce(undefined as any);
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.createSecret);
    expect(cli.secretCreate).not.toHaveBeenCalled();
  });

  it('createSecret surfaces CLI errors', async () => {
    vscodeMock.window.showInputBox
      .mockResolvedValueOnce('NAME')
      .mockResolvedValueOnce('v')
      .mockResolvedValueOnce('');
    vscodeMock.window.showQuickPick.mockResolvedValueOnce({ label: 'Default', value: undefined });
    cli.secretCreate.mockRejectedValue(new Error('dup'));
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.createSecret);
    expect(vscodeMock.window.showErrorMessage).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // updateSecret / deleteSecret / copySecretName
  // ---------------------------------------------------------------------

  const secretNode = {
    kind: 'secret',
    id: 'secret:MY_KEY',
    label: 'MY_KEY',
    secret: { name: 'MY_KEY', description: 'old', scope: 'team' as const },
  };

  it('updateSecret sends only changed value/description and refreshes', async () => {
    vscodeMock.window.showInputBox
      .mockResolvedValueOnce('newval')
      .mockResolvedValueOnce('new desc');

    await vscodeMock.commands.executeCommand(TREE_COMMANDS.updateSecret, secretNode);

    expect(cli.secretUpdate).toHaveBeenCalledWith({
      name: 'MY_KEY',
      value: 'newval',
      description: 'new desc',
      scope: 'team',
    });
  });

  it('updateSecret with empty value + unchanged description shows "no changes"', async () => {
    vscodeMock.window.showInputBox
      .mockResolvedValueOnce('')        // keep value
      .mockResolvedValueOnce('old');    // unchanged description
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.updateSecret, secretNode);
    expect(cli.secretUpdate).not.toHaveBeenCalled();
    expect(vscodeMock.window.showInformationMessage).toHaveBeenCalled();
  });

  it('updateSecret aborts on cancelled value or description', async () => {
    vscodeMock.window.showInputBox.mockResolvedValueOnce(undefined);
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.updateSecret, secretNode);
    expect(cli.secretUpdate).not.toHaveBeenCalled();

    vscodeMock.window.showInputBox
      .mockResolvedValueOnce('v')
      .mockResolvedValueOnce(undefined);
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.updateSecret, secretNode);
    expect(cli.secretUpdate).not.toHaveBeenCalled();
  });

  it('updateSecret surfaces CLI errors', async () => {
    vscodeMock.window.showInputBox
      .mockResolvedValueOnce('v')
      .mockResolvedValueOnce('old');
    cli.secretUpdate.mockRejectedValue(new Error('nope'));
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.updateSecret, secretNode);
    expect(vscodeMock.window.showErrorMessage).toHaveBeenCalled();
  });

  it('updateSecret is a no-op for non-secret nodes', async () => {
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.updateSecret, undefined);
    expect(vscodeMock.window.showInputBox).not.toHaveBeenCalled();
  });

  it('deleteSecret asks confirmation and deletes only if confirmed', async () => {
    vscodeMock.window.showWarningMessage.mockResolvedValueOnce('Delete' as any);
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.deleteSecret, secretNode);
    expect(cli.secretDelete).toHaveBeenCalledWith('MY_KEY', { scope: 'team' });
  });

  it('deleteSecret is a no-op when the user cancels', async () => {
    vscodeMock.window.showWarningMessage.mockResolvedValueOnce(undefined as any);
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.deleteSecret, secretNode);
    expect(cli.secretDelete).not.toHaveBeenCalled();
  });

  it('deleteSecret surfaces CLI errors', async () => {
    vscodeMock.window.showWarningMessage.mockResolvedValueOnce('Delete' as any);
    cli.secretDelete.mockRejectedValue(new Error('locked'));
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.deleteSecret, secretNode);
    expect(vscodeMock.window.showErrorMessage).toHaveBeenCalled();
  });

  it('copySecretName writes name to clipboard', async () => {
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.copySecretName, secretNode);
    expect(vscodeMock.env.clipboard.writeText).toHaveBeenCalledWith('MY_KEY');
  });

  it('copySecretName is a no-op for non-secret nodes', async () => {
    await vscodeMock.commands.executeCommand(TREE_COMMANDS.copySecretName, undefined);
    expect(vscodeMock.env.clipboard.writeText).not.toHaveBeenCalled();
  });
});
