import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createConfigCommand } from '../../src/commands/ozConfigCommand.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';
import {
  createMockCli,
  createMockConfigManager,
  createMockStream,
  createMockToken,
  makeListResult,
} from '../helpers.js';

let cli: ReturnType<typeof createMockCli>;
let handler: ReturnType<typeof createConfigCommand>;
let mock: ReturnType<typeof createMockStream>;

beforeEach(() => {
  vi.clearAllMocks();
  cli = createMockCli();
  handler = createConfigCommand(cli, createMockConfigManager());
  mock = createMockStream();
});

describe('/config command', () => {
  it('should show "Configuration" header', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.profileList.mockResolvedValue(makeListResult([]));
    cli.environmentList.mockResolvedValue(makeListResult([]));
    cli.integrationList.mockResolvedValue(makeListResult([]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Configuration');
  });

  it('shows all settings parameters', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.profileList.mockResolvedValue(makeListResult([]));
    cli.environmentList.mockResolvedValue(makeListResult([]));
    cli.integrationList.mockResolvedValue(makeListResult([]));

    await handler('', mock.stream as any, createMockToken() as any);

    const output = mock.getFullOutput();
    expect(output).toContain('Oz Path');
    expect(output).toContain('Default Model');
    expect(output).toContain('Local timeout');
  });

  it('shows the CLI status as available with the version', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '2.0.1', path: 'oz' });
    cli.profileList.mockResolvedValue(makeListResult([]));
    cli.environmentList.mockResolvedValue(makeListResult([]));
    cli.integrationList.mockResolvedValue(makeListResult([]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Available');
    expect(mock.getFullOutput()).toContain('2.0.1');
  });

  it('shows the CLI status as unavailable with an install button', async () => {
    cli.checkAvailability.mockResolvedValue({ available: false, version: null, path: null });

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Not available');
    expect(mock.buttons.some(b => b.title.includes('Install'))).toBe(true);
  });

  it('shows profiles when available', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.profileList.mockResolvedValue(makeListResult([
      { id: 'p1', name: 'Default' },
      { id: 'p2', name: 'Custom' },
    ]));
    cli.environmentList.mockResolvedValue(makeListResult([]));
    cli.integrationList.mockResolvedValue(makeListResult([]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Default');
    expect(mock.getFullOutput()).toContain('Custom');
  });

  it('shows integrations with a connected/disconnected indicator', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.profileList.mockResolvedValue(makeListResult([]));
    cli.environmentList.mockResolvedValue(makeListResult([]));
    cli.integrationList.mockResolvedValue(makeListResult([
      { provider: 'GitHub', status: 'Connected' },
      { provider: 'GitLab', status: 'Not Connected' },
    ]));

    await handler('', mock.stream as any, createMockToken() as any);

    const output = mock.getFullOutput();
    expect(output).toContain('🟢');
    expect(output).toContain('🔴');
    expect(output).toContain('GitHub');
    expect(output).toContain('GitLab');
  });

  it('uses console.warn when profileList fails (does not block the command)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.profileList.mockRejectedValue(new Error('network'));
    cli.environmentList.mockResolvedValue(makeListResult([]));
    cli.integrationList.mockResolvedValue(makeListResult([]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to list profiles'),
      expect.anything(),
    );
    // The command should not fail
    expect(mock.getFullOutput()).toContain('Configuration');
    warnSpy.mockRestore();
  });

  // P2 fix: non-OzCliError in main catch
  it('should handle non-OzCliError with logError and user message (P2)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // checkAvailability throws a generic error (not OzCliError)
    cli.checkAvailability.mockRejectedValue(new TypeError('Cannot read properties of undefined'));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Config command error'),
    );
    expect(mock.getFullOutput()).toContain('Error');
    expect(mock.getFullOutput()).toContain('Cannot read properties of undefined');
    errorSpy.mockRestore();
  });

  it('should handle OzCliError in main catch with formatError (P2)', async () => {
    cli.checkAvailability.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_AUTHENTICATED, 'not logged'));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Not authenticated');
  });

  // Gap: environmentList failure should log a warning without blocking the command
  it('uses console.warn when environmentList fails (does not block the command)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.profileList.mockResolvedValue(makeListResult([]));
    cli.environmentList.mockRejectedValue(new Error('env network error'));
    cli.integrationList.mockResolvedValue(makeListResult([]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to list environments'),
      expect.anything(),
    );
    expect(mock.getFullOutput()).toContain('Configuration');
    warnSpy.mockRestore();
  });

  // Gap: integrationList failure should log warning without blocking
  it('uses console.warn when integrationList fails (does not block the command)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.profileList.mockResolvedValue(makeListResult([]));
    cli.environmentList.mockResolvedValue(makeListResult([]));
    cli.integrationList.mockRejectedValue(new Error('integration timeout'));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to list integrations'),
      expect.anything(),
    );
    expect(mock.getFullOutput()).toContain('Configuration');
    warnSpy.mockRestore();
  });

  // Gap: display environmentList with items
  it('shows environments when available', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.profileList.mockResolvedValue(makeListResult([]));
    cli.environmentList.mockResolvedValue(makeListResult([
      { id: 'env-1', name: 'staging', scope: 'team', base_image: { docker_image: 'ubuntu:22' }, github_repos: [], setup_commands: [], creator_email: 'a@b.com', last_edited: '2025-01-01' },
      { id: 'env-2', name: 'production', scope: 'org', base_image: { docker_image: 'node:20' }, github_repos: [], setup_commands: [], creator_email: 'a@b.com', last_edited: '2025-01-01' },
    ]));
    cli.integrationList.mockResolvedValue(makeListResult([]));

    await handler('', mock.stream as any, createMockToken() as any);

    const output = mock.getFullOutput();
    expect(output).toContain('Environments');
    expect(output).toContain('staging');
    expect(output).toContain('production');
    expect(output).toContain('team');
  });

  // Gap: null version → shows 'unknown' (branch ?? 'unknown')
  it('shows "unknown" when the version is null', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: null, path: 'oz' });
    cli.profileList.mockResolvedValue(makeListResult([]));
    cli.environmentList.mockResolvedValue(makeListResult([]));
    cli.integrationList.mockResolvedValue(makeListResult([]));

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('unknown');
  });

  // Gap: non-Error (string) error in the catch → instanceof Error false branch
  it('handles a non-Error (string) error in the catch (String() branch)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    cli.checkAvailability.mockRejectedValue('string thrown');

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('string thrown');
    errorSpy.mockRestore();
  });
});
