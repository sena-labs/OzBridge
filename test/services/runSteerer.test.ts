import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ProgressiveRunSteerer,
  hasContinueFlag,
  hasConversationFlag,
} from '../../src/services/runSteerer.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';
import { createMockCli, makeRunResult } from '../helpers.js';

let cli: ReturnType<typeof createMockCli>;
let steerer: ProgressiveRunSteerer;

beforeEach(() => {
  vi.clearAllMocks();
  cli = createMockCli();
  steerer = new ProgressiveRunSteerer(cli);
});

describe('hasContinueFlag', () => {
  it('returns false for empty input', () => {
    expect(hasContinueFlag('')).toBe(false);
  });

  it('detects --continue surrounded by whitespace', () => {
    expect(hasContinueFlag('Usage: oz agent run [--continue ID] --prompt P')).toBe(true);
  });

  it('detects --continue at end of line', () => {
    expect(hasContinueFlag('Options:\n  --prompt PROMPT\n  --continue')).toBe(true);
  });

  it('detects --continue followed by =', () => {
    expect(hasContinueFlag('  --continue=RUNID   resume an in-flight run')).toBe(true);
  });

  it('does not match --continue-on-error (false-positive guard)', () => {
    expect(hasContinueFlag('  --continue-on-error   keep going on failure')).toBe(false);
  });

  it('does not match arbitrary text', () => {
    expect(hasContinueFlag('Usage: oz agent run --prompt PROMPT')).toBe(false);
  });
});

describe('hasConversationFlag (upstream canonical name)', () => {
  it('detects --conversation surrounded by whitespace', () => {
    expect(hasConversationFlag('Usage: oz agent run [--conversation ID] --prompt P')).toBe(true);
  });

  it('detects --conversation followed by =', () => {
    expect(hasConversationFlag('  --conversation=ID   resume an in-flight conversation')).toBe(true);
  });

  it('still detects legacy --continue spelling', () => {
    expect(hasConversationFlag('  --continue ID   (legacy)')).toBe(true);
  });

  it('returns false on unrelated text', () => {
    expect(hasConversationFlag('Usage: oz agent run --prompt PROMPT')).toBe(false);
  });

  it('hasContinueFlag is exported as deprecated alias of hasConversationFlag', () => {
    expect(hasContinueFlag).toBe(hasConversationFlag);
  });
});

