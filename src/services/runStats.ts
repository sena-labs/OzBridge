import {
  IOzCliService,
  OzRunResult,
  OzRunStatus,
} from '../types/index.js';

/**
 * Normalised record produced by {@link RunStatsService} from a single
 * Oz run. Pure data — no `vscode` dependency, fully serialisable.
 */
export interface RunStatRecord {
  /** Run identifier. */
  id: string;
  /** Terminal or in-flight status. */
  status: OzRunStatus;
  /** Wall-clock duration in milliseconds (0 when unknown). */
  durationMs: number;
  /**
   * Best-effort creation timestamp extracted from the raw CLI payload
   * (looks for `created_at` / `createdAt` / `started_at`). `null` when
   * no field could be parsed.
   */
  createdAt: Date | null;
}

/** One day's bucket in a {@link RunStatsSummary}. */
export interface RunStatsBucket {
  /** ISO date in workspace local time, `YYYY-MM-DD`. */
  date: string;
  /** Total runs created on this date (regardless of status). */
  total: number;
  /** Runs in `SUCCEEDED` terminal state. */
  succeeded: number;
  /** Runs in `FAILED` terminal state. */
  failed: number;
  /** Runs still in `QUEUED` or `INPROGRESS`. */
  inFlight: number;
}

/** High-level summary returned by {@link IRunStatsService.computeSummary}. */
export interface RunStatsSummary {
  /** Window size in days requested by the caller. */
  windowDays: number;
  /** Total runs covered by `buckets` (matches the sum of `total`). */
  totalRuns: number;
  /**
   * Success rate across the window, in `[0, 1]`. Defined as
   * `succeeded / (succeeded + failed)`. `0` when no terminal runs are
   * present (avoids spurious 100% on an in-flight-only history).
   */
  successRate: number;
  /** Per-day buckets, ordered ascending by `date`. */
  buckets: RunStatsBucket[];
  /** Records dropped because no creation timestamp could be parsed. */
  undatedCount: number;
}

/** Aggregates run history into a dashboard-ready summary. */
export interface IRunStatsService {
  /** Returns an aggregated summary for the last `windowDays` days. */
  computeSummary(windowDays: number): Promise<RunStatsSummary>;
  /** Drops cached entries (all, or one by id). */
  invalidate(runId?: string): void;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES: ReadonlySet<OzRunStatus> = new Set(['SUCCEEDED', 'FAILED']);

/** True when the status is final and the record can be cached forever. */
export function isTerminalStatus(status: OzRunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Best-effort extraction of a creation timestamp from a raw CLI
 * payload. Recognises the common snake_case and camelCase variants and
 * returns `null` when nothing parseable is found.
 *
 * Exported for unit tests.
 */
export function extractCreatedAt(raw: unknown): Date | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  for (const key of ['created_at', 'createdAt', 'started_at', 'startedAt']) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }
  return null;
}

/** Formats a `Date` as `YYYY-MM-DD` in **local** time (workspace TZ). */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Buckets records by local-time date. Records without a `createdAt`
 * are skipped and counted via the returned `undatedCount`. Records
 * older than the window cutoff are also skipped silently.
 */
export function bucketByDate(
  records: ReadonlyArray<RunStatRecord>,
  windowDays: number,
  now: Date = new Date(),
): { buckets: RunStatsBucket[]; undatedCount: number } {
  const map = new Map<string, RunStatsBucket>();

  // Pre-seed the window so missing days appear as zero buckets.
  // IMPL: lavoriamo in millisecondi local-time per evitare drift su DST.
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (windowDays - 1));

  for (let offset = 0; offset < windowDays; offset++) {
    const day = new Date(cutoff);
    day.setDate(cutoff.getDate() + offset);
    const key = formatLocalDate(day);
    map.set(key, { date: key, total: 0, succeeded: 0, failed: 0, inFlight: 0 });
  }

  let undated = 0;
  for (const rec of records) {
    if (!rec.createdAt) {
      undated++;
      continue;
    }
    if (rec.createdAt.getTime() < cutoff.getTime()) {
      continue;
    }
    const key = formatLocalDate(rec.createdAt);
    const bucket = map.get(key);
    if (!bucket) {
      continue;
    }
    bucket.total++;
    if (rec.status === 'SUCCEEDED') {
      bucket.succeeded++;
    } else if (rec.status === 'FAILED') {
      bucket.failed++;
    } else {
      bucket.inFlight++;
    }
  }

  return {
    buckets: Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date)),
    undatedCount: undated,
  };
}

/**
 * Computes the success rate across the buckets as
 * `sum(succeeded) / sum(succeeded + failed)`. Returns `0` when no
 * terminal runs are present.
 */
export function successRate(buckets: ReadonlyArray<RunStatsBucket>): number {
  let succeeded = 0;
  let failed = 0;
  for (const b of buckets) {
    succeeded += b.succeeded;
    failed += b.failed;
  }
  const denom = succeeded + failed;
  return denom === 0 ? 0 : succeeded / denom;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Default {@link IRunStatsService}.
 *
 * Strategy:
 * - Calls `IOzCliService.runList()` to enumerate run ids.
 * - For each id, calls `IOzCliService.runGet()` to obtain status,
 *   duration and the raw payload (used to extract `createdAt`).
 * - Caches normalised records for runs in **terminal** state forever
 *   (immutable). Non-terminal records are never cached so refreshes
 *   always pick up status transitions.
 * - Aggregates via {@link bucketByDate} + {@link successRate}.
 */
export class RunStatsService implements IRunStatsService {
  private readonly cache = new Map<string, RunStatRecord>();

  constructor(private readonly cli: IOzCliService) {}

  async computeSummary(windowDays: number): Promise<RunStatsSummary> {
    if (!Number.isFinite(windowDays) || windowDays <= 0) {
      throw new Error(`windowDays must be a positive number, got ${String(windowDays)}`);
    }

    const list = await this.cli.runList();
    const records: RunStatRecord[] = [];

    for (const item of list.items) {
      const cached = this.cache.get(item.id);
      if (cached) {
        records.push(cached);
        continue;
      }
      const detail = await this.cli.runGet(item.id);
      const record = this.normalize(item.id, detail);
      if (isTerminalStatus(record.status)) {
        this.cache.set(record.id, record);
      }
      records.push(record);
    }

    const { buckets, undatedCount } = bucketByDate(records, windowDays);
    const totalRuns = buckets.reduce((acc, b) => acc + b.total, 0);

    return {
      windowDays,
      totalRuns,
      successRate: successRate(buckets),
      buckets,
      undatedCount,
    };
  }

  invalidate(runId?: string): void {
    if (runId === undefined) {
      this.cache.clear();
      return;
    }
    this.cache.delete(runId);
  }

  private normalize(id: string, detail: OzRunResult): RunStatRecord {
    return {
      id,
      status: detail.status,
      durationMs: Number.isFinite(detail.durationMs) ? detail.durationMs : 0,
      createdAt: extractCreatedAt(detail.raw),
    };
  }
}
