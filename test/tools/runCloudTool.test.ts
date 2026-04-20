import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { RunCloudTool } from '../../src/tools/runCloudTool.js';
import { OzCliError, OzCliErrorKind, IRunPoller } from '../../src/types/index.js';
import {
  createMockCli,
  createMockConfigManager,
  createMockContextCollector,
  makeRunResult,
  makeListResult,
} from '../helpers.js';
import { makeInvokeOptions, makePrepareOptions, makeToken, resultText } from './toolHelpers.js';

/** Factory that builds a poller whose `poll` is a Mock and accessible directly. */
function createPoller(): IRunPoller & { poll: Mock; disposeAll: Mock } {
  return {
    poll: vi.fn(),
    disposeAll: vi.fn(),
  } as unknown as IRunPoller & { poll: Mock; disposeAll: Mock };
}

let cli: ReturnType<typeof createMockCli>;
let poller: ReturnType<typeof createPoller>;
let tool: RunCloudTool;

beforeEach(() => {
  cli = createMockCli();
  poller = createPoller();
  tool = new RunCloudTool(cli, createMockConfigManager(), createMockContextCollector(), poller);
});

describe('RunCloudTool.name', () => {
  it('matches the manifest entry', () => {
    expect(RunCloudTool.name).toBe('warp_run_cloud');
  });
});

describe('RunCloudTool.prepareInvocation', () => {
  it('surfaces a credit-consumption confirmation dialog', async () => {
    const prepared = await tool.prepareInvocation(
      makePrepareOptions({ prompt: 'deploy staging' }),
      makeToken(),
    );

    expect(prepared.confirmationMessages).toBeDefined();
    const title = prepared.confirmationMessages?.title ?? '';
    const msg = (prepared.confirmationMessages?.message as unknown as { value: string }).value;

    expect(title).toContain('credits');
    expect(msg).toContain('Warp cloud credits');
    expect(msg).toContain('deploy staging');
  });
});

describe('RunCloudTool.invoke', () => {
  it('rejects empty prompts', async () => {
    const result = await tool.invoke(makeInvokeOptions({ prompt: '' }), makeToken());
    expect(resultText(result)).toContain('Missing input');
    expect(cli.agentRunCloud).not.toHaveBeenCalled();
  });

  it('reports when Oz CLI is missing', async () => {
    cli.checkAvailability.mockResolvedValue({ available: false, version: null, path: null });

    const result = await tool.invoke(makeInvokeOptions({ prompt: 'p' }), makeToken());

    expect(resultText(result)).toContain('Oz CLI not found');
    expect(cli.agentRunCloud).not.toHaveBeenCalled();
  });

  it('auto-resolves the first environment when no default/explicit env is set', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.environmentList.mockResolvedValue(
      makeListResult([
        {
          id: 'env-a',
          name: 'envA',
          base_image: { docker_image: '' },
          github_repos: [],
          setup_commands: [],
          creator_email: '',
          last_edited: '',
          scope: '',
        },
      ]),
    );
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-xyz', status: 'QUEUED' }));
    poller.poll.mockResolvedValue(
      makeRunResult({ runId: 'run-xyz', status: 'SUCCEEDED', output: 'ok' }),
    );

    const result = await tool.invoke(makeInvokeOptions({ prompt: 'p' }), makeToken());

    const args = cli.agentRunCloud.mock.calls[0][0];
    expect(args.environment).toBe('env-a');
    expect(args.noEnvironment).toBe(false);
    expect(resultText(result)).toContain('Cloud run finished');
  });

  it('falls back to noEnvironment=true when environmentList throws', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.environmentList.mockRejectedValue(new Error('forbidden'));
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: null, status: 'SUCCEEDED' }));

    await tool.invoke(makeInvokeOptions({ prompt: 'p' }), makeToken());

    const args = cli.agentRunCloud.mock.calls[0][0];
    expect(args.environment).toBeUndefined();
    expect(args.noEnvironment).toBe(true);
  });

  it('returns runId without polling when wait=false', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-123', status: 'QUEUED' }));

    const result = await tool.invoke(
      makeInvokeOptions({ prompt: 'p', environment: 'env', wait: false }),
      makeToken(),
    );

    expect(poller.poll).not.toHaveBeenCalled();
    expect(resultText(result)).toContain('Cloud run submitted');
    expect(resultText(result)).toContain('run-123');
  });

  it('polls until terminal state when wait is not disabled', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-abc', status: 'INPROGRESS' }));
    poller.poll.mockResolvedValue(
      makeRunResult({ runId: 'run-abc', status: 'SUCCEEDED', output: 'finished' }),
    );

    const result = await tool.invoke(
      makeInvokeOptions({ prompt: 'p', environment: 'env' }),
      makeToken(),
    );

    expect(poller.poll).toHaveBeenCalledWith('run-abc', expect.any(Function), expect.anything());
    expect(resultText(result)).toContain('Cloud run finished');
    expect(resultText(result)).toContain('finished');
  });

  it('surfaces a polling error without failing the invocation', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'run-1', status: 'INPROGRESS' }));
    poller.poll.mockRejectedValue(
      new OzCliError(OzCliErrorKind.TIMEOUT, 'polling timed out'),
    );

    const result = await tool.invoke(
      makeInvokeOptions({ prompt: 'p', environment: 'env' }),
      makeToken(),
    );

    expect(resultText(result)).toContain('TIMEOUT');
    expect(resultText(result)).toContain('polling timed out');
  });

  it('reports errors from agentRunCloud', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRunCloud.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_AUTHENTICATED, 'login'));

    const result = await tool.invoke(
      makeInvokeOptions({ prompt: 'p', environment: 'env' }),
      makeToken(),
    );

    expect(resultText(result)).toContain('NOT_AUTHENTICATED');
  });
});
