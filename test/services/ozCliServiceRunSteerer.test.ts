import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { OzCliService } from '../../src/services/ozCliService.js';
import { OzCliError } from '../../src/types/index.js';
import { createMockConfigManager } from '../helpers.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFileSync: vi.fn(() => { throw new Error('not found'); }),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

import { spawn } from 'node:child_process';
const mockSpawn = vi.mocked(spawn);

function createMockProcess(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
} = {}) {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
    pid: 9999,
  });

  mockSpawn.mockReturnValue(proc as never);

  process.nextTick(() => {
    if (opts.stdout) proc.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.stderr) proc.stderr.emit('data', Buffer.from(opts.stderr));
    proc.emit('close', opts.exitCode ?? 0);
  });

  return proc;
}

let cli: OzCliService;

beforeEach(() => {
  vi.clearAllMocks();
  cli = new OzCliService(createMockConfigManager());
});

describe('OzCliService.agentContinue()', () => {
  it('builds the expected argv with --continue and --prompt (output format via env)', async () => {
    createMockProcess({
      stdout: JSON.stringify({ run_id: 'r1', status: 'INPROGRESS', output: 'ok' }),
    });

    await cli.agentContinue({ runId: 'run-1', prompt: 'do x' });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toEqual([
      'agent', 'run',
      '--continue', 'run-1',
      '--prompt', 'do x',
    ]);
    // `--output-format` is now set globally via WARP_OUTPUT_FORMAT.
    const spawnOpts = mockSpawn.mock.calls[0][2] as { env?: Record<string, string> };
    expect(spawnOpts.env?.WARP_OUTPUT_FORMAT).toBe('json');
  });

  it('rejects an empty prompt without spawning', async () => {
    await expect(
      cli.agentContinue({ runId: 'run-1', prompt: '' }),
    ).rejects.toThrow(/Prompt cannot be empty/);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('rejects an unsafe runId via sanitizeId without spawning', async () => {
    await expect(
      cli.agentContinue({ runId: 'run-1; rm -rf /', prompt: 'do x' }),
    ).rejects.toThrow(OzCliError);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('parses the JSON payload into an OzRunResult', async () => {
    createMockProcess({
      stdout: JSON.stringify({
        run_id: 'r-9',
        status: 'SUCCEEDED',
        output: 'done',
      }),
    });

    const result = await cli.agentContinue({ runId: 'r-9', prompt: 'finish up' });

    expect(result.runId).toBe('r-9');
    expect(result.status).toBe('SUCCEEDED');
    expect(result.output).toContain('done');
  });
});

describe('OzCliService.helpAgentRun()', () => {
  it('invokes `agent run --help` and returns stdout verbatim', async () => {
    const help = 'Usage: oz agent run [OPTIONS]\n  --continue ID   resume\n';
    createMockProcess({ stdout: help });

    const out = await cli.helpAgentRun();

    expect(out).toBe(help);
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toEqual(['agent', 'run', '--help']);
  });

  it('returns the stdout even when stderr is non-empty (help often goes to both)', async () => {
    createMockProcess({
      stdout: 'Options:\n  --prompt P\n',
      stderr: 'warning: deprecated flag\n',
    });

    const out = await cli.helpAgentRun();

    expect(out).toContain('Options:');
  });
});
