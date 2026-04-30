import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  CompositeDriveSource,
  createOzBridgeDriveSource,
} from '../../src/drive/driveSourceFactory.js';
import * as logger from '../../src/services/logger.js';
import {
  CliDriveNotAvailableError,
  CliDriveRunner,
} from '../../src/drive/cliDriveSource.js';
import { FileSystemDriveSource } from '../../src/drive/fileSystemDriveSource.js';
import {
  DrivePrompt,
  DriveRule,
  DriveSkill,
  IDriveSource,
} from '../../src/drive/warpDriveSource.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeSource(label: string, overrides: Partial<IDriveSource> = {}): IDriveSource {
  return {
    label,
    listPrompts: vi.fn(async () => []),
    listRules: vi.fn(async () => []),
    listSkills: vi.fn(async () => []),
    read: vi.fn(async () => ''),
    ...overrides,
  } as IDriveSource;
}

// ---------------------------------------------------------------------------
// CompositeDriveSource
// ---------------------------------------------------------------------------

describe('CompositeDriveSource — fallback semantics', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'logWarn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns primary results when the primary succeeds', async () => {
    const primary = makeSource('primary', {
      listPrompts: vi.fn(async () => [{
        id: 'p1', category: 'prompt', name: 'A', source: 'cli',
      } as DrivePrompt]),
    });
    const fallback = makeSource('fallback');
    const composite = new CompositeDriveSource(primary, fallback);
    const prompts = await composite.listPrompts();
    expect(prompts).toHaveLength(1);
    expect(fallback.listPrompts).not.toHaveBeenCalled();
  });

  it('falls back to the secondary only on CliDriveNotAvailableError', async () => {
    const primary = makeSource('primary', {
      listRules: vi.fn(async () => { throw new CliDriveNotAvailableError(); }),
    });
    const fallback = makeSource('fallback', {
      listRules: vi.fn(async () => [{
        id: 'r1', category: 'rule', name: 'no-todo', source: 'filesystem',
      } as DriveRule]),
    });
    const composite = new CompositeDriveSource(primary, fallback);
    const rules = await composite.listRules();
    expect(rules.map((r) => r.id)).toEqual(['r1']);
    expect(fallback.listRules).toHaveBeenCalledTimes(1);
  });

  it('does NOT fall back on generic errors (propagates so the user sees them)', async () => {
    const err = new OzCliError(OzCliErrorKind.NOT_AUTHENTICATED, 'run oz login');
    const primary = makeSource('primary', {
      listSkills: vi.fn(async () => { throw err; }),
    });
    const fallback = makeSource('fallback', {
      listSkills: vi.fn(async () => [{
        id: 's1', category: 'skill', name: '5-test', source: 'filesystem',
      } as DriveSkill]),
    });
    const composite = new CompositeDriveSource(primary, fallback);
    await expect(composite.listSkills()).rejects.toBe(err);
    expect(fallback.listSkills).not.toHaveBeenCalled();
  });

  it('applies the fallback on read() when the primary reports not-available', async () => {
    const primary = makeSource('primary', {
      read: vi.fn(async () => { throw new CliDriveNotAvailableError(); }),
    });
    const fallback = makeSource('fallback', {
      read: vi.fn(async () => '# fallback content'),
    });
    const composite = new CompositeDriveSource(primary, fallback);
    const body = await composite.read('abc');
    expect(body).toContain('fallback content');
    expect(fallback.read).toHaveBeenCalledWith('abc');
  });

  it('logs fallback warning only once per session', async () => {
    const primary = makeSource('primary', {
      listPrompts: vi.fn(async () => { throw new CliDriveNotAvailableError(); }),
    });
    const fallback = makeSource('fallback', {
      listPrompts: vi.fn(async () => []),
    });
    const composite = new CompositeDriveSource(primary, fallback);

    await composite.listPrompts();
    await composite.listPrompts();

    expect(logger.logWarn).toHaveBeenCalledTimes(1);
  });

  it('computes a composed label for diagnostics', () => {
    const composite = new CompositeDriveSource(makeSource('oz-cli'), makeSource('filesystem'));
    expect(composite.label).toBe('oz-cli+filesystem');
  });
});

// ---------------------------------------------------------------------------
// createOzBridgeDriveSource
// ---------------------------------------------------------------------------

describe('createOzBridgeDriveSource', () => {
  let tmp: string;
  let promptsDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ozbridge-drive-factory-'));
    promptsDir = path.join(tmp, 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('without a runner, returns a plain FileSystemDriveSource', async () => {
    const source = createOzBridgeDriveSource({ filesystem: { promptsDir, rulesDir: tmp, skillsDir: tmp } });
    expect(source).toBeInstanceOf(FileSystemDriveSource);
    expect(source.label).toBe('filesystem');
    expect(await source.listPrompts()).toEqual([]);
  });

  it('with a runner, returns a CompositeDriveSource labelled oz-cli+filesystem', () => {
    const runner: CliDriveRunner = {
      list: vi.fn(async () => []),
      get: vi.fn(async () => ''),
    };
    const source = createOzBridgeDriveSource({
      runner,
      filesystem: { promptsDir, rulesDir: tmp, skillsDir: tmp },
    });
    expect(source).toBeInstanceOf(CompositeDriveSource);
    expect(source.label).toBe('oz-cli+filesystem');
  });

  it('prefers the CLI runner when it succeeds', async () => {
    fs.writeFileSync(path.join(promptsDir, 'fs.md'), '---\nname: fs-prompt\n---\nbody', 'utf8');
    const runner: CliDriveRunner = {
      list: vi.fn(async () => [{ id: 'cli-1', category: 'prompt', name: 'cli-prompt', source: 'cli' }]),
      get: vi.fn(async () => '# cli body'),
    };
    const source = createOzBridgeDriveSource({
      runner,
      filesystem: { promptsDir, rulesDir: tmp, skillsDir: tmp },
    });
    const prompts = await source.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['cli-prompt']);
  });

  it('falls back to the filesystem when the CLI runner reports unknown command', async () => {
    fs.writeFileSync(path.join(promptsDir, 'fs.md'), '---\nname: fs-prompt\n---\nbody', 'utf8');
    const runner: CliDriveRunner = {
      list: vi.fn(async () => {
        throw new OzCliError(OzCliErrorKind.CLI_ERROR, 'exit 64', 64, 'Error: unknown command `drive`');
      }),
      get: vi.fn(async () => ''),
    };
    const source = createOzBridgeDriveSource({
      runner,
      filesystem: { promptsDir, rulesDir: tmp, skillsDir: tmp },
    });
    const prompts = await source.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['fs-prompt']);
  });
});
