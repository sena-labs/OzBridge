import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHistoryCommand } from '../../src/commands/historyCommand.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';
import {
  createMockCli,
  createMockConfigManager,
  createMockStream,
  createMockToken,
  makeRunResult,
  makeListResult,
} from '../helpers.js';

let cli: ReturnType<typeof createMockCli>;
let mock: ReturnType<typeof createMockStream>;

beforeEach(() => {
  vi.clearAllMocks();
  cli = createMockCli();
  mock = createMockStream();
});

// ==========================================================================
// /history — focuses on completed runs (SUCCEEDED + FAILED)
// ==========================================================================
describe('/history command', () => {
  let handler: ReturnType<typeof createHistoryCommand>;

  beforeEach(() => {
    handler = createHistoryCommand(cli, createMockConfigManager());
  });

  it('should list completed runs (SUCCEEDED + FAILED) when prompt is empty', async () => {
    cli.runList.mockResolvedValue(makeListResult([
      { id: 'r1', status: 'SUCCEEDED' },
      { id: 'r2', status: 'FAILED' },
      { id: 'r3', status: 'INPROGRESS' }, // should be filtered out
    ]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(cli.runList).toHaveBeenCalled();
    const output = mock.getFullOutput();
    expect(output).toContain('r1');
    expect(output).toContain('r2');
    expect(output).not.toContain('r3');
    expect(output).toContain('2 completed runs');
  });

  it('should use singular form when exactly one completed run matches', async () => {
    cli.runList.mockResolvedValue(makeListResult([
      { id: 'r1', status: 'SUCCEEDED' },
      { id: 'r2', status: 'INPROGRESS' }, // filtered out
    ]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('1 completed run:');
  });

  it('should filter to succeeded runs only when filter is "succeeded"', async () => {
    cli.runList.mockResolvedValue(makeListResult([
      { id: 's1', status: 'SUCCEEDED' },
      { id: 'f1', status: 'FAILED' },
    ]));

    await handler('succeeded', mock.stream as any, createMockToken() as any);

    const output = mock.getFullOutput();
    expect(output).toContain('s1');
    expect(output).not.toContain('f1');
    expect(output).toContain('1 succeeded run');
  });

  it('should filter to failed runs only when filter is "failed"', async () => {
    cli.runList.mockResolvedValue(makeListResult([
      { id: 's1', status: 'SUCCEEDED' },
      { id: 'f1', status: 'FAILED' },
    ]));

    await handler('failed', mock.stream as any, createMockToken() as any);

    const output = mock.getFullOutput();
    expect(output).toContain('f1');
    expect(output).not.toContain('s1');
    expect(output).toContain('1 failed run');
  });

  it('should show run detail when prompt contains a runId', async () => {
    cli.runGet.mockResolvedValue(makeRunResult({ runId: 'run-abc', status: 'SUCCEEDED', output: 'output' }));

    await handler('run-abc', mock.stream as any, createMockToken() as any);

    expect(cli.runGet).toHaveBeenCalledWith('run-abc');
    expect(mock.getFullOutput()).toContain('run-abc');
  });

  it('should show rawText message when list is empty with rawText', async () => {
    cli.runList.mockResolvedValue(makeListResult([], 'No runs found.'));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('No runs found.');
  });

  it('should show default empty message when list is empty without rawText', async () => {
    cli.runList.mockResolvedValue(makeListResult([]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('No runs in history');
  });

  it('should handle OzCliError on runList', async () => {
    cli.runList.mockRejectedValue(new OzCliError(OzCliErrorKind.CLI_ERROR, 'fail', 1));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('CLI Error');
  });

  it('should handle generic Error on runList', async () => {
    cli.runList.mockRejectedValue(new Error('unknown'));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('unknown');
  });

  it('should handle OzCliError on runGet with runId', async () => {
    cli.runGet.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_FOUND, 'run not found'));

    await handler('run-xyz', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('not found');
  });

  it('should handle generic Error on runGet with runId', async () => {
    cli.runGet.mockRejectedValue(new Error('connection lost'));

    await handler('run-abc', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('connection lost');
  });

  it('should handle non-Error thrown value (String() branch)', async () => {
    cli.runList.mockRejectedValue('raw history error');

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('raw history error');
  });

  it('should show progress indicator for list', async () => {
    cli.runList.mockResolvedValue(makeListResult([]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.progresses.length).toBeGreaterThan(0);
    expect(mock.progresses[0]).toContain('history');
  });

  it('should show progress indicator for detail', async () => {
    cli.runGet.mockResolvedValue(makeRunResult({ runId: 'run-abc' }));

    await handler('run-abc', mock.stream as any, createMockToken() as any);

    expect(mock.progresses.length).toBeGreaterThan(0);
    expect(mock.progresses[0]).toContain('run-abc');
  });

  it('should trim whitespace from prompt', async () => {
    cli.runGet.mockResolvedValue(makeRunResult({ runId: 'run-abc' }));

    await handler('  run-abc  ', mock.stream as any, createMockToken() as any);

    expect(cli.runGet).toHaveBeenCalledWith('run-abc');
  });
});
