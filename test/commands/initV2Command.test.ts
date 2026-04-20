import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createInitV2Command, atomicWrite } from '../../src/commands/initV2Command.js';
import { SKILL_TEMPLATES } from '../../src/scaffold/skillTemplates.js';
import * as vscodeMock from '../mocks/vscode.js';
import { createMockStream, createMockToken } from '../helpers.js';

let workspace: string;
let handler: ReturnType<typeof createInitV2Command>;

function setWorkspace(dir: string | undefined): void {
  if (dir === undefined) {
    (vscodeMock.workspace as any).workspaceFolders = undefined;
    return;
  }
  (vscodeMock.workspace as any).workspaceFolders = [
    { uri: vscodeMock.Uri.file(dir), name: path.basename(dir), index: 0 },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  vscodeMock.window.showQuickPick.mockReset();
  vscodeMock.window.showWarningMessage.mockReset();
  vscodeMock.window.showErrorMessage.mockReset();
  vscodeMock.window.showInformationMessage.mockReset();

  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'warp-init-v2-'));
  setWorkspace(workspace);
  handler = createInitV2Command();
});

afterEach(() => {
  try { fs.rmSync(workspace, { recursive: true, force: true }); } catch { /* ignore */ }
  setWorkspace(undefined);
});

describe('/init v2 — no workspace', () => {
  it('reports error when no workspace folder is open', async () => {
    setWorkspace(undefined);
    const mock = createMockStream();
    await handler('', mock.stream as any, createMockToken() as any);
    expect(mock.getFullOutput()).toContain('No workspace open');
    expect(vscodeMock.window.showQuickPick).not.toHaveBeenCalled();
  });
});

describe('/init v2 — QuickPick interaction', () => {
  it('reports cancellation when QuickPick is dismissed (undefined)', async () => {
    vscodeMock.window.showQuickPick.mockResolvedValueOnce(undefined as any);
    const mock = createMockStream();
    await handler('', mock.stream as any, createMockToken() as any);
    expect(mock.getFullOutput()).toContain('cancelled');
  });

  it('reports cancellation when QuickPick returns an empty selection', async () => {
    vscodeMock.window.showQuickPick.mockResolvedValueOnce([] as any);
    const mock = createMockStream();
    await handler('', mock.stream as any, createMockToken() as any);
    expect(mock.getFullOutput()).toContain('cancelled');
  });

  it('passes canPickMany:true and title to the QuickPick', async () => {
    vscodeMock.window.showQuickPick.mockResolvedValueOnce(undefined as any);
    const mock = createMockStream();
    await handler('', mock.stream as any, createMockToken() as any);
    const args = vscodeMock.window.showQuickPick.mock.calls[0];
    const options = args[1] as any;
    expect(options.canPickMany).toBe(true);
    expect(String(options.title)).toContain('/init');
  });

  it('marks all templates as [new] on a fresh workspace', async () => {
    vscodeMock.window.showQuickPick.mockResolvedValueOnce(undefined as any);
    const mock = createMockStream();
    await handler('', mock.stream as any, createMockToken() as any);
    const items = vscodeMock.window.showQuickPick.mock.calls[0][0] as any[];
    expect(items).toHaveLength(SKILL_TEMPLATES.length);
    for (const it of items) {
      expect(it.description).toBe('[new]');
      expect(it.picked).toBe(true);
    }
  });

  it('marks existing files as [exists] and pre-picks only missing ones', async () => {
    // Pre-create the first template so it appears as [exists]
    const first = SKILL_TEMPLATES[0];
    const absolute = path.join(workspace, first.relativePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, 'pre-existing', 'utf8');

    vscodeMock.window.showQuickPick.mockResolvedValueOnce(undefined as any);
    const mock = createMockStream();
    await handler('', mock.stream as any, createMockToken() as any);

    const items = vscodeMock.window.showQuickPick.mock.calls[0][0] as any[];
    const existing = items.find((i) => i.template.id === first.id);
    expect(existing.description).toBe('[exists]');
    expect(existing.picked).toBe(false);
  });
});

