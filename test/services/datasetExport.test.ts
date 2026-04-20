import { describe, it, expect, vi } from 'vitest';
import {
  DatasetExportService,
  csvQuote,
  toCsv,
  toJsonl,
  truncateOutput,
  DatasetRow,
} from '../../src/services/datasetExport.js';
import { IOzCliService, OzRunResult, OzRunStatus } from '../../src/types/index.js';

function detail(over: Partial<OzRunResult>): OzRunResult {
  return {
    runId: 'r', status: 'SUCCEEDED', output: '', exitCode: 0, durationMs: 0, raw: null,
    ...over,
  };
}

function makeCli(items: Array<{ id: string; status: OzRunStatus; output?: string; exitCode?: number }>): IOzCliService {
  return {
    runList: vi.fn(async () => ({ items: items.map(({ id, status }) => ({ id, status })) })),
    runGet: vi.fn(async (id: string) => {
      const found = items.find((i) => i.id === id)!;
      return detail({ runId: id, status: found.status, output: found.output ?? '', exitCode: found.exitCode ?? 0 });
    }),
  } as unknown as IOzCliService;
}

describe('csvQuote', () => {
  it('passes through plain values', () => {
    expect(csvQuote('hello')).toBe('hello');
    expect(csvQuote(42)).toBe('42');
  });
  it('quotes values containing comma, quote or newline', () => {
    expect(csvQuote('a,b')).toBe('"a,b"');
    expect(csvQuote('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvQuote('line1\nline2')).toBe('"line1\nline2"');
  });
  it('treats null/undefined as empty', () => {
    expect(csvQuote(null)).toBe('');
    expect(csvQuote(undefined)).toBe('');
  });
});

describe('toCsv', () => {
  it('emits header-only when no rows', () => {
    expect(toCsv([])).toBe('runId,status,durationMs,exitCode,outputExcerpt\n');
  });
  it('emits header + rows', () => {
    const rows: DatasetRow[] = [
      { runId: 'a', status: 'SUCCEEDED', durationMs: 100, exitCode: 0, outputExcerpt: 'ok' },
      { runId: 'b', status: 'FAILED', durationMs: 200, exitCode: 1, outputExcerpt: 'err,with comma' },
    ];
    const csv = toCsv(rows);
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe('runId,status,durationMs,exitCode,outputExcerpt');
    expect(lines[1]).toBe('a,SUCCEEDED,100,0,ok');
    expect(lines[2]).toBe('b,FAILED,200,1,"err,with comma"');
  });
});

describe('toJsonl', () => {
  it('emits one JSON object per line', () => {
    const rows: DatasetRow[] = [
      { runId: 'a', status: 'SUCCEEDED', durationMs: 1, exitCode: 0, outputExcerpt: '' },
      { runId: 'b', status: 'FAILED', durationMs: 2, exitCode: 1, outputExcerpt: '' },
    ];
    const lines = toJsonl(rows).split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(rows[0]);
  });
  it('returns empty string for empty rows', () => {
    expect(toJsonl([])).toBe('');
  });
});

describe('truncateOutput', () => {
  it('returns empty for empty input or non-positive max', () => {
    expect(truncateOutput('', 100)).toBe('');
    expect(truncateOutput('hello', 0)).toBe('');
  });
  it('passes through when within budget', () => {
    expect(truncateOutput('hello', 100)).toBe('hello');
  });
  it('truncates at last newline within budget', () => {
    const text = 'line1\nline2\nline3';
    const result = truncateOutput(text, 12);
    expect(result.endsWith('line2')).toBe(true);
  });
});

describe('DatasetExportService', () => {
  it('rejects non-positive limit', async () => {
    const svc = new DatasetExportService(makeCli([]));
    await expect(svc.export({ format: 'jsonl', limit: 0 })).rejects.toThrow(/limit must be positive/);
  });

  it('exports JSONL by default with terminal-only filter', async () => {
    const cli = makeCli([
      { id: 'a', status: 'SUCCEEDED', output: 'ok' },
      { id: 'b', status: 'INPROGRESS', output: 'still running' },
      { id: 'c', status: 'FAILED', output: 'boom', exitCode: 1 },
    ]);
    const svc = new DatasetExportService(cli);
    const out = await svc.export({ format: 'jsonl' });
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    const ids = lines.map((l) => JSON.parse(l).runId);
    expect(ids).toEqual(['a', 'c']);
  });

  it('includes non-terminal runs when terminalOnly=false', async () => {
    const cli = makeCli([
      { id: 'a', status: 'SUCCEEDED' },
      { id: 'b', status: 'INPROGRESS' },
    ]);
    const svc = new DatasetExportService(cli);
    const out = await svc.export({ format: 'jsonl', terminalOnly: false });
    expect(out.split('\n')).toHaveLength(2);
  });

  it('respects limit', async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, status: 'SUCCEEDED' as OzRunStatus }));
    const svc = new DatasetExportService(makeCli(items));
    const out = await svc.export({ format: 'jsonl', limit: 2 });
    expect(out.split('\n')).toHaveLength(2);
  });

  it('exports CSV with header row', async () => {
    const cli = makeCli([{ id: 'r1', status: 'SUCCEEDED', output: 'fine' }]);
    const svc = new DatasetExportService(cli);
    const csv = await svc.export({ format: 'csv' });
    expect(csv.startsWith('runId,status,durationMs,exitCode,outputExcerpt\n')).toBe(true);
    expect(csv).toContain('r1,SUCCEEDED,0,0,fine');
  });

  it('truncates per-row output to maxOutputChars', async () => {
    const longOutput = 'x'.repeat(10000);
    const cli = makeCli([{ id: 'r1', status: 'SUCCEEDED', output: longOutput }]);
    const svc = new DatasetExportService(cli);
    const out = await svc.export({ format: 'jsonl', maxOutputChars: 50 });
    const row = JSON.parse(out);
    expect(row.outputExcerpt.length).toBeLessThanOrEqual(50);
  });
});
