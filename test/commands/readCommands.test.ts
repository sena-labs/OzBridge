import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
// /status
// ==========================================================================
describe('/status command', () => {
  let handler: ReturnType<typeof createStatusCommand>;

  beforeEach(() => {
    handler = createStatusCommand(cli, createMockConfigManager());
  });

  it('dovrebbe mostrare lista run se prompt vuoto', async () => {
    cli.runList.mockResolvedValue(makeListResult([
      { id: 'r1', status: 'SUCCEEDED' },
      { id: 'r2', status: 'FAILED' },
    ]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(cli.runList).toHaveBeenCalled();
    expect(mock.getFullOutput()).toContain('r1');
    expect(mock.getFullOutput()).toContain('r2');
  });

  it('dovrebbe mostrare dettaglio run se prompt contiene runId', async () => {
    cli.runGet.mockResolvedValue(makeRunResult({ runId: 'run-abc', status: 'SUCCEEDED', output: 'output' }));

    await handler('run-abc', mock.stream as any, createMockToken() as any);

    expect(cli.runGet).toHaveBeenCalledWith('run-abc');
    expect(mock.getFullOutput()).toContain('run-abc');
  });

  it('dovrebbe mostrare messaggio se nessun run trovato', async () => {
    cli.runList.mockResolvedValue(makeListResult([], 'No runs found.'));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('No runs found.');
  });

  it('dovrebbe mostrare messaggio default se lista vuota senza rawText', async () => {
    cli.runList.mockResolvedValue(makeListResult([]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Nessun run trovato');
  });

  it('dovrebbe gestire errore CLI', async () => {
    cli.runList.mockRejectedValue(new OzCliError(OzCliErrorKind.CLI_ERROR, 'fail', 1));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Errore CLI');
  });

  it('dovrebbe gestire errore generico', async () => {
    cli.runList.mockRejectedValue(new Error('unknown'));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('unknown');
  });

  // Gap: errore su runGet (con runId)
  it('dovrebbe gestire OzCliError su runGet con runId', async () => {
    cli.runGet.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_FOUND, 'run not found'));

    await handler('run-xyz', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('non trovato');
  });

  it('dovrebbe gestire errore generico su runGet con runId', async () => {
    cli.runGet.mockRejectedValue(new Error('connection lost'));

    await handler('run-abc', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('connection lost');
  });

  // Gap: errore non-Error (stringa) → instanceof Error false branch (L51)
  it('dovrebbe gestire errore non-Error (stringa) nel catch (String() branch)', async () => {
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

  it('dovrebbe mostrare lista modelli con conteggio', async () => {
    cli.modelList.mockResolvedValue(makeListResult([{ id: 'gpt-4' }, { id: 'claude-3' }]));

    await handler('', mock.stream as any, createMockToken() as any);

    const output = mock.getFullOutput();
    expect(output).toContain('2 modelli');
    expect(output).toContain('gpt-4');
    expect(output).toContain('claude-3');
  });

  it('dovrebbe mostrare modello predefinito', async () => {
    cli.modelList.mockResolvedValue(makeListResult([{ id: 'gpt-4' }]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('auto');
  });

  it('dovrebbe mostrare messaggio se nessun modello trovato', async () => {
    cli.modelList.mockResolvedValue(makeListResult([]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Nessun modello');
  });

  it('dovrebbe gestire errore OzCliError', async () => {
    cli.modelList.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_FOUND, 'not found'));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('non trovato');
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
});

// ==========================================================================
// /mcp
// ==========================================================================
describe('/mcp command', () => {
  let handler: ReturnType<typeof createMcpCommand>;

  beforeEach(() => {
    handler = createMcpCommand(cli, createMockConfigManager());
  });

  it('dovrebbe mostrare lista server MCP con conteggio', async () => {
    cli.mcpList.mockResolvedValue(makeListResult([
      { uuid: 'u1', name: 'mcp-server-1' },
      { uuid: 'u2', name: 'mcp-server-2' },
    ]));

    await handler('', mock.stream as any, createMockToken() as any);

    const output = mock.getFullOutput();
    expect(output).toContain('2 server MCP');
    expect(output).toContain('mcp-server-1');
  });

  it('dovrebbe mostrare messaggio se nessun MCP trovato', async () => {
    cli.mcpList.mockResolvedValue(makeListResult([]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Nessun server MCP');
  });

  it('dovrebbe gestire errore generico', async () => {
    cli.mcpList.mockRejectedValue(new Error('fail'));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('fail');
  });

  // Gap: OzCliError in catch
  it('dovrebbe gestire OzCliError con formatError', async () => {
    cli.mcpList.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_AUTHENTICATED, 'forbidden'));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('autenticato');
  });

  // Gap: errore non-Error (stringa) → instanceof Error false branch (L41)
  it('dovrebbe gestire errore non-Error (stringa) nel catch (String() branch)', async () => {
    cli.mcpList.mockRejectedValue('raw mcp error');

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('raw mcp error');
  });
});
