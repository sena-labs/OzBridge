import { describe, it, expect, vi } from 'vitest';
import {
  FailureTriageService,
  ILanguageModelClient,
  buildTriagePrompt,
  extractStackFrames,
  parseTriageResponse,
  tailLines,
} from '../../src/services/failureTriage.js';
import { IOzCliService, OzRunResult } from '../../src/types/index.js';

function makeCli(detail: Partial<OzRunResult>): IOzCliService {
  const result: OzRunResult = {
    runId: 'r1',
    status: 'FAILED',
    output: '',
    exitCode: 1,
    durationMs: 0,
    raw: null,
    ...detail,
  };
  return {
    runGet: vi.fn(async () => result),
  } as unknown as IOzCliService;
}

function makeClient(reply: string): ILanguageModelClient {
  return { sendRequest: vi.fn(async () => reply) };
}

describe('tailLines', () => {
  it('returns the input untouched when shorter than the budget', () => {
    expect(tailLines('hello', 100)).toBe('hello');
  });
  it('returns empty string for non-positive budget', () => {
    expect(tailLines('hello', 0)).toBe('');
    expect(tailLines('hello', -1)).toBe('');
  });
  it('avoids cutting in the middle of the first kept line', () => {
    const text = 'line1\nline2\nline3\nline4';
    const tail = tailLines(text, 12);
    // Should start at a line boundary, not mid-word.
    expect(tail.startsWith('line')).toBe(true);
  });
  it('handles empty input', () => {
    expect(tailLines('', 10)).toBe('');
  });
});

describe('extractStackFrames', () => {
  it('returns empty array for empty output', () => {
    expect(extractStackFrames('')).toEqual([]);
  });

  it('extracts a Node-style stack frame with location and context', () => {
    const out = [
      'Error: boom',
      '    at handler (src/foo.ts:42:10)',
      '    at next (src/bar.ts:7:3)',
    ].join('\n');
    const frames = extractStackFrames(out);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0].location).toBe('src/foo.ts:42:10');
    expect(frames[0].context).toContain('Error: boom');
  });

  it('extracts a Python-style frame', () => {
    const out = 'Traceback:\n  File "app/main.py", line 12, in run\n    raise ValueError()';
    const frames = extractStackFrames(out);
    expect(frames[0].location).toBe('app/main.py:12');
  });

  it('extracts generic file:line format (TS compiler / GCC style)', () => {
    const out = 'src/index.ts:99:5 - error TS2345: ...';
    const frames = extractStackFrames(out);
    expect(frames[0].location).toBe('src/index.ts:99');
  });

  it('respects the limit and deduplicates consecutive identical locations', () => {
    const lines: string[] = [];
    for (let i = 0; i < 5; i++) {
      lines.push('    at fn (src/a.ts:10:5)');
    }
    const frames = extractStackFrames(lines.join('\n'), 3);
    expect(frames).toHaveLength(1);
  });
});

describe('buildTriagePrompt', () => {
  it('renders structured sections including frames and tail', () => {
    const prompt = buildTriagePrompt({
      runId: 'abc',
      status: 'FAILED',
      durationMs: 1234,
      outputTail: 'last line',
      frames: [{ location: 'src/x.ts:1', line: '    at x (src/x.ts:1)', context: ['ctx'] }],
    });
    expect(prompt).toContain('Run id: abc');
    expect(prompt).toContain('Duration: 1234ms');
    expect(prompt).toContain('SUMMARY:');
    expect(prompt).toContain('Frame 1 (src/x.ts:1)');
    expect(prompt).toContain('last line');
  });

  it('handles empty frames and empty output', () => {
    const prompt = buildTriagePrompt({
      runId: 'r', status: 'FAILED', durationMs: 0, outputTail: '', frames: [],
    });
    expect(prompt).toContain('(no stack frames detected)');
    expect(prompt).toContain('(empty)');
  });
});

describe('parseTriageResponse', () => {
  it('returns empty-response sentinel on blank input', () => {
    expect(parseTriageResponse('')).toEqual({ summary: '(empty model response)', actions: [], raw: '' });
  });

  it('parses the SUMMARY/ACTIONS protocol', () => {
    const raw = 'SUMMARY: Database connection refused\nACTIONS:\n- Restart Postgres\n- Check DSN env\n- Verify firewall';
    const parsed = parseTriageResponse(raw);
    expect(parsed.summary).toBe('Database connection refused');
    expect(parsed.actions).toEqual(['Restart Postgres', 'Check DSN env', 'Verify firewall']);
  });

  it('caps actions at 3', () => {
    const raw = 'SUMMARY: x\nACTIONS:\n- a\n- b\n- c\n- d\n- e';
    const parsed = parseTriageResponse(raw);
    expect(parsed.actions).toHaveLength(3);
  });

  it('falls back to first line when SUMMARY: marker is missing', () => {
    const parsed = parseTriageResponse('Just a plain answer\nmore text');
    expect(parsed.summary).toBe('Just a plain answer');
    expect(parsed.actions).toEqual([]);
  });

  it('accepts both - and * bullets', () => {
    const parsed = parseTriageResponse('SUMMARY: y\nACTIONS:\n* alpha\n* beta');
    expect(parsed.actions).toEqual(['alpha', 'beta']);
  });
});

describe('FailureTriageService', () => {
  it('rejects empty runId', async () => {
    const svc = new FailureTriageService(makeCli({}), makeClient('SUMMARY: x'));
    await expect(svc.triage('')).rejects.toThrow(/runId is required/);
  });

  it('rejects non-FAILED runs', async () => {
    const cli = makeCli({ status: 'SUCCEEDED' });
    const svc = new FailureTriageService(cli, makeClient('SUMMARY: x'));
    await expect(svc.triage('r1')).rejects.toThrow(/not in FAILED state/);
  });

  it('honours pre-existing cancellation', async () => {
    const cli = makeCli({ status: 'FAILED' });
    const client = makeClient('SUMMARY: x');
    const svc = new FailureTriageService(cli, client);
    await expect(svc.triage('r1', { isCancellationRequested: true })).rejects.toThrow(/cancelled/);
    expect(client.sendRequest).not.toHaveBeenCalled();
  });

  it('builds a prompt with extracted frames and forwards to the client', async () => {
    const cli = makeCli({
      status: 'FAILED',
      durationMs: 500,
      output: 'Error: bang\n    at run (src/foo.ts:10:1)',
    });
    const client = makeClient('SUMMARY: kaboom\nACTIONS:\n- fix it');
    const svc = new FailureTriageService(cli, client);
    const result = await svc.triage('r1');
    expect(result.summary).toBe('kaboom');
    expect(result.actions).toEqual(['fix it']);
    const prompt = (client.sendRequest as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain('src/foo.ts:10:1');
    expect(prompt).toContain('Run id: r1');
  });

  it('truncates very long output to maxOutputChars', async () => {
    const longOutput = 'x'.repeat(10000);
    const cli = makeCli({ status: 'FAILED', output: longOutput });
    const client = makeClient('SUMMARY: y');
    const svc = new FailureTriageService(cli, client, 200);
    await svc.triage('r1');
    const prompt = (client.sendRequest as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // Output tail block should be ≤ ~200 chars (plus framing); enough to assert the budget.
    const tailBlockMatch = /Output tail:\n```\n([\s\S]*?)\n```/.exec(prompt);
    expect(tailBlockMatch?.[1].length ?? 0).toBeLessThanOrEqual(200);
  });
});
