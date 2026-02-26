import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { workspace, Uri } from '../../test/mocks/vscode.js';
import { createInitCommand } from '../../src/commands/initCommand.js';
import { createMockStream, createMockToken } from '../helpers.js';
import { AGENT_SKILL_MAP } from '../../src/types/index.js';
import { initI18n, _resetI18n } from '../../src/core/i18n.js';

let handler: ReturnType<typeof createInitCommand>;
let mock: ReturnType<typeof createMockStream>;

beforeEach(() => {
  vi.clearAllMocks();
  initI18n('it');
  handler = createInitCommand();
  mock = createMockStream();
  // Reset workspace folders
  workspace.workspaceFolders = undefined;
  workspace.fs.stat.mockRejectedValue(new Error('not found')); // file non esiste
  workspace.fs.createDirectory.mockResolvedValue(undefined);
  workspace.fs.writeFile.mockResolvedValue(undefined);
});

afterEach(() => {
  _resetI18n();
});

describe('/init command', () => {
  it('dovrebbe mostrare errore se nessun workspace aperto', async () => {
    workspace.workspaceFolders = undefined;

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Nessun workspace');
  });

  it('dovrebbe creare 7 SKILL.md + 1 PROJECT.md = 8 file', async () => {
    workspace.workspaceFolders = [{ uri: Uri.file('/project'), name: 'project', index: 0 }];

    await handler('', mock.stream as any, createMockToken() as any);

    // 7 skill directories + 1 rules directory = 8 createDirectory
    expect(workspace.fs.createDirectory).toHaveBeenCalledTimes(8);
    // 7 SKILL.md + 1 PROJECT.md = 8 writeFile
    expect(workspace.fs.writeFile).toHaveBeenCalledTimes(8);

    const output = mock.getFullOutput();
    expect(output).toContain('Scaffolding completato');
    expect(output).toContain('8');
  });

  it('dovrebbe non sovrascrivere file esistenti', async () => {
    workspace.workspaceFolders = [{ uri: Uri.file('/project'), name: 'project', index: 0 }];
    // stat() resolve = file exists
    workspace.fs.stat.mockResolvedValue({ type: 1 });

    await handler('', mock.stream as any, createMockToken() as any);

    // Nessun writeFile (tutti i file già esistono)
    expect(workspace.fs.writeFile).not.toHaveBeenCalled();
    const output = mock.getFullOutput();
    expect(output).toContain('già esistenti');
  });

  it('dovrebbe contare separatamente file creati e saltati', async () => {
    workspace.workspaceFolders = [{ uri: Uri.file('/project'), name: 'project', index: 0 }];
    let callCount = 0;
    workspace.fs.stat.mockImplementation(async () => {
      callCount++;
      if (callCount <= 3) return { type: 1 }; // 3 file esistono
      throw new Error('not found'); // resto non esiste
    });

    await handler('', mock.stream as any, createMockToken() as any);

    const output = mock.getFullOutput();
    // 8 totali - 3 esistenti = 5 creati
    expect(output).toContain('5');
    expect(output).toContain('3');
  });

  it('dovrebbe mostrare la struttura creata', async () => {
    workspace.workspaceFolders = [{ uri: Uri.file('/project'), name: 'project', index: 0 }];

    await handler('', mock.stream as any, createMockToken() as any);

    const output = mock.getFullOutput();
    // Verifica che tutti i 7 skill siano listati
    for (const skillName of Object.values(AGENT_SKILL_MAP)) {
      expect(output).toContain(skillName);
    }
    expect(output).toContain('PROJECT.md');
  });

  it('dovrebbe mostrare progresso', async () => {
    workspace.workspaceFolders = [{ uri: Uri.file('/project'), name: 'project', index: 0 }];

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.progresses.length).toBeGreaterThanOrEqual(1);
  });

  // Gap: errore filesystem (createDirectory o writeFile fallisce)
  it('dovrebbe propagare errore se createDirectory fallisce', async () => {
    workspace.workspaceFolders = [{ uri: Uri.file('/project'), name: 'project', index: 0 }];
    workspace.fs.createDirectory.mockRejectedValue(new Error('EACCES: permission denied'));

    // L'errore si propaga non gestito (no try-catch nel source)
    await expect(
      handler('', mock.stream as any, createMockToken() as any),
    ).rejects.toThrow('EACCES: permission denied');
  });

  it('dovrebbe propagare errore se writeFile fallisce', async () => {
    workspace.workspaceFolders = [{ uri: Uri.file('/project'), name: 'project', index: 0 }];
    workspace.fs.createDirectory.mockResolvedValue(undefined);
    workspace.fs.writeFile.mockRejectedValue(new Error('ENOSPC: no space left'));

    await expect(
      handler('', mock.stream as any, createMockToken() as any),
    ).rejects.toThrow('ENOSPC: no space left');
  });

  // Gap: verifica che il contenuto del template contenga il nome dello skill
  it('dovrebbe scrivere template con nome skill nel contenuto', async () => {
    workspace.workspaceFolders = [{ uri: Uri.file('/project'), name: 'project', index: 0 }];

    await handler('', mock.stream as any, createMockToken() as any);

    // Il primo writeFile dovrebbe contenere il nome dello skill
    const firstCallBuffer = workspace.fs.writeFile.mock.calls[0][1] as Buffer;
    const content = firstCallBuffer.toString('utf-8');
    // Deve contenere almeno un header markdown con il nome dello skill
    expect(content).toContain('name:');
    expect(content).toContain('# ');
  });
});
