import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CommandRouter } from '../../src/commands/router.js';
import { createMockCli, createMockConfigManager, createMockContextCollector, createMockPoller, createMockStream, createMockToken } from '../helpers.js';
import { initI18n, _resetI18n } from '../../src/core/i18n.js';

let router: CommandRouter;
let cli: ReturnType<typeof createMockCli>;

beforeEach(() => {
  vi.clearAllMocks();
  initI18n('it');
  cli = createMockCli();
  router = new CommandRouter(
    cli,
    createMockContextCollector(),
    createMockConfigManager(),
    createMockPoller(),
  );
});

afterEach(() => {
  _resetI18n();
});

describe('CommandRouter', () => {
  describe('createHandler()', () => {
    it('dovrebbe creare un handler valido', () => {
      const handler = router.createHandler();
      expect(handler).toBeTypeOf('function');
    });

    it('dovrebbe delegare al comando /run per default (nessun command)', async () => {
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

      expect(result!.metadata).toBeDefined();
      expect((result!.metadata as any).command).toBe('run');
    });

    it('dovrebbe delegare a /models quando command = "models"', async () => {
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

    it('dovrebbe mostrare help per comando sconosciuto', async () => {
      const handler = router.createHandler();
      const mock = createMockStream();
      await handler(
        { command: 'nonexistent', prompt: '' } as any,
        {} as any,
        mock.stream as any,
        createMockToken() as any,
      );

      const output = mock.getFullOutput();
      expect(output).toContain('non riconosciuto');
      expect(output).toContain('/run');
      expect(output).toContain('/cloud');
      expect(output).toContain('/config');
    });

    it('dovrebbe iniettare metadata.command nel risultato', async () => {
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

    // Gap: routing diretto per ogni comando registrato
    it.each([
      ['cloud', 'agentRunCloud'],
      ['status', 'runList'],
      ['schedule', 'scheduleList'],
      ['mcp', 'mcpList'],
    ] as const)('dovrebbe delegare a /%s', async (command, mockMethod) => {
      (cli as any)[mockMethod].mockResolvedValue({ items: [], rawText: undefined });
      // cloud ha bisogno di checkAvailability
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

    it('dovrebbe delegare a /config', async () => {
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

    it('dovrebbe delegare a /init', async () => {
      const handler = router.createHandler();
      const mock = createMockStream();
      const result = await handler(
        { command: 'init', prompt: '' } as any,
        {} as any,
        mock.stream as any,
        createMockToken() as any,
      );

      // init senza workspace → errore, ma routing funziona
      expect(mock.getFullOutput()).toContain('Nessun workspace');
    });
  });
});
