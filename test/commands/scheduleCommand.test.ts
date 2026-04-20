import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createScheduleCommand } from '../../src/commands/scheduleCommand.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';
import {
  createMockCli,
  createMockConfigManager,
  createMockStream,
  createMockToken,
  makeListResult,
} from '../helpers.js';

let cli: ReturnType<typeof createMockCli>;
let handler: ReturnType<typeof createScheduleCommand>;
let mock: ReturnType<typeof createMockStream>;

beforeEach(() => {
  vi.clearAllMocks();
  cli = createMockCli();
  handler = createScheduleCommand(cli, createMockConfigManager());
  mock = createMockStream();
});

describe('/schedule command', () => {
  // --- list ---
  describe('list', () => {
    it('dovrebbe mostrare lista schedule', async () => {
      cli.scheduleList.mockResolvedValue(makeListResult([
        { id: 's1', name: 'daily', cron: '0 9 * * *', paused: false },
      ]));

      await handler('list', mock.stream as any, createMockToken() as any);

      expect(cli.scheduleList).toHaveBeenCalled();
      expect(mock.getFullOutput()).toContain('daily');
    });

    it('dovrebbe usare "list" come default senza subcommand', async () => {
      cli.scheduleList.mockResolvedValue(makeListResult([]));

      await handler('', mock.stream as any, createMockToken() as any);

      expect(cli.scheduleList).toHaveBeenCalled();
      expect(mock.getFullOutput()).toContain('No schedules found');
    });
  });

  // --- create ---
  describe('create', () => {
    it('dovrebbe creare schedule con doppi apici', async () => {
      cli.scheduleCreate.mockResolvedValue({
        id: 's-new', name: 'lint', cron: '0 9 * * *', prompt: 'Run linting', paused: false,
      });

      await handler('create lint "0 9 * * *" "Run linting"', mock.stream as any, createMockToken() as any);

      expect(cli.scheduleCreate).toHaveBeenCalledWith(expect.objectContaining({
        name: 'lint',
        cron: '0 9 * * *',
        prompt: 'Run linting',
      }));
      expect(mock.getFullOutput()).toContain('Schedule created');
    });

    it('dovrebbe creare schedule con apici singoli', async () => {
      cli.scheduleCreate.mockResolvedValue({
        id: 's-new', name: 'test', cron: '*/5 * * * *', prompt: 'Run tests', paused: false,
      });

      await handler("create test '*/5 * * * *' 'Run tests'", mock.stream as any, createMockToken() as any);

      expect(cli.scheduleCreate).toHaveBeenCalled();
    });

    it('should show usage when format is invalid', async () => {
      await handler('create', mock.stream as any, createMockToken() as any);

      expect(cli.scheduleCreate).not.toHaveBeenCalled();
      expect(mock.getFullOutput()).toContain('Usage');
    });

    it('should show usage when quotes are missing', async () => {
      await handler('create name 0 9 * * * Run linting', mock.stream as any, createMockToken() as any);

      expect(cli.scheduleCreate).not.toHaveBeenCalled();
      expect(mock.getFullOutput()).toContain('Usage');
    });

    // Gap: create passa environment dalla config
    it('dovrebbe passare environment alla CLI se configurato', async () => {
      handler = createScheduleCommand(
        cli,
        createMockConfigManager({ defaultEnvironment: 'staging' }),
      );
      cli.scheduleCreate.mockResolvedValue({
        id: 's-env', name: 'envjob', cron: '0 9 * * *', prompt: 'run', paused: false,
      });

      await handler('create envjob "0 9 * * *" "run"', mock.stream as any, createMockToken() as any);

      expect(cli.scheduleCreate).toHaveBeenCalledWith(
        expect.objectContaining({ environment: 'staging' }),
      );
    });
  });

  // --- pause ---
  describe('pause', () => {
    it('dovrebbe pausare schedule con ID', async () => {
      cli.schedulePause.mockResolvedValue(undefined);

      await handler('pause s-123', mock.stream as any, createMockToken() as any);

      expect(cli.schedulePause).toHaveBeenCalledWith('s-123');
      expect(mock.getFullOutput()).toContain('paused');
    });

    it('should show usage when ID is missing', async () => {
      await handler('pause', mock.stream as any, createMockToken() as any);

      expect(cli.schedulePause).not.toHaveBeenCalled();
      expect(mock.getFullOutput()).toContain('Usage');
    });
  });

  // --- unpause ---
  describe('unpause', () => {
    it('dovrebbe riattivare schedule', async () => {
      cli.scheduleUnpause.mockResolvedValue(undefined);

      await handler('unpause s-456', mock.stream as any, createMockToken() as any);

      expect(cli.scheduleUnpause).toHaveBeenCalledWith('s-456');
      expect(mock.getFullOutput()).toContain('resumed');
    });

    it('should show usage when ID is missing', async () => {
      await handler('unpause', mock.stream as any, createMockToken() as any);

      expect(mock.getFullOutput()).toContain('Usage');
    });
  });

  // --- delete ---
  describe('delete', () => {
    it('dovrebbe eliminare schedule', async () => {
      cli.scheduleDelete.mockResolvedValue(undefined);

      await handler('delete s-789', mock.stream as any, createMockToken() as any);

      expect(cli.scheduleDelete).toHaveBeenCalledWith('s-789');
      expect(mock.getFullOutput()).toContain('deleted');
    });

    it('should show usage when ID is missing', async () => {
      await handler('delete', mock.stream as any, createMockToken() as any);

      expect(mock.getFullOutput()).toContain('Usage');
    });
  });

  // --- unknown subcommand ---
  it('should show help for unknown subcommand', async () => {
    await handler('foobar', mock.stream as any, createMockToken() as any);

    const output = mock.getFullOutput();
    expect(output).toContain('Available commands');
    expect(output).toContain('/schedule list');
    expect(output).toContain('/schedule create');
  });

  // --- error handling ---
  it('should handle OzCliError', async () => {
    cli.scheduleList.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_AUTHENTICATED, 'login'));

    await handler('list', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Not authenticated');
  });

  it('dovrebbe gestire errore generico', async () => {
    cli.scheduleList.mockRejectedValue(new Error('network'));

    await handler('list', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('network');
  });

  // Gap: error handling per sub-command create/pause/unpause/delete
  it('dovrebbe gestire errore su scheduleCreate', async () => {
    cli.scheduleCreate.mockRejectedValue(new OzCliError(OzCliErrorKind.CLI_ERROR, 'invalid cron', 1));

    await handler('create job "invalid cron" "prompt"', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('CLI Error');
  });

  it('dovrebbe gestire errore generico su scheduleCreate', async () => {
    cli.scheduleCreate.mockRejectedValue(new Error('timeout'));

    await handler('create job "0 9 * * *" "run lint"', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('timeout');
  });

  it('dovrebbe gestire errore su schedulePause', async () => {
    cli.schedulePause.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_FOUND, 'schedule not found'));

    await handler('pause s-invalid', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('not found');
  });

  it('dovrebbe gestire errore su scheduleUnpause', async () => {
    cli.scheduleUnpause.mockRejectedValue(new Error('service unavailable'));

    await handler('unpause s-down', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('service unavailable');
  });

  it('dovrebbe gestire errore su scheduleDelete', async () => {
    cli.scheduleDelete.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_AUTHENTICATED, 'forbidden'));

    await handler('delete s-perm', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Not authenticated');
  });

  // Gap: errore non-Error (stringa) nel catch → instanceof Error false branch (L122)
  it('dovrebbe gestire errore non-Error (stringa) nel catch (String() branch)', async () => {
    cli.scheduleList.mockRejectedValue('string thrown schedule error');

    await handler('list', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('string thrown schedule error');
  });
});