describe('ProgressiveRunSteerer.capabilities()', () => {
  it('probes the CLI help on first call', async () => {
    cli.helpAgentRun.mockResolvedValue('Options:\n  --continue ID\n');

    const caps = await steerer.capabilities();

    expect(caps.nativeContinue).toBe(true);
    expect(caps.detectedAt).toBeGreaterThan(0);
    expect(cli.helpAgentRun).toHaveBeenCalledTimes(1);
  });

  it('caches the probe result across calls', async () => {
    cli.helpAgentRun.mockResolvedValue('--continue\n');

    const a = await steerer.capabilities();
    const b = await steerer.capabilities();
    const c = await steerer.capabilities();

    expect(cli.helpAgentRun).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('returns nativeContinue=false when help omits the flag', async () => {
    cli.helpAgentRun.mockResolvedValue('Usage: oz agent run --prompt PROMPT');

    const caps = await steerer.capabilities();

    expect(caps.nativeContinue).toBe(false);
  });

  it('soft-fails to nativeContinue=false when help throws', async () => {
    cli.helpAgentRun.mockRejectedValue(
      new OzCliError(OzCliErrorKind.NOT_FOUND, 'oz not found'),
    );

    const caps = await steerer.capabilities();

    expect(caps.nativeContinue).toBe(false);
    expect(caps.detectedAt).toBeGreaterThan(0);
  });
});

describe('ProgressiveRunSteerer.steer() — input validation', () => {
  it('rejects empty prompt', async () => {
    await expect(steerer.steer({ runId: 'run-1', prompt: '' })).rejects.toThrow(
      /Prompt cannot be empty/,
    );
    expect(cli.helpAgentRun).not.toHaveBeenCalled();
    expect(cli.agentContinue).not.toHaveBeenCalled();
    expect(cli.agentRunCloud).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only prompt', async () => {
    await expect(
      steerer.steer({ runId: 'run-1', prompt: '   \n\t' }),
    ).rejects.toThrow(/Prompt cannot be empty/);
  });

  it('rejects empty runId', async () => {
    await expect(
      steerer.steer({ runId: '', prompt: 'do something' }),
    ).rejects.toThrow(/runId cannot be empty/);
  });
});

describe('ProgressiveRunSteerer.steer() — native-continue path', () => {
  beforeEach(() => {
    cli.helpAgentRun.mockResolvedValue('  --continue ID   resume run\n');
  });

  it('delegates to agentContinue when the flag is exposed', async () => {
    cli.agentContinue.mockResolvedValue(
      makeRunResult({ runId: 'run-1', status: 'INPROGRESS' }),
    );

    const out = await steerer.steer({ runId: 'run-1', prompt: 'do x' });

    expect(out.strategy).toBe('native-continue');
    expect(out.runId).toBe('run-1');
    expect(out.raw.status).toBe('INPROGRESS');
    expect(cli.agentContinue).toHaveBeenCalledWith({
      runId: 'run-1',
      prompt: 'do x',
      cancellation: undefined,
    });
    expect(cli.agentRunCloud).not.toHaveBeenCalled();
  });

  it('forwards the cancellation token unchanged', async () => {
    cli.agentContinue.mockResolvedValue(makeRunResult({ runId: 'r' }));
    const token = { isCancellationRequested: false } as never;

    await steerer.steer({ runId: 'run-1', prompt: 'p', cancellation: token });

    expect(cli.agentContinue).toHaveBeenCalledWith(
      expect.objectContaining({ cancellation: token }),
    );
  });

  it('propagates OzCliError from agentContinue unchanged', async () => {
    const err = new OzCliError(OzCliErrorKind.CLI_ERROR, 'boom', 1, 'stderr');
    cli.agentContinue.mockRejectedValue(err);

    await expect(steerer.steer({ runId: 'run-1', prompt: 'p' })).rejects.toBe(err);
  });
});

describe('ProgressiveRunSteerer.steer() — inlined-fallback path', () => {
  beforeEach(() => {
    cli.helpAgentRun.mockResolvedValue('Usage: oz agent run --prompt PROMPT');
  });

  it('delegates to agentRunCloud with the runId inlined', async () => {
    cli.agentRunCloud.mockResolvedValue(
      makeRunResult({ runId: 'run-2', status: 'QUEUED' }),
    );

    const out = await steerer.steer({ runId: 'run-1', prompt: 'do x' });

    expect(out.strategy).toBe('inlined-fallback');
    expect(out.runId).toBe('run-2');
    expect(cli.agentRunCloud).toHaveBeenCalledWith({
      prompt: '[CONTINUING run-1] do x',
      cancellation: undefined,
    });
    expect(cli.agentContinue).not.toHaveBeenCalled();
  });

  it('forwards the cancellation token unchanged on the fallback path', async () => {
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'r' }));
    const token = { isCancellationRequested: false } as never;

    await steerer.steer({ runId: 'run-1', prompt: 'p', cancellation: token });

    expect(cli.agentRunCloud).toHaveBeenCalledWith(
      expect.objectContaining({ cancellation: token }),
    );
  });

  it('propagates OzCliError from agentRunCloud unchanged', async () => {
    const err = new OzCliError(OzCliErrorKind.CLI_ERROR, 'cloud boom');
    cli.agentRunCloud.mockRejectedValue(err);

    await expect(steerer.steer({ runId: 'run-1', prompt: 'p' })).rejects.toBe(err);
  });

  it('uses the fallback when probe failed (defensive)', async () => {
    // override beforeEach: probe throws
    cli.helpAgentRun.mockRejectedValue(new Error('cli missing'));
    cli.agentRunCloud.mockResolvedValue(makeRunResult({ runId: 'r' }));

    const out = await steerer.steer({ runId: 'run-1', prompt: 'p' });

    expect(out.strategy).toBe('inlined-fallback');
    expect(cli.agentRunCloud).toHaveBeenCalledWith({
      prompt: '[CONTINUING run-1] p',
      cancellation: undefined,
    });
  });
});
