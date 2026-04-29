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
  it('dovrebbe mostrare errore se CLI non disponibile', async () => {
    cli.checkAvailability.mockResolvedValue({ available: false, version: null, path: null });

    await handler('deploy app', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('not found');
    expect(cli.agentRunCloud).not.toHaveBeenCalled();
  });

  it('dovrebbe mostrare avviso crediti prima del lancio', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: null }));

    await handler('deploy', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('credits');
  });

  it('dovrebbe iniettare contesto IDE nel prompt', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: null }));

    await handler('deploy', mock.stream as any, createMockToken() as any);

    const callArgs = cli.agentRunCloud.mock.calls[0][0];
    expect(callArgs.prompt).toContain('[CONTEXT]');
    expect(callArgs.prompt).toContain('deploy');
  });

  it('dovrebbe avviare polling se runId presente', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'cloud-run-1', status: 'QUEUED' }));
    (pollerMock.poll as any).mockResolvedValue(makeRunResult({ runId: 'cloud-run-1', status: 'SUCCEEDED' }));

    await handler('do something', mock.stream as any, createMockToken() as any);

    expect(pollerMock.poll).toHaveBeenCalledWith('cloud-run-1', expect.any(Function), expect.anything());
    expect(mock.getFullOutput()).toContain('cloud-run-1');
    expect(mock.getFullOutput()).toContain('SUCCEEDED');
  });

  // Gap: progress callback di poller.poll() dovrebbe essere invocata
  it('dovrebbe invocare stream.progress tramite la callback di polling', async () => {
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

  it('dovrebbe mostrare risultato direttamente se runId mancante', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: null, output: 'direct result' }));

    await handler('quick run', mock.stream as any, createMockToken() as any);

    expect(pollerMock.poll).not.toHaveBeenCalled();
    expect(mock.getFullOutput()).toContain('direct result');
  });

  it('dovrebbe gestire errore polling', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-err' }));
    (pollerMock.poll as any).mockRejectedValue(new OzCliError(OzCliErrorKind.TIMEOUT, 'timeout'));

    await handler('prompt', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Timeout');
  });

  it('dovrebbe gestire OzCliError su agentRunCloud', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_AUTHENTICATED, 'not logged'));

    await handler('prompt', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Not authenticated');
  });

  it('dovrebbe gestire errore generico su agentRunCloud', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockRejectedValue(new Error('network error'));

    await handler('prompt', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('network error');
  });

  it('dovrebbe gestire errore generico (non-OzCliError) durante polling', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-poll-err' }));
    (pollerMock.poll as any).mockRejectedValue(new Error('network disconnected'));

    await handler('prompt', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Polling error');
    expect(mock.getFullOutput()).toContain('network disconnected');
  });

  it('dovrebbe chiamare showInformationMessage dopo polling SUCCEEDED', async () => {
    const { window } = await import('../mocks/vscode.js');
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-notify', status: 'QUEUED' }));
    (pollerMock.poll as any).mockResolvedValue(makeRunResult({ runId: 'run-notify', status: 'SUCCEEDED' }));

    await handler('prompt', mock.stream as any, createMockToken() as any);

    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('completed successfully'),
    );
  });

  it('dovrebbe chiamare showErrorMessage dopo polling FAILED', async () => {
    const { window } = await import('../mocks/vscode.js');
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-fail-notify', status: 'QUEUED' }));
    (pollerMock.poll as any).mockResolvedValue(makeRunResult({ runId: 'run-fail-notify', status: 'FAILED' }));

    await handler('prompt', mock.stream as any, createMockToken() as any);

    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Cloud agent failed'),
    );
  });

  it('dovrebbe passare model se defaultModel non è "auto"', async () => {
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

  it('dovrebbe mostrare environment se configurato', async () => {
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

  it('dovrebbe rilevare skill "review" nel prompt e passarla al CLI', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: null }));

    await handler('review my code', mock.stream as any, createMockToken() as any);

    expect(cli.agentRunCloud.mock.calls[0][0].skill).toBe('4-review-agent');
  });

  it('dovrebbe non passare skill se non rilevata nel prompt', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: null }));

    await handler('fix the bug in production', mock.stream as any, createMockToken() as any);

    expect(cli.agentRunCloud.mock.calls[0][0].skill).toBeUndefined();
  });

  // Gap: errore non-Error (stringa) durante polling → instanceof Error false branch
  it('dovrebbe gestire errore non-Error (stringa) durante polling (String() branch)', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-str-poll' }));
    (pollerMock.poll as any).mockRejectedValue('raw string poll error');

    await handler('prompt', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('raw string poll error');
  });

  // Gap: errore non-Error (stringa) nel catch principale → instanceof Error false branch
  it('dovrebbe gestire errore non-Error (stringa) nel catch principale (String() branch)', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockRejectedValue('string thrown error');

    await handler('prompt', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('string thrown error');
  });

  // =========================================================================
  // Environment auto-detection tests
  // =========================================================================

  it('dovrebbe auto-selezionare il primo environment se non configurato', async () => {
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

  it('dovrebbe usare --no-environment se nessun environment disponibile', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.environmentList.mockResolvedValue(makeListResult([]));
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: null }));

    await handler('deploy', mock.stream as any, createMockToken() as any);

    const callArgs = cli.agentRunCloud.mock.calls[0][0];
    expect(callArgs.environment).toBeUndefined();
    expect(callArgs.noEnvironment).toBe(true);
    expect(mock.getFullOutput()).toContain('No environments available');
  });

  it('dovrebbe usare --no-environment se environmentList fallisce', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.environmentList.mockRejectedValue(new Error('network error'));
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: null }));

    await handler('deploy', mock.stream as any, createMockToken() as any);

    const callArgs = cli.agentRunCloud.mock.calls[0][0];
    expect(callArgs.noEnvironment).toBe(true);
  });

  it('dovrebbe non chiamare environmentList se defaultEnvironment è configurato', async () => {
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

  it('dovrebbe NON passare open: true a agentRunCloud (nessun warp.exe orfano)', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: null }));

    await handler('test', mock.stream as any, createMockToken() as any);

    const callArgs = cli.agentRunCloud.mock.calls[0][0];
    expect(callArgs.open).not.toBe(true);
  });

  // =========================================================================
  // Regression: tracker integration — immediate sidebar updates
  // =========================================================================

  it('dovrebbe chiamare tracker.markRunStatus(INPROGRESS) quando il cloud run inizia', async () => {
    const tracker = { markRunStatus: vi.fn() };
    handler = createCloudCommand(cli, createMockConfigManager(), pollerMock, createMockContextCollector(), tracker);
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-track-1', status: 'QUEUED' }));
    (pollerMock.poll as any).mockResolvedValue(makeRunResult({ runId: 'run-track-1', status: 'SUCCEEDED' }));

    await handler('test', mock.stream as any, createMockToken() as any);

    expect(tracker.markRunStatus).toHaveBeenCalledWith('run-track-1', 'INPROGRESS');
  });

  it('dovrebbe chiamare tracker.markRunStatus(SUCCEEDED) alla fine del polling', async () => {
    const tracker = { markRunStatus: vi.fn() };
    handler = createCloudCommand(cli, createMockConfigManager(), pollerMock, createMockContextCollector(), tracker);
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-track-2', status: 'QUEUED' }));
    (pollerMock.poll as any).mockResolvedValue(makeRunResult({ runId: 'run-track-2', status: 'SUCCEEDED' }));

    await handler('test', mock.stream as any, createMockToken() as any);

    expect(tracker.markRunStatus).toHaveBeenCalledWith('run-track-2', 'SUCCEEDED');
  });

  it('dovrebbe chiamare tracker.markRunStatus(FAILED) su errore di polling', async () => {
    const tracker = { markRunStatus: vi.fn() };
    handler = createCloudCommand(cli, createMockConfigManager(), pollerMock, createMockContextCollector(), tracker);
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-track-err', status: 'QUEUED' }));
    (pollerMock.poll as any).mockRejectedValue(new Error('polling failed'));

    await handler('test', mock.stream as any, createMockToken() as any);

    expect(tracker.markRunStatus).toHaveBeenCalledWith('run-track-err', 'FAILED');
  });

  it('dovrebbe funzionare senza tracker (parametro opzionale)', async () => {
    // No tracker — should not throw
    handler = createCloudCommand(cli, createMockConfigManager(), pollerMock, createMockContextCollector());
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-no-tracker', status: 'QUEUED' }));
    (pollerMock.poll as any).mockResolvedValue(makeRunResult({ runId: 'run-no-tracker', status: 'SUCCEEDED' }));

    await expect(handler('test', mock.stream as any, createMockToken() as any)).resolves.not.toThrow();
  });
});
