import {
  IOzCliService,
  OzRunResult,
  OzRunStatus,
  isValidOzRunStatus,
} from '../types/index.js';
import { logWarn } from './logger.js';

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
  /**
   * Returns an aggregated summary for the last `windowDays` days.
   * `now` is injectable for deterministic testing; defaults to `new Date()`.
   */
  computeSummary(windowDays: number, now?: Date): Promise<RunStatsSummary>;
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

/**
 * Best-effort extraction of a run identifier from a list-item payload.
 * Recognises `id`, `run_id`, `runId`. Returns `undefined` when nothing
 * usable is present (envelope, malformed entry, ...).
 */
export function readId(raw: Record<string, unknown>): string | undefined {
  for (const key of ['id', 'run_id', 'runId']) {
    const value = raw[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * Best-effort extraction of a run status. Recognises `status` and the
 * Warp CLI's `state` field. Returns `undefined` when no field is
 * present so the caller can decide whether to fall back to `runGet`.
 */
export function readStatus(raw: Record<string, unknown>): OzRunStatus | undefined {
  for (const key of ['status', 'state']) {
    const value = raw[key];
    if (typeof value === 'string' && value.length > 0) {
      const upper = value.toUpperCase();
      return isValidOzRunStatus(upper) ? upper : 'UNKNOWN';
    }
  }
  return undefined;
}

/** Best-effort extraction of a wall-clock duration in milliseconds. */
export function readDurationMs(raw: Record<string, unknown>): number {
  for (const key of ['durationMs', 'duration_ms']) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
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

  async computeSummary(windowDays: number, now?: Date): Promise<RunStatsSummary> {
    if (!Number.isFinite(windowDays) || windowDays <= 0) {
      throw new Error(`windowDays must be a positive number, got ${String(windowDays)}`);
    }

    const list = await this.cli.runList();
    const records: RunStatRecord[] = [];

    // Bug-fix (dashboard 90s timeout): the dashboard previously fanned-out
    // one `oz run get <id>` per list item to obtain status / createdAt /
    // duration. On Windows that meant N additional CLI spawns through the
    // GUI-subsystem `warp.exe` shim, any one of which could hang for the
    // full per-call idle window (90s) and mask the entire dashboard.
    //
    // The CLI's `oz run list` payload already exposes the fields we need
    // (`run_id` / `id`, `state` / `status`, `created_at`...). We extract
    // them directly from each list item and only fall back to `runGet`
    // when an essential field is missing. Per-record failures are now
    // logged and skipped instead of aborting the whole summary.
    for (const item of list.items) {
      const itemRecord = item as unknown as Record<string, unknown>;
      const id = readId(itemRecord);
      if (!id) {
        // Not a real run record (e.g. envelope or malformed entry).
        continue;
      }

      const cached = this.cache.get(id);
      if (cached) {
        records.push(cached);
        continue;
      }

      let record: RunStatRecord | undefined;
      const directStatus = readStatus(itemRecord);
      const directCreatedAt = extractCreatedAt(itemRecord);
      const directDuration = readDurationMs(itemRecord);

      if (directStatus !== undefined) {
        record = {
          id,
          status: directStatus,
          durationMs: directDuration,
          createdAt: directCreatedAt,
        };
      } else {
        try {
          const detail = await this.cli.runGet(id);
          record = this.normalize(id, detail);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logWarn(`runStats: skipping run ${id} — ${message}`);
          continue;
        }
      }

      if (isTerminalStatus(record.status)) {
        this.cache.set(record.id, record);
      }
      records.push(record);
    }

    const { buckets, undatedCount } = bucketByDate(records, windowDays, now);
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
