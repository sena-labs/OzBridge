import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildHandoffCommand,
  buildHandoffUri,
  openHandoff,
  registerHandoffCommands,
  HANDOFF_COMMANDS,
} from '../../src/ui/handoff.js';
import * as vscodeMock from '../mocks/vscode.js';

beforeEach(() => {
  vscodeMock.commands._resetCommands();
  vscodeMock.env.openExternal.mockClear();
  vscodeMock.env.openExternal.mockResolvedValue(true);
  vscodeMock.env.clipboard.writeText.mockClear();
  vscodeMock.window.showInformationMessage.mockClear();
  vscodeMock.window.showWarningMessage.mockClear();
  vscodeMock.window.showInputBox.mockReset();
});

describe('buildHandoffCommand', () => {
  it('emits `oz run get <id>` when only runId is provided', () => {
    expect(buildHandoffCommand({ runId: 'run-123' })).toBe('oz run get "run-123"');
  });

  it('emits `oz agent run --prompt …` when only prompt is provided', () => {
    expect(buildHandoffCommand({ prompt: 'fix bug' })).toBe('oz agent run --prompt "fix bug"');
  });

  it('emits a CONTINUING prefix when both runId and prompt are provided', () => {
    expect(buildHandoffCommand({ runId: 'r1', prompt: 'rerun with flag' })).toBe(
      'oz agent run --prompt "[CONTINUING r1] rerun with flag"',
    );
  });

  it('escapes double quotes, backslashes, dollars and backticks', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    try {
      const cmd = buildHandoffCommand({ prompt: 'say "hi" $x `date` C:\\tmp' });
      expect(cmd).toBe('oz agent run --prompt "say \\\"hi\\\" \\$x \\`date\\` C:\\\\tmp"');
    } finally {
      platformSpy.mockRestore();
    }
  });

  it('returns a bare `oz agent run` when neither runId nor prompt is given', () => {
    expect(buildHandoffCommand({})).toBe('oz agent run');
  });

  it('on Windows escapes cmd metacharacters and %VAR% expansion', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    try {
      const cmd = buildHandoffCommand({ prompt: 'say "hi" %USERPROFILE% & echo !' });
      expect(cmd).toBe('oz agent run --prompt "say \\\"hi\\\" %%USERPROFILE%% ^& echo ^^!"');
    } finally {
      platformSpy.mockRestore();
    }
  });
});

/**
 * URLSearchParams uses `+` for spaces (application/x-www-form-urlencoded).
 * `decodeURIComponent` only undoes `%xx` percent-encoding, so we need a small
 * helper that also turns `+` back into space for human-readable assertions.
 */
function decodeForm(value: string): string {
  return decodeURIComponent(value.replace(/\+/g, ' '));
}

describe('buildHandoffUri', () => {
  it('encodes path and command into a warp://action/new_tab URI', () => {
    const uri = buildHandoffUri({ workspacePath: '/workspace/project', prompt: 'hello' });
    const raw = uri.toString();
    expect(raw).toContain('warp://action/new_tab');
    expect(raw).toContain('path=');
    expect(raw).toContain('command=');
    expect(decodeForm(raw)).toContain('oz agent run --prompt "hello"');
    expect(decodeForm(raw)).toContain('/workspace/project');
  });

  it('omits path when workspacePath is missing', () => {
    const uri = buildHandoffUri({ prompt: 'hello' });
    expect(uri.toString()).not.toContain('path=');
  });
});

describe('openHandoff', () => {
  it('invokes vscode.env.openExternal with the built URI', async () => {
    const ok = await openHandoff({ prompt: 'hello', workspacePath: '/w' });
    expect(ok).toBe(true);
    expect(vscodeMock.env.openExternal).toHaveBeenCalledTimes(1);
  });

  it('falls back to the warning modal when openExternal returns false', async () => {
    vscodeMock.env.openExternal.mockResolvedValueOnce(false);
    vscodeMock.window.showWarningMessage.mockResolvedValueOnce('Copy command' as any);

    const ok = await openHandoff({ prompt: 'hello' });
    expect(ok).toBe(false);
    expect(vscodeMock.window.showWarningMessage).toHaveBeenCalled();
    expect(vscodeMock.env.clipboard.writeText).toHaveBeenCalledWith('oz agent run --prompt "hello"');
  });

  it('falls back when openExternal throws', async () => {
    vscodeMock.env.openExternal.mockRejectedValueOnce(new Error('no handler'));
    vscodeMock.window.showWarningMessage.mockResolvedValueOnce(undefined as any);

    const ok = await openHandoff({ runId: 'r1' });
    expect(ok).toBe(false);
    expect(vscodeMock.window.showWarningMessage).toHaveBeenCalled();
    // user dismissed modal → clipboard not touched
    expect(vscodeMock.env.clipboard.writeText).not.toHaveBeenCalled();
  });
});

describe('registerHandoffCommands', () => {
  it('registers both palette and tree command ids', () => {
    const disposables = registerHandoffCommands({
      getWorkspacePath: () => '/w',
    });
    expect(disposables).toHaveLength(2);
    expect(vscodeMock.commands._listCommands()).toContain(HANDOFF_COMMANDS.palette);
    expect(vscodeMock.commands._listCommands()).toContain(HANDOFF_COMMANDS.tree);
  });

  it('palette command prompts and then opens Warp with the entered prompt', async () => {
    registerHandoffCommands({
      getWorkspacePath: () => '/w',
    });
    vscodeMock.window.showInputBox.mockResolvedValueOnce('hello world' as any);

    await vscodeMock.commands.executeCommand(HANDOFF_COMMANDS.palette);

    expect(vscodeMock.env.openExternal).toHaveBeenCalledTimes(1);
    const arg = vscodeMock.env.openExternal.mock.calls[0][0] as any;
    expect(decodeForm(arg.toString())).toContain('hello world');
  });

  it('palette command is a no-op when the user cancels the input box', async () => {
    registerHandoffCommands({
      getWorkspacePath: () => '/w',
    });
    vscodeMock.window.showInputBox.mockResolvedValueOnce(undefined as any);

    await vscodeMock.commands.executeCommand(HANDOFF_COMMANDS.palette);

    expect(vscodeMock.env.openExternal).not.toHaveBeenCalled();
  });

  it('tree command opens Warp with the run id for a run node', async () => {
    registerHandoffCommands({
      getWorkspacePath: () => '/w',
    });

    await vscodeMock.commands.executeCommand(HANDOFF_COMMANDS.tree, {
      kind: 'run',
      id: 'run:r1',
      label: 'r1',
      runId: 'r1',
      status: 'SUCCEEDED',
      active: false,
    });

    expect(vscodeMock.env.openExternal).toHaveBeenCalledTimes(1);
    const arg = vscodeMock.env.openExternal.mock.calls[0][0] as any;
    expect(decodeForm(arg.toString())).toContain('oz run get "r1"');
  });

  it('tree command warns when invoked on a non-run node', async () => {
    registerHandoffCommands({
      getWorkspacePath: () => '/w',
    });

    await vscodeMock.commands.executeCommand(HANDOFF_COMMANDS.tree, {
      kind: 'category',
      id: 'category:activeRuns',
      label: 'Active Runs',
      category: 'activeRuns',
    });

    expect(vscodeMock.window.showWarningMessage).toHaveBeenCalled();
    expect(vscodeMock.env.openExternal).not.toHaveBeenCalled();
  });
});
