import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRunCommand } from '../../src/commands/runCommand.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';
import {
  createMockCli,
  createMockConfigManager,
  createMockContextCollector,
  createMockStream,
  createMockToken,
  makeRunResult,
} from '../helpers.js';

let cli: ReturnType<typeof createMockCli>;
let handler: ReturnType<typeof createRunCommand>;
let mock: ReturnType<typeof createMockStream>;

beforeEach(() => {
  vi.clearAllMocks();
  cli = createMockCli();
  const ctx = createMockContextCollector();
  handler = createRunCommand(cli, ctx, createMockConfigManager());
  mock = createMockStream();
});

describe('/run command', () => {
  it('shows an error when the CLI is not available', async () => {
    cli.checkAvailability.mockResolvedValue({ available: false, version: null, path: null });

    await handler('test prompt', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('not found');
    expect(cli.agentRun).not.toHaveBeenCalled();
  });

  it('runs agentRun with prompt and context', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    await handler('fix this bug', mock.stream as any, createMockToken() as any);

    expect(cli.agentRun).toHaveBeenCalledTimes(1);
    const callArgs = cli.agentRun.mock.calls[0][0];
    // The prompt must contain the injected context
    expect(callArgs.prompt).toContain('[CONTEXT]');
    expect(callArgs.prompt).toContain('fix this bug');
  });

  it('shows progress before execution', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    await handler('prompt', mock.stream as any, createMockToken() as any);

    expect(mock.progresses.length).toBeGreaterThanOrEqual(1);
  });

  it('detects the "spec" skill in the prompt', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    await handler('generate the spec for the auth module', mock.stream as any, createMockToken() as any);

    const callArgs = cli.agentRun.mock.calls[0][0];
    expect(callArgs.skill).toBe('1-spec-agent');
  });

  it('detects the "test" skill in the prompt', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    await handler('write test for login', mock.stream as any, createMockToken() as any);

    const callArgs = cli.agentRun.mock.calls[0][0];
    expect(callArgs.skill).toBe('5-test-agent');
  });

  it('uses word boundaries for skill detection (no false positives)', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    // "contest" contains "test" but should not match with a word boundary
    await handler('run a contest', mock.stream as any, createMockToken() as any);

    const callArgs = cli.agentRun.mock.calls[0][0];
    expect(callArgs.skill).toBeUndefined();
  });

  // P3 fix: case-insensitive skill detection with split(/\W+/)
  it('detects skills case-insensitively (P3)', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    // Uppercase "SPEC" must match the "spec" key
    await handler('generate the SPEC for the module', mock.stream as any, createMockToken() as any);

    const callArgs = cli.agentRun.mock.calls[0][0];
    expect(callArgs.skill).toBe('1-spec-agent');
  });

  it('detects skills with adjacent punctuation (P3)', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    // "test," → split on \W+ produces ["test", ""] → must match
    await handler('write test, please', mock.stream as any, createMockToken() as any);

    const callArgs = cli.agentRun.mock.calls[0][0];
    expect(callArgs.skill).toBe('5-test-agent');
  });

  it('does not pass model when defaultModel is "auto"', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    await handler('hello', mock.stream as any, createMockToken() as any);

    const callArgs = cli.agentRun.mock.calls[0][0];
    expect(callArgs.model).toBeUndefined();
  });

  it('passes model when defaultModel is not "auto"', async () => {
    cli = createMockCli();
    handler = createRunCommand(
      cli,
      createMockContextCollector(),
      createMockConfigManager({ defaultModel: 'gpt-4' }),
    );
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    await handler('hello', mock.stream as any, createMockToken() as any);

    expect(cli.agentRun.mock.calls[0][0].model).toBe('gpt-4');
  });

  it('handles OzCliError in the catch', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockRejectedValue(new OzCliError(OzCliErrorKind.TIMEOUT, 'timeout'));

    await handler('hello', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Timeout');
  });

  it('handles a generic error in the catch', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockRejectedValue(new Error('unexpected'));

    await handler('hello', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Error');
    expect(mock.getFullOutput()).toContain('unexpected');
  });

  // Gap: non-Default profile → should pass profile to agentRun (L59)
  it('passes profile when defaultProfile is not "Default"', async () => {
    cli = createMockCli();
    handler = createRunCommand(
      cli,
      createMockContextCollector(),
      createMockConfigManager({ defaultProfile: 'CustomProfile' }),
    );
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    await handler('hello', mock.stream as any, createMockToken() as any);

    expect(cli.agentRun.mock.calls[0][0].profile).toBe('CustomProfile');
  });

  // Gap: empty workspacePath → cwd undefined (L61)
  it('passes cwd=undefined when workspacePath is empty', async () => {
    cli = createMockCli();
    handler = createRunCommand(
      cli,
      createMockContextCollector({ workspacePath: '' }),
      createMockConfigManager(),
    );
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    await handler('hello', mock.stream as any, createMockToken() as any);

    expect(cli.agentRun.mock.calls[0][0].cwd).toBeUndefined();
  });

  // Gap: non-Error (string) error → instanceof Error false branch (L70)
  it('handles a non-Error (string) error in the catch (String() branch)', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockRejectedValue('string thrown error');

    await handler('hello', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('string thrown error');
  });
});
