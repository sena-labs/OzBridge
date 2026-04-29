/**
 * Test ad alta densità per CommandRouter — dispatch, unknown command,
 * risultati con metadata, factory wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandRouter } from '../../src/commands/router.js';
import {
  createMockCli,
  createMockContextCollector,
  createMockConfigManager,
  createMockPoller,
  createMockStream,
  createMockToken,
} from '../helpers.js';

let router: CommandRouter;
let cli: ReturnType<typeof createMockCli>;
let ctx: ReturnType<typeof createMockContextCollector>;
let cfgMgr: ReturnType<typeof createMockConfigManager>;
let poller: ReturnType<typeof createMockPoller>;
let mock: ReturnType<typeof createMockStream>;
let token: ReturnType<typeof createMockToken>;

beforeEach(() => {
  cli = createMockCli();
  // Most command handlers call checkAvailability first
  cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0.0' });
  cli.profileList.mockResolvedValue({ items: [], rawText: '' });
  cli.environmentList.mockResolvedValue({ items: [], rawText: '' });
  cli.integrationList.mockResolvedValue({ items: [], rawText: '' });
  ctx = createMockContextCollector();
  cfgMgr = createMockConfigManager();
  poller = createMockPoller();
  router = new CommandRouter(cli, ctx, cfgMgr, poller);
  mock = createMockStream();
  token = createMockToken();
});

// Helper per invocare l'handler con un certo command name
async function dispatch(command: string | undefined, prompt = 'test prompt') {
  const handler = router.createHandler();
  return (await handler(
    { command, prompt } as any,
    {} as any,
    mock.stream as any,
    token as any,
  ))!;
}

// ============================================================================
// Routing dispatch table
// ============================================================================
describe('CommandRouter — dispatch', () => {
  it('dovrebbe registrare i 9 comandi slash attesi', async () => {
    const expectedCommands = ['run', 'cloud', 'status', 'history', 'schedule', 'models', 'mcp', 'config', 'init'];
    for (const cmd of expectedCommands) {
      // Dispatch senza errore — il comando è registrato
      const result = await dispatch(cmd);
      expect(result).toEqual(expect.objectContaining({ metadata: expect.any(Object) }));
      expect(typeof result).toBe('object');
    }
  });

  it('/run dovrebbe invocare agentRun', async () => {
    cli.agentRun.mockResolvedValue({ runId: 'r1', status: 'SUCCEEDED', output: 'ok', exitCode: 0, durationMs: 100, raw: null });
    const result = await dispatch('run');
    expect(cli.agentRun).toHaveBeenCalled();
    expect(result.metadata?.command).toBe('run');
  });

  it('/models dovrebbe invocare modelList', async () => {
    cli.modelList.mockResolvedValue({ items: [], rawText: 'no models' });
    const result = await dispatch('models');
    expect(cli.modelList).toHaveBeenCalled();
    expect(result.metadata?.command).toBe('models');
  });

  it('/mcp dovrebbe invocare mcpList', async () => {
    cli.mcpList.mockResolvedValue({ items: [], rawText: 'no servers' });
    const result = await dispatch('mcp');
    expect(cli.mcpList).toHaveBeenCalled();
    expect(result.metadata?.command).toBe('mcp');
  });

  it('default (nessun command) dovrebbe usare /run', async () => {
    cli.agentRun.mockResolvedValue({ runId: 'r2', status: 'SUCCEEDED', output: 'ok', exitCode: 0, durationMs: 100, raw: null });
    const result = await dispatch(undefined);
    expect(cli.agentRun).toHaveBeenCalled();
    expect(result.metadata?.command).toBe('run');
  });
});

// ============================================================================
// Comando sconosciuto
// ============================================================================
describe('CommandRouter — comando sconosciuto', () => {
  it('dovrebbe mostrare messaggio di errore markdown', async () => {
    const result = await dispatch('nonexistent');
    const output = mock.getFullOutput();
    expect(output).toContain('nonexistent');
    expect(output).toContain('/run');
    expect(output).toContain('/cloud');
    expect(output).toContain('/status');
    expect(output).toContain('/schedule');
    expect(output).toContain('/models');
    expect(output).toContain('/mcp');
    expect(output).toContain('/config');
    expect(output).toContain('/init');
    expect(result).toEqual({});
  });

  it('dovrebbe contenere emoji ❓ nel messaggio', async () => {
    await dispatch('unknown');
    expect(mock.getFullOutput()).toContain('❓');
  });
});

// ============================================================================
// Metadata propagation
// ============================================================================
describe('CommandRouter — metadata', () => {
  it('/status dovrebbe avere metadata.command = "status"', async () => {
    cli.runList.mockResolvedValue({ items: [], rawText: '' });
    const result = await dispatch('status');
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.command).toBe('status');
  });

  it('/config dovrebbe avere metadata.command = "config"', async () => {
    const result = await dispatch('config', 'show');
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.command).toBe('config');
  });

  it('/init dovrebbe avere metadata.command = "init"', async () => {
    const result = await dispatch('init', '');
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.command).toBe('init');
  });

  it('/schedule dovrebbe avere metadata.command = "schedule"', async () => {
    cli.scheduleList.mockResolvedValue({ items: [], rawText: '' });
    const result = await dispatch('schedule', 'list');
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.command).toBe('schedule');
  });
});

// ============================================================================
// createHandler ritorna handler valido
// ============================================================================
describe('CommandRouter — createHandler()', () => {
  it('dovrebbe ritornare una funzione', () => {
    const handler = router.createHandler();
    expect(typeof handler).toBe('function');
  });

  it('handler è re-invocabile più volte', async () => {
    cli.agentRun.mockResolvedValue({ runId: 'r', status: 'SUCCEEDED', output: '', exitCode: 0, durationMs: 0, raw: null });
    const handler = router.createHandler();
    const r1 = await handler({ command: 'run', prompt: 'a' } as any, {} as any, mock.stream as any, token as any);
    expect(r1).toBeDefined();
    const r2 = await handler({ command: 'run', prompt: 'b' } as any, {} as any, mock.stream as any, token as any);
    expect(r2).toBeDefined();
    expect(cli.agentRun).toHaveBeenCalledTimes(2);
  });
});
