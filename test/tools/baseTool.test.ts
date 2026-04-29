// C-M1: direct unit tests for src/tools/baseTool.ts. Previously covered only
// transitively via the four `oz_*` LM tools — this file pins the behaviour of
// the formatting/error helpers directly so regressions surface here, not in
// the higher-level integration tests.

import { describe, it, expect } from 'vitest';
import {
  textResult,
  renderRunResult,
  errorResult,
  errorHint,
  filterRunsByStatus,
  type StatusFilter,
} from '../../src/tools/baseTool.js';
import { OzCliError, OzCliErrorKind, type OzRunResult, type OzRunStatus } from '../../src/types/index.js';
import { LanguageModelTextPart, LanguageModelToolResult } from '../mocks/vscode.js';

function makeRun(overrides: Partial<OzRunResult> = {}): OzRunResult {
  return {
    runId: 'run-1',
    status: 'SUCCEEDED',
    output: 'hello',
    exitCode: 0,
    durationMs: 1500,
    raw: null,
    ...overrides,
  };
}

describe('textResult', () => {
  it('wraps a markdown string in a single LanguageModelTextPart', () => {
    const r = textResult('hello');
    expect(r).toBeInstanceOf(LanguageModelToolResult);
    expect(r.content).toHaveLength(1);
    expect(r.content[0]).toBeInstanceOf(LanguageModelTextPart);
    expect((r.content[0] as LanguageModelTextPart).value).toBe('hello');
  });
});

describe('renderRunResult', () => {
  it('renders SUCCEEDED with check icon, run id, duration, and output', () => {
    const md = renderRunResult(makeRun());
    expect(md).toContain('✅');
    expect(md).toContain('`SUCCEEDED`');
    expect(md).toContain('`run-1`');
    expect(md).toContain('Duration**: 1.5s');
    expect(md).toContain('Exit code**: 0');
    expect(md).toContain('hello');
  });

  it('renders FAILED with cross icon', () => {
    expect(renderRunResult(makeRun({ status: 'FAILED', exitCode: 1 }))).toContain('❌');
  });

  it('renders non-terminal status with hourglass icon', () => {
    const md = renderRunResult(makeRun({ status: 'INPROGRESS' as OzRunStatus }));
    expect(md).toContain('⏳');
  });

  it('omits Run ID line when runId is null', () => {
    const md = renderRunResult(makeRun({ runId: null }));
    expect(md).not.toContain('Run ID');
  });

  it('omits Duration line when durationMs is 0', () => {
    const md = renderRunResult(makeRun({ durationMs: 0 }));
    expect(md).not.toContain('Duration');
  });

  it('truncates output past maxOutputChars and notes truncation', () => {
    const big = 'x'.repeat(5000);
    const md = renderRunResult(makeRun({ output: big }), 100);
    expect(md).toContain('… (4900 chars truncated)');
    expect(md.indexOf('xxx')).toBeGreaterThan(-1);
  });

  it('omits the output block when output is empty', () => {
    const md = renderRunResult(makeRun({ output: '' }));
    expect(md).not.toContain('---');
  });
});

describe('errorResult', () => {
  it('formats OzCliError with kind, message, hint, and stderr snippet', () => {
    const err = new OzCliError(OzCliErrorKind.NOT_FOUND, 'oz not on PATH', undefined, 'spawn ENOENT');
    const r = errorResult(err);
    const text = (r.content[0] as LanguageModelTextPart).value;
    expect(text).toContain('Oz CLI error');
    expect(text).toContain('NOT_FOUND');
    expect(text).toContain('oz not on PATH');
    expect(text).toContain('Install Warp');
    expect(text).toContain('spawn ENOENT');
  });

  it('skips stderr block when absent', () => {
    const err = new OzCliError(OzCliErrorKind.CANCELLED, 'cancelled by user');
    const text = (errorResult(err).content[0] as LanguageModelTextPart).value;
    expect(text).not.toContain('```');
  });

  it('formats Error subclass as Unexpected error', () => {
    const text = (errorResult(new Error('boom')).content[0] as LanguageModelTextPart).value;
    expect(text).toContain('Unexpected error');
    expect(text).toContain('boom');
  });

  it('formats non-Error throwables via String()', () => {
    const text = (errorResult('raw string').content[0] as LanguageModelTextPart).value;
    expect(text).toContain('raw string');
  });
});

describe('errorHint', () => {
  it('returns a hint for every documented kind', () => {
    const kinds: OzCliErrorKind[] = [
      OzCliErrorKind.NOT_FOUND,
      OzCliErrorKind.NOT_AUTHENTICATED,
      OzCliErrorKind.INSUFFICIENT_CREDITS,
      OzCliErrorKind.STALLED,
      OzCliErrorKind.TIMEOUT,
      OzCliErrorKind.CANCELLED,
      OzCliErrorKind.PARSE_ERROR,
    ];
    for (const k of kinds) {
      expect(typeof errorHint(k)).toBe('string');
      expect(errorHint(k)!.length).toBeGreaterThan(0);
    }
  });

  it('returns undefined for unknown kinds', () => {
    expect(errorHint('NOT_A_KIND' as OzCliErrorKind)).toBeUndefined();
  });
});

describe('filterRunsByStatus', () => {
  const items = [
    { id: 'a', status: 'QUEUED' as OzRunStatus },
    { id: 'b', status: 'INPROGRESS' as OzRunStatus },
    { id: 'c', status: 'SUCCEEDED' as OzRunStatus },
    { id: 'd', status: 'FAILED' as OzRunStatus },
  ];

  it('returns all items by default', () => {
    expect(filterRunsByStatus(items)).toHaveLength(4);
    expect(filterRunsByStatus(items, 'all')).toHaveLength(4);
  });

  it('returns QUEUED + INPROGRESS for "active"', () => {
    const r = filterRunsByStatus(items, 'active');
    expect(r.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('returns SUCCEEDED + FAILED for "completed"', () => {
    const r = filterRunsByStatus(items, 'completed');
    expect(r.map((x) => x.id)).toEqual(['c', 'd']);
  });

  it('returns exact-status match for OzRunStatus filter', () => {
    expect(filterRunsByStatus(items, 'SUCCEEDED').map((x) => x.id)).toEqual(['c']);
    expect(filterRunsByStatus(items, 'FAILED').map((x) => x.id)).toEqual(['d']);
  });

  it('returns empty array for a status with no matches', () => {
    const onlyOne = items.slice(0, 1);
    const r = filterRunsByStatus(onlyOne, 'SUCCEEDED' as StatusFilter);
    expect(r).toEqual([]);
  });
});