describe('/init v2 — scaffold selected', () => {
  it('creates a single selected template file', async () => {
    const target = SKILL_TEMPLATES[0];
    vscodeMock.window.showQuickPick.mockResolvedValueOnce([
      { template: target, label: target.relativePath, description: '[new]' },
    ] as any);

    const mock = createMockStream();
    await handler('', mock.stream as any, createMockToken() as any);

    const file = path.join(workspace, target.relativePath);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe(target.body());
    expect(mock.getFullOutput()).toContain('1** created');
  });

  it('creates multiple selected template files', async () => {
    const picked = SKILL_TEMPLATES.slice(0, 3).map((t) => ({ template: t }));
    vscodeMock.window.showQuickPick.mockResolvedValueOnce(picked as any);

    const mock = createMockStream();
    await handler('', mock.stream as any, createMockToken() as any);

    for (const t of SKILL_TEMPLATES.slice(0, 3)) {
      expect(fs.existsSync(path.join(workspace, t.relativePath))).toBe(true);
    }
    expect(mock.getFullOutput()).toContain('3** created');
  });

  it('declines to overwrite when the modal returns undefined', async () => {
    const target = SKILL_TEMPLATES[0];
    const absolute = path.join(workspace, target.relativePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, 'original-content', 'utf8');

    vscodeMock.window.showQuickPick.mockResolvedValueOnce([{ template: target }] as any);
    vscodeMock.window.showWarningMessage.mockResolvedValueOnce(undefined as any);

    const mock = createMockStream();
    await handler('', mock.stream as any, createMockToken() as any);

    expect(fs.readFileSync(absolute, 'utf8')).toBe('original-content');
    expect(mock.getFullOutput()).toContain('1** skipped');
  });

  it('overwrites when the user confirms via the modal', async () => {
    const target = SKILL_TEMPLATES[0];
    const absolute = path.join(workspace, target.relativePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, 'old', 'utf8');

    vscodeMock.window.showQuickPick.mockResolvedValueOnce([{ template: target }] as any);
    vscodeMock.window.showWarningMessage.mockResolvedValueOnce('Overwrite' as any);

    const mock = createMockStream();
    await handler('', mock.stream as any, createMockToken() as any);

    expect(fs.readFileSync(absolute, 'utf8')).toBe(target.body());
    expect(mock.getFullOutput()).toContain('1** overwritten');
  });

  it('mixes create + overwrite + skip across a multi-selection', async () => {
    // Pre-create templates[0] (user will decline) and templates[1]
    // (user will accept). templates[2] is new.
    const [t0, t1, t2] = SKILL_TEMPLATES;
    for (const t of [t0, t1]) {
      const abs = path.join(workspace, t.relativePath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, 'existing', 'utf8');
    }

    vscodeMock.window.showQuickPick.mockResolvedValueOnce([
      { template: t0 }, { template: t1 }, { template: t2 },
    ] as any);
    vscodeMock.window.showWarningMessage
      .mockResolvedValueOnce(undefined as any)   // decline t0
      .mockResolvedValueOnce('Overwrite' as any); // accept t1

    const mock = createMockStream();
    await handler('', mock.stream as any, createMockToken() as any);

    expect(fs.readFileSync(path.join(workspace, t0.relativePath), 'utf8')).toBe('existing');
    expect(fs.readFileSync(path.join(workspace, t1.relativePath), 'utf8')).toBe(t1.body());
    expect(fs.existsSync(path.join(workspace, t2.relativePath))).toBe(true);

    const out = mock.getFullOutput();
    expect(out).toContain('1** created');
    expect(out).toContain('1** overwritten');
    expect(out).toContain('1** skipped');
  });

  it('reports filesystem errors without throwing', async () => {
    const target = SKILL_TEMPLATES[0];
    // Create a *directory* at the target file path so fs.renameSync in
    // atomicWrite fails (EISDIR / EPERM) and the handler reports the
    // error through the summary rather than throwing out of the chat
    // request.
    const absolute = path.join(workspace, target.relativePath);
    fs.mkdirSync(absolute, { recursive: true });

    vscodeMock.window.showQuickPick.mockResolvedValueOnce([{ template: target }] as any);
    // File exists (as a dir) so the overwrite modal runs; accept to
    // exercise the write path.
    vscodeMock.window.showWarningMessage.mockResolvedValueOnce('Overwrite' as any);

    const mock = createMockStream();
    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('failed');
  });
});

describe('/init v2 — legacy `all` shortcut', () => {
  it('scaffolds every template on a fresh workspace without prompting', async () => {
    const mock = createMockStream();
    await handler('all', mock.stream as any, createMockToken() as any);

    expect(vscodeMock.window.showQuickPick).not.toHaveBeenCalled();
    for (const t of SKILL_TEMPLATES) {
      expect(fs.existsSync(path.join(workspace, t.relativePath))).toBe(true);
    }
    expect(mock.getFullOutput()).toContain(`${SKILL_TEMPLATES.length}** created`);
  });

  it('never overwrites pre-existing files in `all` mode', async () => {
    const target = SKILL_TEMPLATES[0];
    const abs = path.join(workspace, target.relativePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'keep-me', 'utf8');

    const mock = createMockStream();
    await handler('all', mock.stream as any, createMockToken() as any);

    expect(fs.readFileSync(abs, 'utf8')).toBe('keep-me');
    expect(vscodeMock.window.showWarningMessage).not.toHaveBeenCalled();
    const out = mock.getFullOutput();
    expect(out).toContain('skipped');
  });

  it('accepts `all` case-insensitively and with surrounding whitespace', async () => {
    const mock = createMockStream();
    await handler('  ALL  ', mock.stream as any, createMockToken() as any);
    expect(vscodeMock.window.showQuickPick).not.toHaveBeenCalled();
    expect(mock.getFullOutput()).toContain('created');
  });
});

describe('atomicWrite', () => {
  it('writes content and leaves no .tmp artifact behind', () => {
    const file = path.join(workspace, 'atomic.md');
    atomicWrite(file, 'payload');
    expect(fs.readFileSync(file, 'utf8')).toBe('payload');
    expect(fs.readdirSync(workspace).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('creates parent directories recursively', () => {
    const file = path.join(workspace, 'a', 'deeply', 'nested', 'file.md');
    atomicWrite(file, 'x');
    expect(fs.readFileSync(file, 'utf8')).toBe('x');
  });
});

describe('SKILL_TEMPLATES registry', () => {
  it('has one entry per AGENT_SKILL_MAP skill plus the project rules', async () => {
    // 7 skills + 1 rules file = 8
    expect(SKILL_TEMPLATES.length).toBe(8);
    const ids = SKILL_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('rules:project');
  });

  it('produces deterministic bodies with expected frontmatter', () => {
    const skill = SKILL_TEMPLATES.find((t) => t.id.startsWith('skill:'));
    expect(skill).toBeDefined();
    const body = skill!.body();
    expect(body).toMatch(/^---\nname: /);
    expect(body).toContain('## Instructions');
  });
});
