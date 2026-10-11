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
    it('shows the schedule list', async () => {
      cli.scheduleList.mockResolvedValue(makeListResult([
        { id: 's1', name: 'daily', cron: '0 9 * * *', paused: false },
      ]));

      await handler('list', mock.stream as any, createMockToken() as any);

      expect(cli.scheduleList).toHaveBeenCalled();
      expect(mock.getFullOutput()).toContain('daily');
    });

    it('uses "list" as the default without a subcommand', async () => {
      cli.scheduleList.mockResolvedValue(makeListResult([]));

      await handler('', mock.stream as any, createMockToken() as any);

      expect(cli.scheduleList).toHaveBeenCalled();
      expect(mock.getFullOutput()).toContain('No schedules found');
    });
  });

  // --- create ---
  describe('create', () => {
    it('creates a schedule with double quotes', async () => {
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

    it('creates a schedule with single quotes', async () => {
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

    it('accepts opposite quotes nested in the prompt', async () => {
      cli.scheduleCreate.mockResolvedValue({
        id: 's-nest', name: 'tests', cron: '0 9 * * *', prompt: "Run 'test' suite", paused: false,
      });

      await handler(`create tests "0 9 * * *" "Run 'test' suite"`, mock.stream as any, createMockToken() as any);

      expect(cli.scheduleCreate).toHaveBeenCalledWith(expect.objectContaining({
        prompt: "Run 'test' suite",
      }));
    });

    it('accepts same-type quotes escaped with a backslash', async () => {
      cli.scheduleCreate.mockResolvedValue({
        id: 's-esc', name: 'esc', cron: '0 9 * * *', prompt: 'He said "hi"', paused: false,
      });

      await handler('create esc "0 9 * * *" "He said \\"hi\\""', mock.stream as any, createMockToken() as any);

      expect(cli.scheduleCreate).toHaveBeenCalledWith(expect.objectContaining({
        prompt: 'He said "hi"',
      }));
    });

    // Gap: create passes environment from the config
    it('passes environment to the CLI when configured', async () => {
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
    it('pauses a schedule by ID', async () => {
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
    it('reactivates a schedule', async () => {
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
    it('deletes a schedule', async () => {
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

  // --- get ---
  describe('get', () => {
    it('shows the schedule fields', async () => {
      cli.scheduleGet.mockResolvedValue({
        id: 's1', name: 'daily', cron: '0 9 * * *', prompt: 'lint', paused: false,
      });

      await handler('get s1', mock.stream as any, createMockToken() as any);

      expect(cli.scheduleGet).toHaveBeenCalledWith('s1');
      const out = mock.getFullOutput();
      expect(out).toContain('daily');
      expect(out).toContain('0 9 * * *');
      expect(out).toContain('running');
    });

    it('shows usage without an id', async () => {
      await handler('get', mock.stream as any, createMockToken() as any);
      expect(cli.scheduleGet).not.toHaveBeenCalled();
      expect(mock.getFullOutput()).toContain('Usage');
    });

    it('paused schedule shows paused', async () => {
      cli.scheduleGet.mockResolvedValue({
        id: 's1', name: 'd', cron: '* * * * *', prompt: 'p', paused: true,
      });
      await handler('get s1', mock.stream as any, createMockToken() as any);
      expect(mock.getFullOutput()).toContain('paused');
    });
  });

  // --- update ---
  describe('update', () => {
    it('sends only the specified --name', async () => {
      cli.scheduleUpdate.mockResolvedValue({
        id: 's1', name: 'new-name', cron: '0 9 * * *', prompt: 'p', paused: false,
      });

      await handler('update s1 --name "new-name"', mock.stream as any, createMockToken() as any);

      expect(cli.scheduleUpdate).toHaveBeenCalledWith({ id: 's1', name: 'new-name' });
      expect(mock.getFullOutput()).toContain('Schedule updated');
    });

    it('accepts multiple flags in any order', async () => {
      cli.scheduleUpdate.mockResolvedValue({
        id: 's1', name: 'n', cron: '*/5 * * * *', prompt: 'do x', paused: false,
      });

      await handler('update s1 --cron "*/5 * * * *" --prompt "do x" --name "n"', mock.stream as any, createMockToken() as any);

      expect(cli.scheduleUpdate).toHaveBeenCalledWith({
        id: 's1', name: 'n', cron: '*/5 * * * *', prompt: 'do x',
      });
    });

    it('shows usage without an id', async () => {
      await handler('update', mock.stream as any, createMockToken() as any);
      expect(cli.scheduleUpdate).not.toHaveBeenCalled();
      expect(mock.getFullOutput()).toContain('Usage');
    });

    it('does not call scheduleUpdate without any flag', async () => {
      await handler('update s1', mock.stream as any, createMockToken() as any);
      expect(cli.scheduleUpdate).not.toHaveBeenCalled();
      expect(mock.getFullOutput()).toContain('Nothing to update');
    });

    it('unknown flag shows usage', async () => {
      await handler('update s1 --bogus "x"', mock.stream as any, createMockToken() as any);
      expect(cli.scheduleUpdate).not.toHaveBeenCalled();
      expect(mock.getFullOutput()).toContain('Usage');
    });
  });

  // --- error handling ---
  it('should handle OzCliError', async () => {
    cli.scheduleList.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_AUTHENTICATED, 'login'));

    await handler('list', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Not authenticated');
  });

  it('handles a generic error', async () => {
    cli.scheduleList.mockRejectedValue(new Error('network'));

    await handler('list', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('network');
  });

  // Gap: error handling for the create/pause/unpause/delete sub-commands
  it('handles an error on scheduleCreate', async () => {
    cli.scheduleCreate.mockRejectedValue(new OzCliError(OzCliErrorKind.CLI_ERROR, 'invalid cron', 1));

    await handler('create job "invalid cron" "prompt"', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('CLI Error');
  });

  it('handles a generic error on scheduleCreate', async () => {
    cli.scheduleCreate.mockRejectedValue(new Error('timeout'));

    await handler('create job "0 9 * * *" "run lint"', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('timeout');
  });

  it('handles an error on schedulePause', async () => {
    cli.schedulePause.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_FOUND, 'schedule not found'));

    await handler('pause s-invalid', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('not found');
  });

  it('handles an error on scheduleUnpause', async () => {
    cli.scheduleUnpause.mockRejectedValue(new Error('service unavailable'));

    await handler('unpause s-down', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('service unavailable');
  });

  it('handles an error on scheduleDelete', async () => {
    cli.scheduleDelete.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_AUTHENTICATED, 'forbidden'));

    await handler('delete s-perm', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Not authenticated');
  });

  // Gap: non-Error (string) error in the catch → instanceof Error false branch (L122)
  it('handles a non-Error (string) error in the catch (String() branch)', async () => {
    cli.scheduleList.mockRejectedValue('string thrown schedule error');

    await handler('list', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('string thrown schedule error');
  });
});
