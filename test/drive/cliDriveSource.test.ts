import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CliDriveRunner,
  CliDriveSource,
  CliDriveNotAvailableError,
} from '../../src/drive/cliDriveSource.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// Mock runner
// ---------------------------------------------------------------------------

interface MockRunner extends CliDriveRunner {
  list: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}

function makeRunner(): MockRunner {
  return {
    list: vi.fn(),
    get: vi.fn(),
  };
}

let runner: MockRunner;
let source: CliDriveSource;

beforeEach(() => {
  runner = makeRunner();
  source = new CliDriveSource(runner);
});

// ---------------------------------------------------------------------------
// Listing — happy paths
// ---------------------------------------------------------------------------

describe('CliDriveSource — listings', () => {
  it('parses an array payload for prompts', async () => {
    runner.list.mockResolvedValue([
      { id: 'p1', category: 'prompt', name: 'A', source: 'cli' },
      { id: 'p2', category: 'prompt', name: 'B', source: 'cli' },
    ]);
    const prompts = await source.listPrompts();
    expect(prompts.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(runner.list).toHaveBeenCalledWith('prompt');
  });

  it('parses a { items: [...] } payload for rules', async () => {
    runner.list.mockResolvedValue({
      items: [
        { id: 'r1', category: 'rule', name: 'no-todo', source: 'cli', scope: 'project' },
      ],
      meta: { total: 1 },
    });
    const rules = await source.listRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].scope).toBe('project');
  });

  it('parses a { <category>s: [...] } payload for skills', async () => {
    runner.list.mockResolvedValue({
      skills: [{ id: 's1', category: 'skill', name: '5-test', source: 'cli' }],
    });
    const skills = await source.listSkills();
    expect(skills[0].name).toBe('5-test');
  });

  it('defaults source to `cli` when the upstream producer omits it', async () => {
    runner.list.mockResolvedValue([
      { id: 'p1', category: 'prompt', name: 'A' }, // no source
    ]);
    const prompts = await source.listPrompts();
    expect(prompts[0].source).toBe('cli');
  });

  it('accepts `kind` as an alias of `category`', async () => {
    runner.list.mockResolvedValue([
      { id: 'p1', kind: 'prompt', name: 'A', source: 'cli' },
    ]);
    const prompts = await source.listPrompts();
    expect(prompts[0].category).toBe('prompt');
  });

  it('returns an empty array for unexpected payload shapes', async () => {
    runner.list.mockResolvedValue('not-an-object');
    expect(await source.listPrompts()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Listing — rejection & filtering
// ---------------------------------------------------------------------------

describe('CliDriveSource — entry filtering', () => {
  it('drops rows that fail the strict parser, keeping valid siblings', async () => {
    runner.list.mockResolvedValue([
      { id: 'p1', category: 'prompt', name: 'A', source: 'cli' },
      { id: '', category: 'prompt', name: 'invalid-empty-id', source: 'cli' },
      { category: 'prompt', name: 'missing-id', source: 'cli' },
      { id: 'p2', category: 'prompt', name: 'B', source: 'cli' },
    ]);
    const prompts = await source.listPrompts();
    expect(prompts.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('drops rows whose category does not match the request (defence in depth)', async () => {
    runner.list.mockResolvedValue([
      { id: 'p1', category: 'prompt', name: 'A', source: 'cli' },
      { id: 'r1', category: 'rule', name: 'sneaky', source: 'cli' },
    ]);
    const prompts = await source.listPrompts();
    expect(prompts.map((p) => p.id)).toEqual(['p1']);
  });
});

// ---------------------------------------------------------------------------
// Not-available fallback
// ---------------------------------------------------------------------------

describe('CliDriveSource — not-available surface', () => {
  it('throws CliDriveNotAvailableError on OzCliErrorKind.NOT_FOUND during list', async () => {
    runner.list.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_FOUND, 'oz binary missing'));
    await expect(source.listPrompts()).rejects.toBeInstanceOf(CliDriveNotAvailableError);
  });

  it('throws CliDriveNotAvailableError on CLI_ERROR with `unknown command` stderr', async () => {
    runner.list.mockRejectedValue(
      new OzCliError(OzCliErrorKind.CLI_ERROR, 'exit 64', 64, 'Error: unknown command `drive`'),
    );
    await expect(source.listRules()).rejects.toBeInstanceOf(CliDriveNotAvailableError);
  });

  // Regression: the user's CLI does not have a `drive` subcommand and clap
  // (the Rust CLI parser used by some Warp builds) rejects the bare word
  // `drive` as a positional value. The fallback to filesystem must still
  // kick in transparently — the user must NOT see an opaque error tile.
  it.each([
    "error: invalid value 'drive' for '[USAGE]'",
    'error: invalid value "drive" for "<COMMAND>"',
    "error: unrecognized argument 'drive'",
    "error: unexpected argument 'drive' found",
    'error: unrecognized subcommand drive',
    'error: no such subcommand: drive',
  ])('reclassifies clap-style stderr `%s` as drive-not-available', async (stderr) => {
    runner.list.mockRejectedValue(
      new OzCliError(OzCliErrorKind.CLI_ERROR, 'exit 2', 2, stderr),
    );
    await expect(source.listPrompts()).rejects.toBeInstanceOf(CliDriveNotAvailableError);
  });

  it('treats STALLED on a drive call as drive-not-available so the FS fallback wins', async () => {
    runner.list.mockRejectedValue(
      new OzCliError(OzCliErrorKind.STALLED, 'no output for 90s', 0, ''),
    );
    await expect(source.listPrompts()).rejects.toBeInstanceOf(CliDriveNotAvailableError);
  });

  it('does NOT mask other CLI errors', async () => {
    const err = new OzCliError(OzCliErrorKind.NOT_AUTHENTICATED, 'run `oz login`');
    runner.list.mockRejectedValue(err);
    await expect(source.listSkills()).rejects.toBe(err);
  });
});

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

describe('CliDriveSource.read', () => {
  it('returns the raw markdown body from the runner', async () => {
    runner.get.mockResolvedValue('# hello');
    expect(await source.read('abc')).toBe('# hello');
    expect(runner.get).toHaveBeenCalledWith('abc');
  });

  it('trims whitespace-only ids before calling the runner', async () => {
    runner.get.mockResolvedValue('payload');
    await source.read('  xyz  ');
    expect(runner.get).toHaveBeenCalledWith('xyz');
  });

  it('rejects empty ids synchronously', async () => {
    await expect(source.read('   ')).rejects.toThrow('empty id');
    expect(runner.get).not.toHaveBeenCalled();
  });

  it('maps runner NOT_FOUND to CliDriveNotAvailableError', async () => {
    runner.get.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_FOUND, 'oz missing'));
    await expect(source.read('id')).rejects.toBeInstanceOf(CliDriveNotAvailableError);
  });

  it('propagates other errors untouched', async () => {
    const err = new Error('network down');
    runner.get.mockRejectedValue(err);
    await expect(source.read('id')).rejects.toBe(err);
  });
});

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

describe('CliDriveSource — static shape', () => {
  it('advertises the `oz-cli` label', () => {
    expect(source.label).toBe('oz-cli');
  });

  it('CliDriveNotAvailableError carries the documented kind', () => {
    const err = new CliDriveNotAvailableError();
    expect(err.name).toBe('CliDriveNotAvailableError');
    expect(err.kind).toBe('CLI_DRIVE_NOT_AVAILABLE');
  });
});
