/**
 * High-density tests for CommandRouter — dispatch, unknown command,
 * results with metadata, factory wiring.
 */
import { describe, it, expect, beforeEach } from 'vitest';
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

// Helper to invoke the handler with a given command name
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
  it('registers the 9 expected slash commands', async () => {
    const expectedCommands = ['run', 'cloud', 'status', 'history', 'schedule', 'models', 'mcp', 'config', 'init'];
    for (const cmd of expectedCommands) {
      // Dispatch without error — the command is registered
      const result = await dispatch(cmd);
      expect(result).toEqual(expect.objectContaining({ metadata: expect.any(Object) }));
      expect(typeof result).toBe('object');
    }
  });

  it('/run invokes agentRun', async () => {
    cli.agentRun.mockResolvedValue({ runId: 'r1', status: 'SUCCEEDED', output: 'ok', exitCode: 0, durationMs: 100, raw: null });
    const result = await dispatch('run');
    expect(cli.agentRun).toHaveBeenCalled();
    expect(result.metadata?.command).toBe('run');
  });

  it('/models invokes modelList', async () => {
    cli.modelList.mockResolvedValue({ items: [], rawText: 'no models' });
    const result = await dispatch('models');
    expect(cli.modelList).toHaveBeenCalled();
    expect(result.metadata?.command).toBe('models');
  });

  it('/mcp invokes mcpList', async () => {
    cli.mcpList.mockResolvedValue({ items: [], rawText: 'no servers' });
    const result = await dispatch('mcp');
    expect(cli.mcpList).toHaveBeenCalled();
    expect(result.metadata?.command).toBe('mcp');
  });

  it('default (no command) uses /run', async () => {
    cli.agentRun.mockResolvedValue({ runId: 'r2', status: 'SUCCEEDED', output: 'ok', exitCode: 0, durationMs: 100, raw: null });
    const result = await dispatch(undefined);
    expect(cli.agentRun).toHaveBeenCalled();
    expect(result.metadata?.command).toBe('run');
  });
});

// ============================================================================
// Unknown command
// ============================================================================
describe('CommandRouter — unknown command', () => {
  it('shows a markdown error message', async () => {
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

  it('contains the ❓ emoji in the message', async () => {
    await dispatch('unknown');
    expect(mock.getFullOutput()).toContain('❓');
  });
});

// ============================================================================
// Metadata propagation
// ============================================================================
describe('CommandRouter — metadata', () => {
  it('/status has metadata.command = "status"', async () => {
    cli.runList.mockResolvedValue({ items: [], rawText: '' });
    const result = await dispatch('status');
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.command).toBe('status');
  });

  it('/config has metadata.command = "config"', async () => {
    const result = await dispatch('config', 'show');
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.command).toBe('config');
  });

  it('/init has metadata.command = "init"', async () => {
    const result = await dispatch('init', '');
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.command).toBe('init');
  });

  it('/schedule has metadata.command = "schedule"', async () => {
    cli.scheduleList.mockResolvedValue({ items: [], rawText: '' });
    const result = await dispatch('schedule', 'list');
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.command).toBe('schedule');
  });
});

// ============================================================================
// createHandler returns a valid handler
// ============================================================================
describe('CommandRouter — createHandler()', () => {
  it('returns a function', () => {
    const handler = router.createHandler();
    expect(typeof handler).toBe('function');
  });

  it('handler can be re-invoked multiple times', async () => {
    cli.agentRun.mockResolvedValue({ runId: 'r', status: 'SUCCEEDED', output: '', exitCode: 0, durationMs: 0, raw: null });
    const handler = router.createHandler();
    const r1 = await handler({ command: 'run', prompt: 'a' } as any, {} as any, mock.stream as any, token as any);
    expect(r1).toBeDefined();
    const r2 = await handler({ command: 'run', prompt: 'b' } as any, {} as any, mock.stream as any, token as any);
    expect(r2).toBeDefined();
    expect(cli.agentRun).toHaveBeenCalledTimes(2);
  });
});
