import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileSystemDriveSource } from '../../src/drive/fileSystemDriveSource.js';

let root: string;
let promptsDir: string;
let rulesDir: string;
let skillsDir: string;
let source: FileSystemDriveSource;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'warp-vsc-drive-fs-'));
  promptsDir = path.join(root, 'prompts');
  rulesDir = path.join(root, 'rules');
  skillsDir = path.join(root, 'skills');
  fs.mkdirSync(promptsDir, { recursive: true });
  fs.mkdirSync(rulesDir, { recursive: true });
  fs.mkdirSync(skillsDir, { recursive: true });
  source = new FileSystemDriveSource({ promptsDir, rulesDir, skillsDir });
});

afterEach(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

function writePrompt(name: string, frontmatter: string | null, body = '# body'): string {
  const file = path.join(promptsDir, `${name}.md`);
  const content = frontmatter !== null
    ? `---\n${frontmatter}\n---\n${body}`
    : body;
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

function writeRule(name: string, frontmatter: string | null, body = '# body'): string {
  const file = path.join(rulesDir, `${name}.md`);
  const content = frontmatter !== null
    ? `---\n${frontmatter}\n---\n${body}`
    : body;
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

function writeSkill(folderName: string, frontmatter: string, body = '# body'): string {
  const dir = path.join(skillsDir, folderName);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'SKILL.md');
  fs.writeFileSync(file, `---\n${frontmatter}\n---\n${body}`, 'utf8');
  return file;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

describe('FileSystemDriveSource — prompts', () => {
  it('returns [] when the prompts dir is empty or missing', async () => {
    expect(await source.listPrompts()).toEqual([]);
  });

  it('picks up prompts with full frontmatter', async () => {
    writePrompt('deploy', 'name: Deploy\ndescription: Push to staging\ntags: "deploy, ops"');
    const prompts = await source.listPrompts();
    expect(prompts).toHaveLength(1);
    expect(prompts[0].name).toBe('Deploy');
    expect(prompts[0].description).toBe('Push to staging');
    expect(prompts[0].tags).toEqual(['deploy', 'ops']);
    expect(prompts[0].source).toBe('filesystem');
    expect(prompts[0].category).toBe('prompt');
  });

  it('falls back to the filename (without extension) when frontmatter is absent', async () => {
    writePrompt('quick-fix', null, '# just a prompt body');
    const prompts = await source.listPrompts();
    expect(prompts[0].name).toBe('quick-fix');
  });

  it('ignores non-markdown files in the prompts dir', async () => {
    writePrompt('keep', 'name: Keep');
    fs.writeFileSync(path.join(promptsDir, 'README.txt'), 'text');
    fs.writeFileSync(path.join(promptsDir, 'script.js'), 'console.log(1);');
    const prompts = await source.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['Keep']);
  });

  it('is tolerant of a missing closing frontmatter delimiter', async () => {
    const file = path.join(promptsDir, 'broken.md');
    fs.writeFileSync(file, '---\nname: Broken\n# no closing delimiter', 'utf8');
    const prompts = await source.listPrompts();
    // Malformed frontmatter → treated as no frontmatter → fallback name.
    expect(prompts).toHaveLength(1);
    expect(prompts[0].name).toBe('broken');
  });

  it('sets updatedAt to the mtime in ISO format', async () => {
    const file = writePrompt('a', 'name: A');
    fs.utimesSync(file, new Date('2020-01-02T03:04:05Z'), new Date('2020-01-02T03:04:05Z'));
    const prompts = await source.listPrompts();
    expect(prompts[0].updatedAt).toBe('2020-01-02T03:04:05.000Z');
  });
});

describe('FileSystemDriveSource — rules', () => {
  it('recognises the scope field when valid', async () => {
    writeRule('r1', 'name: no-todo\nscope: project');
    writeRule('r2', 'name: budget\nscope: global');
    const rules = await source.listRules();
    expect(rules.find((r) => r.name === 'no-todo')!.scope).toBe('project');
    expect(rules.find((r) => r.name === 'budget')!.scope).toBe('global');
  });

  it('drops invalid scope values silently, leaving scope undefined', async () => {
    writeRule('r1', 'name: weird\nscope: personal');
    const rules = await source.listRules();
    expect(rules[0].scope).toBeUndefined();
  });
});

describe('FileSystemDriveSource — skills', () => {
  it('lists only directories that contain a SKILL.md', async () => {
    writeSkill('5-test-agent', 'name: 5-test-agent\nmodel: gpt-4o');
    const emptyDir = path.join(skillsDir, 'no-skill');
    fs.mkdirSync(emptyDir);
    const skills = await source.listSkills();
    expect(skills.map((s) => s.name)).toEqual(['5-test-agent']);
    expect(skills[0].model).toBe('gpt-4o');
  });

  it('uses the folder name as default when frontmatter `name` is missing', async () => {
    writeSkill('auto-name', 'description: inferred');
    const skills = await source.listSkills();
    expect(skills[0].name).toBe('auto-name');
  });

  it('ignores a non-string model field', async () => {
    writeSkill('typed', 'name: typed\nmodel: 42');
    const skills = await source.listSkills();
    expect(skills[0].model).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Read + path traversal guard
// ---------------------------------------------------------------------------

describe('FileSystemDriveSource.read', () => {
  it('reads a file that lives inside one of the allowed roots', async () => {
    const file = writePrompt('p', 'name: P', '# hello');
    const body = await source.read(file);
    expect(body).toContain('# hello');
  });

  it('rejects absolute paths outside the allowed roots', async () => {
    const stranger = path.join(root, 'secret.md');
    fs.writeFileSync(stranger, 'secret', 'utf8');
    await expect(source.read(stranger)).rejects.toThrow('outside allowed roots');
  });

  it('rejects path-traversal attempts that resolve above the allowed roots', async () => {
    // `../../etc/passwd` from inside promptsDir → still escapes roots
    const traversal = path.join(promptsDir, '..', '..', 'etc', 'passwd');
    await expect(source.read(traversal)).rejects.toThrow('outside allowed roots');
  });

  it('rejects empty ids synchronously', async () => {
    await expect(source.read('   ')).rejects.toThrow('empty id');
  });

  it('wraps fs errors with the module prefix', async () => {
    const missing = path.join(promptsDir, 'nope.md');
    await expect(source.read(missing)).rejects.toThrow('FileSystemDriveSource.read');
  });

  it('rejects symlink escapes that resolve outside allowed roots', async () => {
    const outsideDir = path.join(root, 'outside');
    fs.mkdirSync(outsideDir, { recursive: true });
    const secret = path.join(outsideDir, 'secret.md');
    fs.writeFileSync(secret, 'top secret', 'utf8');

    const linkDir = path.join(promptsDir, 'linked-outside');
    try {
      fs.symlinkSync(outsideDir, linkDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      // Symlinks may be disallowed on some Windows setups without dev mode/admin.
      expect(true).toBe(true);
      return;
    }

    const escapedPath = path.join(linkDir, 'secret.md');
    await expect(source.read(escapedPath)).rejects.toThrow('outside allowed roots');
  });

  it('allows reading a symlink that still resolves inside an allowed root', async () => {
    const target = writePrompt('target', 'name: target', '# target body');
    const alias = path.join(promptsDir, 'alias.md');
    try {
      fs.symlinkSync(target, alias, 'file');
    } catch {
      // Symlinks may be disallowed on some Windows setups without dev mode/admin.
      expect(true).toBe(true);
      return;
    }

    const content = await source.read(alias);
    expect(content).toContain('# target body');
  });
});

// ---------------------------------------------------------------------------
// Static shape
// ---------------------------------------------------------------------------

describe('FileSystemDriveSource — static shape', () => {
  it('advertises the `filesystem` label', () => {
    expect(source.label).toBe('filesystem');
  });

  it('constructs with default home directory when nothing is overridden', () => {
    // Just ensures the fallback does not throw; we don't touch real disk.
    const fallback = new FileSystemDriveSource();
    expect(fallback.label).toBe('filesystem');
  });
});
