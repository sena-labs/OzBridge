import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RunStatsService,
  bucketByDate,
  extractCreatedAt,
  formatLocalDate,
  isTerminalStatus,
  successRate,
  type RunStatRecord,
} from '../../src/services/runStats.js';
import { createMockCli, makeRunResult } from '../helpers.js';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('isTerminalStatus', () => {
  it('treats SUCCEEDED as terminal', () => {
    expect(isTerminalStatus('SUCCEEDED')).toBe(true);
  });
  it('treats FAILED as terminal', () => {
    expect(isTerminalStatus('FAILED')).toBe(true);
  });
  it('treats QUEUED, INPROGRESS, UNKNOWN as non-terminal', () => {
    expect(isTerminalStatus('QUEUED')).toBe(false);
    expect(isTerminalStatus('INPROGRESS')).toBe(false);
    expect(isTerminalStatus('UNKNOWN')).toBe(false);
  });
});

describe('extractCreatedAt', () => {
  it('returns null on null/non-object input', () => {
    expect(extractCreatedAt(null)).toBeNull();
    expect(extractCreatedAt('not-an-object')).toBeNull();
    expect(extractCreatedAt(42)).toBeNull();
  });

  it('parses snake_case created_at as ISO string', () => {
    const out = extractCreatedAt({ created_at: '2026-04-20T12:00:00Z' });
    expect(out).toBeInstanceOf(Date);
    expect(out!.toISOString()).toBe('2026-04-20T12:00:00.000Z');
  });

  it('parses camelCase createdAt', () => {
    const out = extractCreatedAt({ createdAt: '2026-04-19T10:00:00Z' });
    expect(out!.toISOString()).toBe('2026-04-19T10:00:00.000Z');
  });

  it('falls back to started_at when created_at is missing', () => {
    const out = extractCreatedAt({ started_at: '2026-04-18T08:00:00Z' });
    expect(out!.toISOString()).toBe('2026-04-18T08:00:00.000Z');
  });

  it('returns null when no recognised key is present', () => {
    expect(extractCreatedAt({ foo: 'bar' })).toBeNull();
  });

  it('returns null when the value is not parseable', () => {
    expect(extractCreatedAt({ created_at: 'not a date' })).toBeNull();
  });

  it('accepts numeric epoch milliseconds', () => {
    const epoch = Date.UTC(2026, 3, 20, 12, 0, 0);
    const out = extractCreatedAt({ created_at: epoch });
    expect(out!.getTime()).toBe(epoch);
  });
});

describe('formatLocalDate', () => {
  it('produces YYYY-MM-DD with zero padding', () => {
    const d = new Date(2026, 0, 5); // 5 Jan 2026 local
    expect(formatLocalDate(d)).toBe('2026-01-05');
  });
});

describe('bucketByDate', () => {
  // Pin "now" to a stable local-time value to make all assertions
  // deterministic regardless of the host TZ.
  const now = new Date(2026, 3, 20, 12, 0, 0); // 20 Apr 2026 noon local

  function rec(id: string, status: RunStatRecord['status'], date: Date | null): RunStatRecord {
    return { id, status, durationMs: 0, createdAt: date };
  }

  it('returns one zero-bucket per day in the window when input is empty', () => {
    const { buckets, undatedCount } = bucketByDate([], 3, now);

    expect(buckets).toHaveLength(3);
    expect(buckets.every((b) => b.total === 0)).toBe(true);
    expect(undatedCount).toBe(0);
    expect(buckets[0].date < buckets[1].date).toBe(true);
    expect(buckets[buckets.length - 1].date).toBe('2026-04-20');
  });

  it('counts succeeded / failed / inFlight per bucket', () => {
    const records: RunStatRecord[] = [
      rec('a', 'SUCCEEDED', new Date(2026, 3, 20, 9, 0, 0)),
      rec('b', 'SUCCEEDED', new Date(2026, 3, 20, 10, 0, 0)),
      rec('c', 'FAILED', new Date(2026, 3, 20, 11, 0, 0)),
      rec('d', 'INPROGRESS', new Date(2026, 3, 19, 15, 0, 0)),
      rec('e', 'QUEUED', new Date(2026, 3, 19, 16, 0, 0)),
    ];

    const { buckets } = bucketByDate(records, 3, now);
    const today = buckets.find((b) => b.date === '2026-04-20')!;
    const yesterday = buckets.find((b) => b.date === '2026-04-19')!;

    expect(today.total).toBe(3);
    expect(today.succeeded).toBe(2);
    expect(today.failed).toBe(1);
    expect(today.inFlight).toBe(0);

    expect(yesterday.total).toBe(2);
    expect(yesterday.inFlight).toBe(2);
  });

  it('drops records older than the window cutoff', () => {
    const records: RunStatRecord[] = [
      rec('old', 'SUCCEEDED', new Date(2026, 3, 1, 10, 0, 0)), // 19 days ago
      rec('inWindow', 'SUCCEEDED', new Date(2026, 3, 20, 10, 0, 0)),
    ];

    const { buckets } = bucketByDate(records, 3, now);
    const total = buckets.reduce((acc, b) => acc + b.total, 0);

    expect(total).toBe(1);
  });

  it('counts undated records via undatedCount and excludes them from buckets', () => {
    const records: RunStatRecord[] = [
      rec('a', 'SUCCEEDED', null),
      rec('b', 'FAILED', null),
      rec('c', 'SUCCEEDED', new Date(2026, 3, 20, 10, 0, 0)),
    ];

    const { buckets, undatedCount } = bucketByDate(records, 3, now);
    const total = buckets.reduce((acc, b) => acc + b.total, 0);

    expect(undatedCount).toBe(2);
    expect(total).toBe(1);
  });

  it('sorts buckets ascending by date', () => {
    const { buckets } = bucketByDate([], 5, now);
    const dates = buckets.map((b) => b.date);
    expect(dates).toEqual([...dates].sort());
  });
});

