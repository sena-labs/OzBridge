import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
import { initI18n, _resetI18n } from '../../src/core/i18n.js';

let cli: ReturnType<typeof createMockCli>;
let mock: ReturnType<typeof createMockStream>;

beforeEach(() => {
  vi.clearAllMocks();
  initI18n('it');
  cli = createMockCli();
  mock = createMockStream();
});

afterEach(() => {
  _resetI18n();
});

// ==========================================================================
// /history
// ==========================================================================
describe('/history command', () => {
  let handler: ReturnType<typeof createHistoryCommand>;

  beforeEach(() => {
    handler = createHistoryCommand(cli, createMockConfigManager());
  });

  it('should list recent runs when prompt is empty', async () => {
    cli.runList.mockResolvedValue(makeListResult([
      { id: 'r1', status: 'SUCCEEDED' },
      { id: 'r2', status: 'FAILED' },
    ]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(cli.runList).toHaveBeenCalled();
    const output = mock.getFullOutput();
    expect(output).toContain('r1');
    expect(output).toContain('r2');
    expect(output).toContain('2 run recenti');
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

  it('should show i18n empty message when list is empty without rawText', async () => {
    cli.runList.mockResolvedValue(makeListResult([]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Nessun run nella cronologia');
  });

  it('should handle OzCliError on runList', async () => {
    cli.runList.mockRejectedValue(new OzCliError(OzCliErrorKind.CLI_ERROR, 'fail', 1));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Errore CLI');
  });

  it('should handle generic Error on runList', async () => {
    cli.runList.mockRejectedValue(new Error('unknown'));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('unknown');
  });

  it('should handle OzCliError on runGet with runId', async () => {
    cli.runGet.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_FOUND, 'run not found'));

    await handler('run-xyz', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('non trovato');
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
    expect(mock.progresses[0]).toContain('cronologia');
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
