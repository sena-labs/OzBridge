import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DRIVE_COMMANDS,
  registerDriveCommands,
} from '../../src/ui/driveCommands.js';
import { WarpDriveTreeProvider } from '../../src/ui/driveTreeProvider.js';
import { IWarpDriveSource, DrivePrompt, DriveSkill } from '../../src/drive/warpDriveSource.js';
import * as vscodeMock from '../mocks/vscode.js';

function makeSource(overrides: Partial<IWarpDriveSource> = {}): IWarpDriveSource {
  return {
    label: 'fake',
    listPrompts: vi.fn(async () => []),
    listRules: vi.fn(async () => []),
    listSkills: vi.fn(async () => []),
    read: vi.fn(async () => ''),
    ...overrides,
  } as IWarpDriveSource;
}

let source: IWarpDriveSource;
let provider: WarpDriveTreeProvider;

beforeEach(() => {
  vscodeMock.commands._resetCommands();
  vscodeMock.env.clipboard.writeText.mockClear();
  vscodeMock.env.openExternal.mockClear();
  vscodeMock.window.showInformationMessage.mockClear();
  vscodeMock.window.showWarningMessage.mockClear();
  vscodeMock.window.showErrorMessage.mockClear();
  vscodeMock.workspace.openTextDocument.mockClear();
  vscodeMock.window.showTextDocument.mockClear();
  source = makeSource();
  provider = new WarpDriveTreeProvider(source);
  for (const d of registerDriveCommands({ source, provider })) { void d; }
});

describe('drive commands', () => {
  it('registers every DRIVE_COMMANDS id', () => {
    const registered = vscodeMock.commands._listCommands();
    for (const id of Object.values(DRIVE_COMMANDS)) {
      expect(registered).toContain(id);
    }
  });

  it('refresh triggers provider.refresh()', async () => {
    const spy = vi.spyOn(provider, 'refresh');
    await vscodeMock.commands.executeCommand(DRIVE_COMMANDS.refresh);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('insertIntoChat warns when invoked without a selection', async () => {
    await vscodeMock.commands.executeCommand(DRIVE_COMMANDS.insertIntoChat);
    expect(vscodeMock.window.showWarningMessage).toHaveBeenCalled();
  });

  it('insertIntoChat reads the entry and opens the chat panel', async () => {
    source = makeSource({ read: vi.fn(async () => '# body') });
    provider = new WarpDriveTreeProvider(source);
    for (const d of registerDriveCommands({ source, provider })) { void d; }
    const entry: DrivePrompt = {
      id: 'p1', category: 'prompt', name: 'Deploy', source: 'cli',
    };
    await vscodeMock.commands.executeCommand(DRIVE_COMMANDS.insertIntoChat, { kind: 'entry', id: 'entry:p1', entry });
    expect(source.read).toHaveBeenCalledWith('p1');
  });

  it('copyContent writes body to clipboard and notifies', async () => {
    source = makeSource({ read: vi.fn(async () => '# hello') });
    provider = new WarpDriveTreeProvider(source);
    for (const d of registerDriveCommands({ source, provider })) { void d; }
    const entry: DrivePrompt = { id: 'p1', category: 'prompt', name: 'A', source: 'cli' };
    await vscodeMock.commands.executeCommand(DRIVE_COMMANDS.copyContent, { kind: 'entry', id: 'x', entry });
    expect(vscodeMock.env.clipboard.writeText).toHaveBeenCalledWith('# hello');
    expect(vscodeMock.window.showInformationMessage).toHaveBeenCalled();
  });

  it('copyContent surfaces read errors', async () => {
    source = makeSource({ read: vi.fn(async () => { throw new Error('boom'); }) });
    provider = new WarpDriveTreeProvider(source);
    for (const d of registerDriveCommands({ source, provider })) { void d; }
    const entry: DrivePrompt = { id: 'p1', category: 'prompt', name: 'A', source: 'cli' };
    await vscodeMock.commands.executeCommand(DRIVE_COMMANDS.copyContent, { kind: 'entry', id: 'x', entry });
    expect(vscodeMock.window.showErrorMessage).toHaveBeenCalled();
  });

  it('openInEditor opens filesystem entries by Uri.file', async () => {
    const entry: DriveSkill = {
      id: '/home/u/.agents/skills/5-test/SKILL.md',
      category: 'skill',
      name: '5-test',
      source: 'filesystem',
    };
    await vscodeMock.commands.executeCommand(DRIVE_COMMANDS.openInEditor, { kind: 'entry', id: 'x', entry });
    expect(vscodeMock.workspace.openTextDocument).toHaveBeenCalledTimes(1);
    expect(vscodeMock.window.showTextDocument).toHaveBeenCalledTimes(1);
  });

  it('openInEditor opens CLI entries as untitled markdown documents', async () => {
    source = makeSource({ read: vi.fn(async () => '# body') });
    provider = new WarpDriveTreeProvider(source);
    for (const d of registerDriveCommands({ source, provider })) { void d; }
    const entry: DrivePrompt = { id: 'cli-1', category: 'prompt', name: 'A', source: 'cli' };
    await vscodeMock.commands.executeCommand(DRIVE_COMMANDS.openInEditor, { kind: 'entry', id: 'x', entry });
    expect(vscodeMock.workspace.openTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ content: '# body', language: 'markdown' }),
    );
  });
});
