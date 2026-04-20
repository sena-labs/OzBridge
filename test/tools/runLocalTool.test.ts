import { describe, it, expect, beforeEach } from 'vitest';
import { RunLocalTool } from '../../src/tools/runLocalTool.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';
import {
  createMockCli,
  createMockConfigManager,
  createMockContextCollector,
  makeRunResult,
} from '../helpers.js';
import { makeInvokeOptions, makePrepareOptions, makeToken, resultText } from './toolHelpers.js';

let cli: ReturnType<typeof createMockCli>;
let tool: RunLocalTool;

beforeEach(() => {
  cli = createMockCli();
  tool = new RunLocalTool(cli, createMockConfigManager(), createMockContextCollector());
});

describe('RunLocalTool.name', () => {
  it('matches the contributes.languageModelTools entry', () => {
    expect(RunLocalTool.name).toBe('oz_run_local');
  });
});

describe('RunLocalTool.prepareInvocation', () => {
  it('returns invocation + confirmation messages containing the prompt preview', async () => {
    const prepared = await tool.prepareInvocation(
      makePrepareOptions({ prompt: 'refactor auth module' }),
      makeToken(),
    );

    expect(prepared.invocationMessage).toBeDefined();
    expect(prepared.confirmationMessages).toBeDefined();
    // MarkdownString#value contains the preview text
    const msgValue = (prepared.confirmationMessages?.message as unknown as { value: string }).value;
    expect(msgValue).toContain('refactor auth module');
  });

  it('truncates overly long prompts in the preview', async () => {
    const longPrompt = 'a'.repeat(500);
    const prepared = await tool.prepareInvocation(makePrepareOptions({ prompt: longPrompt }), makeToken());
    const msgValue = (prepared.invocationMessage as unknown as { value: string }).value;
    expect(msgValue.length).toBeLessThan(longPrompt.length);
    expect(msgValue).toContain('…');
  });
});

describe('RunLocalTool.invoke', () => {
  it('rejects empty prompts with a friendly error', async () => {
    const result = await tool.invoke(makeInvokeOptions({ prompt: '   ' }), makeToken());
    expect(resultText(result)).toContain('Missing input');
    expect(cli.agentRun).not.toHaveBeenCalled();
  });

  it('surfaces a warning when Oz CLI is not installed', async () => {
    cli.checkAvailability.mockResolvedValue({ available: false, version: null, path: null });

    const result = await tool.invoke(makeInvokeOptions({ prompt: 'hello' }), makeToken());

    expect(resultText(result)).toContain('Oz CLI not found');
    expect(cli.agentRun).not.toHaveBeenCalled();
  });

  it('runs the agent locally and injects IDE context by default', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult({ output: 'done.' }));

    const result = await tool.invoke(makeInvokeOptions({ prompt: 'fix bug' }), makeToken());

    expect(cli.agentRun).toHaveBeenCalledTimes(1);
    const args = cli.agentRun.mock.calls[0][0];
    expect(args.prompt).toContain('[CONTEXT]');
    expect(args.prompt).toContain('fix bug');
    expect(args.cwd).toBe('/workspace');
    expect(resultText(result)).toContain('SUCCEEDED');
    expect(resultText(result)).toContain('done.');
  });

  it('skips IDE context when includeIdeContext=false', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    await tool.invoke(
      makeInvokeOptions({ prompt: 'raw prompt', includeIdeContext: false }),
      makeToken(),
    );

    const args = cli.agentRun.mock.calls[0][0];
    expect(args.prompt).toBe('raw prompt');
    expect(args.prompt).not.toContain('[CONTEXT]');
    expect(args.cwd).toBeUndefined();
  });

  it('forwards explicit model/profile/skill overrides', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    await tool.invoke(
      makeInvokeOptions({ prompt: 'p', model: 'gpt-4o', profile: 'Custom', skill: '5-test-agent' }),
      makeToken(),
    );

    const args = cli.agentRun.mock.calls[0][0];
    expect(args.model).toBe('gpt-4o');
    expect(args.profile).toBe('Custom');
    expect(args.skill).toBe('5-test-agent');
  });

  it('omits model/profile when config defaults are "auto"/"Default"', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    await tool.invoke(makeInvokeOptions({ prompt: 'p' }), makeToken());

    const args = cli.agentRun.mock.calls[0][0];
    expect(args.model).toBeUndefined();
    expect(args.profile).toBeUndefined();
  });

  it('returns an OzCliError hint for NOT_AUTHENTICATED failures', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_AUTHENTICATED, 'not logged in'));

    const result = await tool.invoke(makeInvokeOptions({ prompt: 'p' }), makeToken());

    const text = resultText(result);
    expect(text).toContain('NOT_AUTHENTICATED');
    expect(text).toContain('oz login');
  });

  it('surfaces generic errors', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockRejectedValue(new Error('boom'));

    const result = await tool.invoke(makeInvokeOptions({ prompt: 'p' }), makeToken());
    expect(resultText(result)).toContain('boom');
  });
});
