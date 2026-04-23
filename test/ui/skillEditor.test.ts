import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  SKILL_EDITOR_COMMANDS,
  registerSkillEditorCommands,
  atomicWrite,
} from '../../src/ui/skillEditor.js';
import * as vscodeMock from '../mocks/vscode.js';

let home: string;
let workspace: string;

beforeEach(() => {
  vscodeMock.commands._resetCommands();
  vscodeMock.window.showInformationMessage.mockClear();
  vscodeMock.window.showWarningMessage.mockClear();
  vscodeMock.window.showErrorMessage.mockClear();
  vscodeMock.window.showInputBox.mockReset();
  vscodeMock.window.showQuickPick.mockReset();
  vscodeMock.window.showOpenDialog.mockReset();
  vscodeMock.window.showTextDocument.mockClear();
  vscodeMock.workspace.openTextDocument.mockClear();

  home = fs.mkdtempSync(path.join(os.tmpdir(), 'warp-skill-home-'));
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'warp-skill-ws-'));

  for (const d of registerSkillEditorCommands({
    getHomeDir: () => home,
    getWorkspacePath: () => workspace,
  })) { void d; }

  (vscodeMock.window as any).activeTextEditor = undefined;
});

afterEach(() => {
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(workspace, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('skill editor — command registration', () => {
  it('registers the expected 4 commands', () => {
    const registered = vscodeMock.commands._listCommands();
    for (const id of Object.values(SKILL_EDITOR_COMMANDS)) {
      expect(registered).toContain(id);
    }
  });
});

describe('ozBridge.skill.edit', () => {
  it('opens a known path in the built-in editor', async () => {
    const file = path.join(workspace, 'skill.md');
    fs.writeFileSync(file, '# hi', 'utf8');
    await vscodeMock.commands.executeCommand(SKILL_EDITOR_COMMANDS.edit, file);
    expect(vscodeMock.workspace.openTextDocument).toHaveBeenCalledTimes(1);
    expect(vscodeMock.window.showTextDocument).toHaveBeenCalledTimes(1);
  });

  it('falls back to showOpenDialog when no target is passed and user cancels', async () => {
    vscodeMock.window.showOpenDialog.mockResolvedValueOnce(undefined as any);
    await vscodeMock.commands.executeCommand(SKILL_EDITOR_COMMANDS.edit);
    expect(vscodeMock.workspace.openTextDocument).not.toHaveBeenCalled();
  });
});

describe('ozBridge.skill.new', () => {
  it('scaffolds a project skill when the user picks Project', async () => {
    vscodeMock.window.showInputBox.mockResolvedValueOnce('9-security-agent' as any);
    vscodeMock.window.showQuickPick.mockResolvedValueOnce('Project' as any);
    await vscodeMock.commands.executeCommand(SKILL_EDITOR_COMMANDS.newSkill);
    const file = path.join(workspace, '.agents', 'skills', '9-security-agent', 'SKILL.md');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain('name: 9-security-agent');
    expect(vscodeMock.workspace.openTextDocument).toHaveBeenCalled();
  });

  it('scaffolds a global skill when the user picks Global', async () => {
    vscodeMock.window.showInputBox.mockResolvedValueOnce('9-custom-agent' as any);
    vscodeMock.window.showQuickPick.mockResolvedValueOnce('Global' as any);
    await vscodeMock.commands.executeCommand(SKILL_EDITOR_COMMANDS.newSkill);
    const file = path.join(home, '.agents', 'skills', '9-custom-agent', 'SKILL.md');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('refuses to overwrite an existing file without confirmation', async () => {
    const dir = path.join(workspace, '.agents', 'skills', 'existing');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'SKILL.md');
    fs.writeFileSync(file, 'original', 'utf8');

    vscodeMock.window.showInputBox.mockResolvedValueOnce('existing' as any);
    vscodeMock.window.showQuickPick.mockResolvedValueOnce('Project' as any);
    vscodeMock.window.showWarningMessage.mockResolvedValueOnce(undefined as any); // user dismisses

    await vscodeMock.commands.executeCommand(SKILL_EDITOR_COMMANDS.newSkill);
    expect(fs.readFileSync(file, 'utf8')).toBe('original');
  });

  it('aborts on input-box cancellation', async () => {
    vscodeMock.window.showInputBox.mockResolvedValueOnce(undefined as any);
    await vscodeMock.commands.executeCommand(SKILL_EDITOR_COMMANDS.newSkill);
    expect(vscodeMock.window.showQuickPick).not.toHaveBeenCalled();
  });
});

describe('ozBridge.skill.saveWorkspace / saveGlobal', () => {
  function installActiveEditor(content: string, filePath: string): void {
    (vscodeMock.window as any).activeTextEditor = {
      document: {
        getText: () => content,
        uri: vscodeMock.Uri.file(filePath),
      },
    };
  }

  it('saveWorkspace writes the active editor content to the project skill dir', async () => {
    installActiveEditor('---\nname: mycopy\n---', '/tmp/unsaved.md');
    vscodeMock.window.showInputBox.mockResolvedValueOnce('mycopy' as any);

    await vscodeMock.commands.executeCommand(SKILL_EDITOR_COMMANDS.saveWorkspace);
    const file = path.join(workspace, '.agents', 'skills', 'mycopy', 'SKILL.md');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain('name: mycopy');
    expect(vscodeMock.window.showInformationMessage).toHaveBeenCalled();
  });

  it('saveGlobal writes the active editor content to ~/.agents/skills/<name>/SKILL.md', async () => {
    installActiveEditor('---\nname: glob\n---', '/tmp/glob.md');
    vscodeMock.window.showInputBox.mockResolvedValueOnce('glob' as any);

    await vscodeMock.commands.executeCommand(SKILL_EDITOR_COMMANDS.saveGlobal);
    const file = path.join(home, '.agents', 'skills', 'glob', 'SKILL.md');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('warns when there is no active editor', async () => {
    await vscodeMock.commands.executeCommand(SKILL_EDITOR_COMMANDS.saveWorkspace);
    expect(vscodeMock.window.showWarningMessage).toHaveBeenCalled();
  });
});

describe('atomicWrite', () => {
  it('writes a file atomically (tmp + rename)', () => {
    const file = path.join(workspace, 'atom.md');
    atomicWrite(file, 'hello');
    expect(fs.readFileSync(file, 'utf8')).toBe('hello');
    expect(fs.readdirSync(workspace).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