describe('successRate', () => {
  function bucket(succeeded: number, failed: number, inFlight = 0) {
    return {
      date: '2026-04-20',
      total: succeeded + failed + inFlight,
      succeeded,
      failed,
      inFlight,
    };
  }

  it('returns 0 when no terminal runs are present', () => {
    expect(successRate([])).toBe(0);
    expect(successRate([bucket(0, 0, 5)])).toBe(0);
  });

  it('returns 1 when all terminal runs succeeded', () => {
    expect(successRate([bucket(3, 0)])).toBe(1);
  });

  it('returns 0 when all terminal runs failed', () => {
    expect(successRate([bucket(0, 4)])).toBe(0);
  });

  it('computes the ratio across multiple buckets', () => {
    expect(successRate([bucket(3, 1), bucket(1, 0)])).toBe(0.8);
  });

  it('ignores in-flight runs in the denominator', () => {
    expect(successRate([bucket(2, 0, 10)])).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// RunStatsService
// ---------------------------------------------------------------------------

describe('RunStatsService', () => {
  let cli: ReturnType<typeof createMockCli>;
  let service: RunStatsService;

  beforeEach(() => {
    vi.clearAllMocks();
    cli = createMockCli();
    service = new RunStatsService(cli);
  });

  it('rejects non-positive windowDays', async () => {
    await expect(service.computeSummary(0)).rejects.toThrow(/windowDays/);
    await expect(service.computeSummary(-1)).rejects.toThrow(/windowDays/);
    await expect(service.computeSummary(Number.NaN)).rejects.toThrow(/windowDays/);
  });

  it('returns a zero-summary when the run list is empty', async () => {
    cli.runList.mockResolvedValue({ items: [] });

    const summary = await service.computeSummary(7);

    expect(summary.totalRuns).toBe(0);
    expect(summary.successRate).toBe(0);
    expect(summary.buckets).toHaveLength(7);
    expect(summary.undatedCount).toBe(0);
    expect(cli.runGet).not.toHaveBeenCalled();
  });

  it('caches terminal runs and re-fetches non-terminal ones on subsequent calls', async () => {
    // List items without `status` force the runGet fallback path, which
    // is what the cache logic guards. The fast-path (status present in
    // the list payload) is covered by a dedicated test below.
    cli.runList.mockResolvedValue({
      items: [
        { id: 'r-success' },
        { id: 'r-running' },
      ] as unknown as { id: string; status: 'SUCCEEDED' | 'INPROGRESS' }[],
    });
    cli.runGet.mockImplementation(async (id: string) => {
      if (id === 'r-success') {
        return makeRunResult({
          runId: id,
          status: 'SUCCEEDED',
          raw: { created_at: '2026-04-20T08:00:00Z' },
        });
      }
      return makeRunResult({
        runId: id,
        status: 'INPROGRESS',
        raw: { created_at: '2026-04-20T09:00:00Z' },
      });
    });

    await service.computeSummary(7);
    await service.computeSummary(7);

    // r-success cached → runGet called only once for it.
    // r-running not cached → runGet called twice.
    const calls = cli.runGet.mock.calls.map((c) => c[0]);
    expect(calls.filter((id) => id === 'r-success')).toHaveLength(1);
    expect(calls.filter((id) => id === 'r-running')).toHaveLength(2);
  });

  it('invalidate() clears the entire cache when called without args', async () => {
    cli.runList.mockResolvedValue({
      items: [{ id: 'r-1' }] as unknown as { id: string; status: 'SUCCEEDED' }[],
    });
    cli.runGet.mockResolvedValue(
      makeRunResult({
        runId: 'r-1',
        status: 'SUCCEEDED',
        raw: { created_at: '2026-04-20T08:00:00Z' },
      }),
    );

    await service.computeSummary(7);
    service.invalidate();
    await service.computeSummary(7);

    expect(cli.runGet).toHaveBeenCalledTimes(2);
  });

  it('invalidate(runId) drops only the targeted entry', async () => {
    cli.runList.mockResolvedValue({
      items: [
        { id: 'r-keep' },
        { id: 'r-drop' },
      ] as unknown as { id: string; status: 'SUCCEEDED' }[],
    });
    cli.runGet.mockImplementation(async (id: string) =>
      makeRunResult({
        runId: id,
        status: 'SUCCEEDED',
        raw: { created_at: '2026-04-20T08:00:00Z' },
      }),
    );

    await service.computeSummary(7);
    service.invalidate('r-drop');
    await service.computeSummary(7);

    const calls = cli.runGet.mock.calls.map((c) => c[0]);
    expect(calls.filter((id) => id === 'r-keep')).toHaveLength(1);
    expect(calls.filter((id) => id === 'r-drop')).toHaveLength(2);
  });

  it('aggregates undated runs into undatedCount', async () => {
    cli.runList.mockResolvedValue({
      items: [{ id: 'r-1' }] as unknown as { id: string; status: 'SUCCEEDED' }[],
    });
    cli.runGet.mockResolvedValue(
      makeRunResult({ runId: 'r-1', status: 'SUCCEEDED', raw: { foo: 'bar' } }),
    );

    const summary = await service.computeSummary(7);

    expect(summary.undatedCount).toBe(1);
    expect(summary.totalRuns).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Bug-fix coverage: the dashboard previously hung 90s because runStats
  // fanned-out one `runGet` per list item. The Warp CLI already exposes
  // status (`state`) and `created_at` in the list payload, so we now use
  // those directly and only fall back to runGet when essential fields are
  // missing. These tests pin the new behaviour.
  // -------------------------------------------------------------------------

  it('uses status/createdAt from list items when available (no runGet fan-out)', async () => {
    cli.runList.mockResolvedValue({
      items: [
        { run_id: 'r-1', state: 'SUCCEEDED', created_at: '2026-04-20T08:00:00Z' },
        { run_id: 'r-2', state: 'FAILED', created_at: '2026-04-20T09:00:00Z' },
        { id: 'r-3', status: 'INPROGRESS', createdAt: '2026-04-20T10:00:00Z' },
      ] as unknown as { id: string; status: 'SUCCEEDED' }[],
    });

    const summary = await service.computeSummary(30);

    expect(cli.runGet).not.toHaveBeenCalled();
    expect(summary.totalRuns).toBe(3);
  });

  it('skips list entries without an id (envelope or malformed records)', async () => {
    cli.runList.mockResolvedValue({
      items: [
        { page_info: { has_next_page: false } },
        { run_id: 'r-1', state: 'SUCCEEDED', created_at: '2026-04-20T08:00:00Z' },
      ] as unknown as { id: string; status: 'SUCCEEDED' }[],
    });

    const summary = await service.computeSummary(30);

    expect(cli.runGet).not.toHaveBeenCalled();
    expect(summary.totalRuns).toBe(1);
  });

  it('continues when a per-record runGet fails instead of aborting the dashboard', async () => {
    cli.runList.mockResolvedValue({
      items: [
        { id: 'r-bad' },
        { id: 'r-good' },
      ] as unknown as { id: string; status: 'SUCCEEDED' }[],
    });
    cli.runGet.mockImplementation(async (id: string) => {
      if (id === 'r-bad') {
        throw new Error('produced no output for 90s');
      }
      return makeRunResult({
        runId: id,
        status: 'SUCCEEDED',
        raw: { created_at: '2026-04-20T08:00:00Z' },
      });
    });

    const summary = await service.computeSummary(30);

    expect(summary.totalRuns).toBe(1);
  });
});
