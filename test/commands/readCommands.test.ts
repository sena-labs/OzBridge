import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStatusCommand } from '../../src/commands/statusCommand.js';
import { createModelsCommand } from '../../src/commands/modelsCommand.js';
import { createMcpCommand } from '../../src/commands/mcpCommand.js';
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
// /status — focuses on active runs (QUEUED + INPROGRESS)
// ==========================================================================
describe('/status command', () => {
  let handler: ReturnType<typeof createStatusCommand>;

  beforeEach(() => {
    handler = createStatusCommand(cli, createMockConfigManager());
  });

  it('should list only active runs (QUEUED + INPROGRESS) when prompt is empty', async () => {
    cli.runList.mockResolvedValue(makeListResult([
      { id: 'a1', status: 'INPROGRESS' },
      { id: 'a2', status: 'QUEUED' },
      { id: 'c1', status: 'SUCCEEDED' }, // filtered out
      { id: 'c2', status: 'FAILED' },    // filtered out
    ]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(cli.runList).toHaveBeenCalled();
    const output = mock.getFullOutput();
    expect(output).toContain('a1');
    expect(output).toContain('a2');
    expect(output).not.toContain('c1');
    expect(output).not.toContain('c2');
    expect(output).toContain('2 active runs');
  });

  it('should use singular form when exactly one active run', async () => {
    cli.runList.mockResolvedValue(makeListResult([
      { id: 'only', status: 'INPROGRESS' },
      { id: 'done', status: 'SUCCEEDED' },
    ]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('1 active run:');
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

  it('should show "no active runs" hint when no active runs', async () => {
    cli.runList.mockResolvedValue(makeListResult([
      { id: 'c1', status: 'SUCCEEDED' }, // none active
    ]));

    await handler('', mock.stream as any, createMockToken() as any);

    const output = mock.getFullOutput();
    expect(output).toContain('No active runs');
    expect(output).toContain('/history');
  });

  it('should handle CLI error', async () => {
    cli.runList.mockRejectedValue(new OzCliError(OzCliErrorKind.CLI_ERROR, 'fail', 1));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('CLI Error');
  });

  it('should handle generic Error', async () => {
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
    cli.runList.mockRejectedValue('raw status error');

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('raw status error');
  });
});

// ==========================================================================
// /models
// ==========================================================================
describe('/models command', () => {
  let handler: ReturnType<typeof createModelsCommand>;

  beforeEach(() => {
    handler = createModelsCommand(cli, createMockConfigManager());
  });

  it('should list models with count', async () => {
    cli.modelList.mockResolvedValue(makeListResult([{ id: 'gpt-4' }, { id: 'claude-3' }]));

    await handler('', mock.stream as any, createMockToken() as any);

    const output = mock.getFullOutput();
    expect(output).toContain('2 models');
    expect(output).toContain('gpt-4');
    expect(output).toContain('claude-3');
  });

  it('should show default model', async () => {
    cli.modelList.mockResolvedValue(makeListResult([{ id: 'gpt-4' }]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('auto');
  });

  it('should show empty message when no models', async () => {
    cli.modelList.mockResolvedValue(makeListResult([]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('No models');
  });

  it('should handle OzCliError', async () => {
    cli.modelList.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_FOUND, 'not found'));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('not found');
  });

  // Gap: errore generico (non-OzCliError)
  it('dovrebbe gestire errore generico (non-OzCliError)', async () => {
    cli.modelList.mockRejectedValue(new Error('network failure'));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('network failure');
  });

  // Gap: errore non-Error (stringa) → instanceof Error false branch (L43)
  it('dovrebbe gestire errore non-Error (stringa) nel catch (String() branch)', async () => {
    cli.modelList.mockRejectedValue('raw models error');

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('raw models error');
  });

  it('sets the default model when given a valid id (`/models <id>`)', async () => {
    cli.modelList.mockResolvedValue(makeListResult([{ id: 'gpt-4' }, { id: 'claude-3' }]));

    await handler('claude-3', mock.stream as any, createMockToken() as any);

    const out = mock.getFullOutput();
    expect(out).toContain('claude-3');
    expect(out.toLowerCase()).toContain('saved');
  });

  it('rejects an unknown model id without saving', async () => {
    cli.modelList.mockResolvedValue(makeListResult([{ id: 'gpt-4' }]));

    await handler('does-not-exist', mock.stream as any, createMockToken() as any);

    const out = mock.getFullOutput();
    expect(out).toContain('Unknown model');
    expect(out).toContain('does-not-exist');
  });
});

// ==========================================================================
// /mcp
// ==========================================================================
describe('/mcp command', () => {
  let handler: ReturnType<typeof createMcpCommand>;

  beforeEach(() => {
    handler = createMcpCommand(cli, createMockConfigManager());
  });

  it('should list MCP servers with count', async () => {
    cli.mcpList.mockResolvedValue(makeListResult([
      { uuid: 'u1', name: 'mcp-server-1' },
      { uuid: 'u2', name: 'mcp-server-2' },
    ]));

    await handler('', mock.stream as any, createMockToken() as any);

    const output = mock.getFullOutput();
    expect(output).toContain('2 MCP servers');
    expect(output).toContain('mcp-server-1');
  });

  it('should show empty message when no MCP servers', async () => {
    cli.mcpList.mockResolvedValue(makeListResult([]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('No MCP servers');
  });

  it('should handle generic error', async () => {
    cli.mcpList.mockRejectedValue(new Error('fail'));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('fail');
  });

  // Gap: OzCliError in catch
  it('should handle OzCliError via formatError', async () => {
    cli.mcpList.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_AUTHENTICATED, 'forbidden'));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Not authenticated');
  });

  // Gap: errore non-Error (stringa) → instanceof Error false branch (L41)
  it('dovrebbe gestire errore non-Error (stringa) nel catch (String() branch)', async () => {
    cli.mcpList.mockRejectedValue('raw mcp error');

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('raw mcp error');
  });
});
