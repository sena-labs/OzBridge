import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandRouter } from '../../src/commands/router.js';
import { createMockCli, createMockConfigManager, createMockContextCollector, createMockPoller, createMockStream, createMockToken } from '../helpers.js';

let router: CommandRouter;
let cli: ReturnType<typeof createMockCli>;

beforeEach(() => {
  vi.clearAllMocks();
  cli = createMockCli();
  router = new CommandRouter(
    cli,
    createMockContextCollector(),
    createMockConfigManager(),
    createMockPoller(),
  );
});

describe('CommandRouter', () => {
  describe('createHandler()', () => {
    it('creates a valid handler', () => {
      const handler = router.createHandler();
      expect(handler).toBeTypeOf('function');
    });

    it('delegates to the /run command by default (no command)', async () => {
      cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
      cli.agentRun.mockResolvedValue({
        runId: null, status: 'SUCCEEDED', output: 'ok', exitCode: 0, durationMs: 100, raw: null,
      });

      const handler = router.createHandler();
      const mock = createMockStream();
      const result = await handler(
        { command: undefined, prompt: 'hello' } as any,
        {} as any,
        mock.stream as any,
        createMockToken() as any,
      );

      expect(result!.metadata).toMatchObject({ command: 'run' });
      expect((result!.metadata as any).command).toBe('run');
    });

    it('delegates to /models when command = "models"', async () => {
      cli.modelList.mockResolvedValue({ items: [{ id: 'gpt-4' }] });

      const handler = router.createHandler();
      const mock = createMockStream();
      const result = await handler(
        { command: 'models', prompt: '' } as any,
        {} as any,
        mock.stream as any,
        createMockToken() as any,
      );

      expect((result!.metadata as any).command).toBe('models');
      expect(cli.modelList).toHaveBeenCalled();
    });

    it('shows help for an unknown command', async () => {
      const handler = router.createHandler();
      const mock = createMockStream();
      await handler(
        { command: 'nonexistent', prompt: '' } as any,
        {} as any,
        mock.stream as any,
        createMockToken() as any,
      );

      const output = mock.getFullOutput();
      expect(output).toContain('Unknown command');
      expect(output).toContain('/run');
      expect(output).toContain('/cloud');
      expect(output).toContain('/config');
    });

    it('injects metadata.command into the result', async () => {
      cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
      cli.agentRun.mockResolvedValue({
        runId: null, status: 'SUCCEEDED', output: '', exitCode: 0, durationMs: 0, raw: null,
      });

      const handler = router.createHandler();
      const mock = createMockStream();
      const result = await handler(
        { command: 'run', prompt: 'test' } as any,
        {} as any,
        mock.stream as any,
        createMockToken() as any,
      );

      expect(result!.metadata).toHaveProperty('command', 'run');
    });

    // Gap: direct routing for every registered command
    it.each([
      ['cloud', 'agentRunCloud'],
      ['status', 'runList'],
      ['history', 'runList'],
      ['schedule', 'scheduleList'],
      ['mcp', 'mcpList'],
    ] as const)('delegates to /%s', async (command, mockMethod) => {
      (cli as any)[mockMethod].mockResolvedValue({ items: [], rawText: undefined });
      // cloud needs checkAvailability
      cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
      cli.agentRunCloud.mockResolvedValue({
        runId: null, status: 'SUCCEEDED', output: '', exitCode: 0, durationMs: 0, raw: null,
      });

      const handler = router.createHandler();
      const mock = createMockStream();
      const result = await handler(
        { command, prompt: '' } as any,
        {} as any,
        mock.stream as any,
        createMockToken() as any,
      );

      expect((result!.metadata as any).command).toBe(command);
    });

    it('delegates to /config', async () => {
      cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
      cli.profileList.mockResolvedValue({ items: [], rawText: undefined });
      cli.environmentList.mockResolvedValue({ items: [], rawText: undefined });
      cli.integrationList.mockResolvedValue({ items: [], rawText: undefined });

      const handler = router.createHandler();
      const mock = createMockStream();
      const result = await handler(
        { command: 'config', prompt: '' } as any,
        {} as any,
        mock.stream as any,
        createMockToken() as any,
      );

      expect((result!.metadata as any).command).toBe('config');
    });

    it('delegates to /init', async () => {
      const handler = router.createHandler();
      const mock = createMockStream();
      const result = await handler(
        { command: 'init', prompt: '' } as any,
        {} as any,
        mock.stream as any,
        createMockToken() as any,
      );

      // init without workspace → error, but routing works
      expect(mock.getFullOutput()).toContain('No workspace open');
      // The comment above claims routing works, so assert it: the returned
      // result was captured but never checked, unlike the sibling /config
      // test. Without this the case only proved an error message is printed.
      expect((result!.metadata as any).command).toBe('init');
    });
  });
});
