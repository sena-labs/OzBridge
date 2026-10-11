import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCloudCommand } from '../../src/commands/cloudCommand.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';
import {
  createMockCli,
  createMockConfigManager,
  createMockContextCollector,
  createMockPoller,
  createMockStream,
  createMockToken,
  makeRunResult,
  makeListResult,
} from '../helpers.js';

let cli: ReturnType<typeof createMockCli>;
let pollerMock: ReturnType<typeof createMockPoller>;
let handler: ReturnType<typeof createCloudCommand>;
let mock: ReturnType<typeof createMockStream>;

beforeEach(() => {
  vi.clearAllMocks();
  cli = createMockCli();
  pollerMock = createMockPoller();
  handler = createCloudCommand(cli, createMockConfigManager(), pollerMock, createMockContextCollector());
  mock = createMockStream();
});

describe('/cloud command', () => {
  it('shows an error when the CLI is not available', async () => {
    cli.checkAvailability.mockResolvedValue({ available: false, version: null, path: null });

    await handler('deploy app', mock.stream as any, createMockToken() as any);

    // Positive sibling: assert the install/help message is rendered, not just
    // that agentRunCloud was skipped (refactor-resistance, see audit T-L2).
    expect(mock.getFullOutput()).toContain('not found');
    expect(mock.getFullOutput().toLowerCase()).toMatch(/install|warp/);
    expect(cli.checkAvailability).toHaveBeenCalledTimes(1);
    expect(cli.agentRunCloud).not.toHaveBeenCalled();
  });

  it('shows a credits warning before launching', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: null }));

    await handler('deploy', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('credits');
  });

  it('injects IDE context into the prompt', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: null }));

    await handler('deploy', mock.stream as any, createMockToken() as any);

    const callArgs = cli.agentRunCloud.mock.calls[0][0];
    expect(callArgs.prompt).toContain('[CONTEXT]');
    expect(callArgs.prompt).toContain('deploy');
  });

  it('starts polling when runId is present', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'cloud-run-1', status: 'QUEUED' }));
    (pollerMock.poll as any).mockResolvedValue(makeRunResult({ runId: 'cloud-run-1', status: 'SUCCEEDED' }));

    await handler('do something', mock.stream as any, createMockToken() as any);

    expect(pollerMock.poll).toHaveBeenCalledWith('cloud-run-1', expect.any(Function), expect.anything());
    expect(mock.getFullOutput()).toContain('cloud-run-1');
    expect(mock.getFullOutput()).toContain('SUCCEEDED');
  });

  // Gap: the poller.poll() progress callback should be invoked
  it('invokes stream.progress through the polling callback', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-prog', status: 'QUEUED' }));
    (pollerMock.poll as any).mockImplementation(
      async (_id: string, onProgress: (status: string) => void, _token: unknown) => {
        onProgress('INPROGRESS');
        onProgress('FINALIZING');
        return makeRunResult({ runId: 'run-prog', status: 'SUCCEEDED' });
      },
    );

    await handler('deploy', mock.stream as any, createMockToken() as any);

    expect(mock.progresses).toContain('Status: INPROGRESS...');
    expect(mock.progresses).toContain('Status: FINALIZING...');
  });

  it('shows the result directly when runId is missing', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: null, output: 'direct result' }));

    await handler('quick run', mock.stream as any, createMockToken() as any);

    expect(pollerMock.poll).not.toHaveBeenCalled();
    expect(mock.getFullOutput()).toContain('direct result');
  });

  it('handles a polling error', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-err' }));
    (pollerMock.poll as any).mockRejectedValue(new OzCliError(OzCliErrorKind.TIMEOUT, 'timeout'));

    await handler('prompt', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Timeout');
  });

  it('handles OzCliError on agentRunCloud', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_AUTHENTICATED, 'not logged'));

    await handler('prompt', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Not authenticated');
  });

  it('handles a generic error on agentRunCloud', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockRejectedValue(new Error('network error'));

    await handler('prompt', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('network error');
  });

  it('handles a generic error (non-OzCliError) during polling', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-poll-err' }));
    (pollerMock.poll as any).mockRejectedValue(new Error('network disconnected'));

    await handler('prompt', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Polling error');
    expect(mock.getFullOutput()).toContain('network disconnected');
  });

  it('calls showInformationMessage after polling ends in SUCCEEDED', async () => {
    const { window } = await import('../mocks/vscode.js');
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-notify', status: 'QUEUED' }));
    (pollerMock.poll as any).mockResolvedValue(makeRunResult({ runId: 'run-notify', status: 'SUCCEEDED' }));

    await handler('prompt', mock.stream as any, createMockToken() as any);

    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('completed successfully'),
    );
  });

  it('calls showErrorMessage after polling ends in FAILED', async () => {
    const { window } = await import('../mocks/vscode.js');
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-fail-notify', status: 'QUEUED' }));
    (pollerMock.poll as any).mockResolvedValue(makeRunResult({ runId: 'run-fail-notify', status: 'FAILED' }));

    await handler('prompt', mock.stream as any, createMockToken() as any);

    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Cloud agent failed'),
    );
  });

  it('passes model when defaultModel is not "auto"', async () => {
    handler = createCloudCommand(
      cli,
      createMockConfigManager({ defaultModel: 'gpt-4' }),
      pollerMock,
      createMockContextCollector(),
    );
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: null }));

    await handler('prompt', mock.stream as any, createMockToken() as any);

    expect(cli.agentRunCloud.mock.calls[0][0].model).toBe('gpt-4');
  });

  it('shows the environment when configured', async () => {
    handler = createCloudCommand(
      cli,
      createMockConfigManager({ defaultEnvironment: 'staging' }),
      pollerMock,
      createMockContextCollector(),
    );
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: null }));

    await handler('prompt', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('staging');
  });

  it('detects the "review" skill in the prompt and passes it to the CLI', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: null }));

    await handler('review my code', mock.stream as any, createMockToken() as any);

    expect(cli.agentRunCloud.mock.calls[0][0].skill).toBe('4-review-agent');
  });

  it('does not pass a skill when none is detected in the prompt', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: null }));

    await handler('fix the bug in production', mock.stream as any, createMockToken() as any);

    expect(cli.agentRunCloud.mock.calls[0][0].skill).toBeUndefined();
  });

  // Gap: non-Error (string) error during polling → instanceof Error false branch
  it('handles a non-Error (string) error during polling (String() branch)', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-str-poll' }));
    (pollerMock.poll as any).mockRejectedValue('raw string poll error');

    await handler('prompt', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('raw string poll error');
  });

  // Gap: non-Error (string) error in the main catch → instanceof Error false branch
  it('handles a non-Error (string) error in the main catch (String() branch)', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockRejectedValue('string thrown error');

    await handler('prompt', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('string thrown error');
  });

  // =========================================================================
  // Environment auto-detection tests
  // =========================================================================

  it('auto-selects the first environment when none is configured', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.environmentList.mockResolvedValue(makeListResult([
      { id: 'env-abc-123', name: 'my-environment', base_image: { docker_image: 'img' }, github_repos: [], setup_commands: [], creator_email: 'a@b.c', last_edited: '', scope: 'Team' },
    ]));
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: null }));

    await handler('deploy', mock.stream as any, createMockToken() as any);

    const callArgs = cli.agentRunCloud.mock.calls[0][0];
    expect(callArgs.environment).toBe('env-abc-123');
    expect(callArgs.noEnvironment).toBeFalsy();
    expect(mock.getFullOutput()).toContain('my-environment');
    expect(mock.getFullOutput()).toContain('env-abc-123');
  });

  it('uses --no-environment when no environment is available', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.environmentList.mockResolvedValue(makeListResult([]));
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: null }));

    await handler('deploy', mock.stream as any, createMockToken() as any);

    const callArgs = cli.agentRunCloud.mock.calls[0][0];
    expect(callArgs.environment).toBeUndefined();
    expect(callArgs.noEnvironment).toBe(true);
    expect(mock.getFullOutput()).toContain('No environments available');
  });

  it('uses --no-environment when environmentList fails', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.environmentList.mockRejectedValue(new Error('network error'));
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: null }));

    await handler('deploy', mock.stream as any, createMockToken() as any);

    const callArgs = cli.agentRunCloud.mock.calls[0][0];
    expect(callArgs.noEnvironment).toBe(true);
  });

  it('does not call environmentList when defaultEnvironment is configured', async () => {
    handler = createCloudCommand(
      cli,
      createMockConfigManager({ defaultEnvironment: 'staging' }),
      pollerMock,
      createMockContextCollector(),
    );
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: null }));

    await handler('deploy', mock.stream as any, createMockToken() as any);

    expect(cli.environmentList).not.toHaveBeenCalled();
    const callArgs = cli.agentRunCloud.mock.calls[0][0];
    expect(callArgs.environment).toBe('staging');
  });

  // =========================================================================
  // Regression: open: false (issue — orphan warp.exe processes)
  // =========================================================================

  it('does NOT pass open: true to agentRunCloud (no orphan warp.exe)', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: null }));

    await handler('test', mock.stream as any, createMockToken() as any);

    const callArgs = cli.agentRunCloud.mock.calls[0][0];
    expect(callArgs.open).not.toBe(true);
  });

  // =========================================================================
  // Regression: tracker integration — immediate sidebar updates
  // =========================================================================

  it('calls tracker.markRunStatus(INPROGRESS) when the cloud run starts', async () => {
    const tracker = { markRunStatus: vi.fn() };
    handler = createCloudCommand(cli, createMockConfigManager(), pollerMock, createMockContextCollector(), tracker);
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-track-1', status: 'QUEUED' }));
    (pollerMock.poll as any).mockResolvedValue(makeRunResult({ runId: 'run-track-1', status: 'SUCCEEDED' }));

    await handler('test', mock.stream as any, createMockToken() as any);

    expect(tracker.markRunStatus).toHaveBeenCalledWith('run-track-1', 'INPROGRESS');
  });

  it('calls tracker.markRunStatus(SUCCEEDED) at the end of polling', async () => {
    const tracker = { markRunStatus: vi.fn() };
    handler = createCloudCommand(cli, createMockConfigManager(), pollerMock, createMockContextCollector(), tracker);
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-track-2', status: 'QUEUED' }));
    (pollerMock.poll as any).mockResolvedValue(makeRunResult({ runId: 'run-track-2', status: 'SUCCEEDED' }));

    await handler('test', mock.stream as any, createMockToken() as any);

    expect(tracker.markRunStatus).toHaveBeenCalledWith('run-track-2', 'SUCCEEDED');
  });

  it('calls tracker.markRunStatus(FAILED) on a polling error', async () => {
    const tracker = { markRunStatus: vi.fn() };
    handler = createCloudCommand(cli, createMockConfigManager(), pollerMock, createMockContextCollector(), tracker);
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-track-err', status: 'QUEUED' }));
    (pollerMock.poll as any).mockRejectedValue(new Error('polling failed'));

    await handler('test', mock.stream as any, createMockToken() as any);

    expect(tracker.markRunStatus).toHaveBeenCalledWith('run-track-err', 'FAILED');
  });

  it('works without a tracker (optional parameter)', async () => {
    // No tracker — should not throw
    handler = createCloudCommand(cli, createMockConfigManager(), pollerMock, createMockContextCollector());
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-no-tracker', status: 'QUEUED' }));
    (pollerMock.poll as any).mockResolvedValue(makeRunResult({ runId: 'run-no-tracker', status: 'SUCCEEDED' }));

    await expect(handler('test', mock.stream as any, createMockToken() as any)).resolves.not.toThrow();
  });
});
