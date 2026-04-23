import * as vscode from 'vscode';
import { IOzCliService, OzRunStatus } from '../types/index.js';

/** A single entry as returned by {@link IOzCliService.runList}. */
export interface TrackedRun {
  id: string;
  status: OzRunStatus;
}

/** Terminal run statuses — a run in these states will never change status again. */
const TERMINAL_STATUSES = new Set<OzRunStatus>(['SUCCEEDED', 'FAILED']);

/**
 * Periodically polls `oz run list` and emits events whenever the set of runs
 * changes or when a polling error occurs. Used by the Status Bar indicator
 * and by the sidebar {@link import('../ui/runsTreeProvider.js').OzRunsTreeProvider}.
 *
 * The tracker is intentionally decoupled from {@link BaseRunPoller}, which
 * exists to poll a single run until terminal state. Here we poll the full
 * list on a fixed cadence to keep activity surfaces live without assuming a
 * specific run id.
 *
 * ### Sticky overrides
 * Call {@link markRunStatus} to immediately reflect a known terminal status
 * (e.g. from the cloud-command poller) without waiting for the next `runList`
 * poll cycle. The override is removed once the CLI snapshot itself reports a
 * terminal status for the same run id, or when {@link clearOverride} is called.
 *
 * ### ID normalisation
 * All run ids are normalised to lower-case so that the UUID returned by the
 * CLI banner (`Spawned ambient agent with run ID: <UUID>`) always matches the
 * corresponding entry in `oz run list`, regardless of the case used by each
 * source.
 */
export class ActiveRunsTracker implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<TrackedRun[]>();
  /** Fires with the latest list whenever it changes (or on the first tick). */
  readonly onDidChange = this._onDidChange.event;

  private readonly _onDidError = new vscode.EventEmitter<unknown>();
  /** Fires when a polling iteration throws; the tracker keeps running. */
  readonly onDidError = this._onDidError.event;

  private timer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;
  private starting = false;  // Guard flag to prevent multiple start() calls from running concurrently
  private inFlight: Promise<void> | undefined;
  /** Last raw CLI snapshot (lower-cased ids). */
  private lastCli: TrackedRun[] = [];
  /** Merged view: CLI snapshot + sticky overrides (exposed via {@link latest}). */
  private last: TrackedRun[] = [];
  /**
   * Sticky status overrides keyed by normalised (lower-case) run id.
   * These are applied on top of the CLI snapshot until the CLI itself
   * reports a terminal status for the same id.
   */
  private readonly stickyOverrides = new Map<string, OzRunStatus>();

  constructor(
    private readonly cli: IOzCliService,
    private readonly intervalMs: number = 10_000,
  ) {}

  /** Most recent merged snapshot (CLI + sticky overrides). */
  get latest(): ReadonlyArray<TrackedRun> {
    return this.last;
  }

  /**
   * Immediately overrides the status of a run in the tracker's merged view
   * and fires {@link onDidChange}.
   *
   * Used by the cloud-command poller so the sidebar reflects a terminal status
   * without waiting up to {@link intervalMs} for the next `oz run list` poll.
   *
   * The override persists until the CLI's own `runList` snapshot reports a
   * terminal status for `runId`, at which point it is automatically removed.
   *
   * @param runId - Run identifier (case-insensitive; normalised to lower-case internally).
   * @param status - The status to apply immediately.
   */
  markRunStatus(runId: string, status: OzRunStatus): void {
    if (this.disposed) { return; }
    const id = runId.toLowerCase();
    this.stickyOverrides.set(id, status);
    const merged = this.applyOverrides(this.lastCli);
    this.last = merged;
    this._onDidChange.fire([...merged]);
  }

  /**
   * Removes a sticky override without firing a change event.
   * Prefer letting {@link tick} clean up overrides automatically via
   * terminal-status detection from the CLI snapshot.
   */
  clearOverride(runId: string): void {
    this.stickyOverrides.delete(runId.toLowerCase());
  }

  /**
   * Starts periodic polling. Calling `start()` again is a no-op; to change the
   * interval, dispose and re-create the tracker.
   */
  start(): void {
    // Check all guard conditions - disposed, already started, or currently starting
    if (this.disposed || this.timer || this.starting) {
      return;
    }
    // Set flag to prevent concurrent start() calls
    this.starting = true;

    // Fire an immediate tick so consumers get data without waiting a full interval.
    // Then start the interval only if not disposed after the tick completes.
    this.inFlight = this.tick();
    void this.inFlight.then(() => {
      // Clear starting flag
      this.starting = false;
      this.inFlight = undefined;
      // Re-check disposed state after async tick completes to prevent race condition
      // where dispose() is called while tick() is in progress
      if (!this.disposed && !this.timer) {
        this.timer = setInterval(() => {
          if (this.inFlight) { return; }
          this.inFlight = this.tick().finally(() => {
            this.inFlight = undefined;
          });
        }, this.intervalMs);
      }
    }).catch(() => {
      // tick() already emits errors via onDidError, just prevent unhandled rejection
      this.starting = false;
      this.inFlight = undefined;
    });
  }

  /** Stops polling. The tracker can be restarted with {@link start}. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    // Also clear starting flag in case stop() is called while start() is in progress
    this.starting = false;
    this.inFlight = undefined;
  }

  /** Manually triggers a poll (e.g. from a user-driven `Refresh` command). */
  async refresh(): Promise<void> {
    if (this.inFlight) {
      await this.inFlight;
      return;
    }
    this.inFlight = this.tick().finally(() => {
      this.inFlight = undefined;
    });
    await this.inFlight;
  }

  dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true;
    this.stop();
    this._onDidChange.dispose();
    this._onDidError.dispose();
  }

  private async tick(): Promise<void> {
    if (this.disposed) { return; }
    try {
      const result = await this.cli.runList();
      // Normalise all ids to lower-case so they match banner-extracted UUIDs.
      // Filter out any runs with invalid IDs
      const cliRuns: TrackedRun[] = result.items
        .filter((r) => r.id && typeof r.id === 'string' && r.id.length > 0)
        .map((r) => ({
          id: r.id.toLowerCase(),
          status: r.status,
        }));
      this.lastCli = cliRuns;

      // Remove stale overrides: once the CLI reports a terminal status for a
      // run we no longer need the synthetic entry — the CLI source is now
      // authoritative.
      // Build a Map for O(1) lookups instead of O(n) find() in loop
      const cliRunsById = new Map(cliRuns.map((r) => [r.id, r]));
      for (const [id] of this.stickyOverrides) {
        const cliRun = cliRunsById.get(id);
        if (cliRun && TERMINAL_STATUSES.has(cliRun.status)) {
          this.stickyOverrides.delete(id);
        }
      }

      const next = this.applyOverrides(cliRuns);
      if (!sameList(next, this.last)) {
        this.last = next;
        this._onDidChange.fire([...next]);
      }
    } catch (err) {
      this._onDidError.fire(err);
    }
  }

  /**
   * Merges the CLI snapshot with the sticky overrides.
   *
   * - For runs present in both, the override status wins.
   * - Runs only in the overrides map (not yet visible in `oz run list`) are
   *   appended as synthetic entries so the sidebar shows them immediately.
   */
  private applyOverrides(cliRuns: TrackedRun[]): TrackedRun[] {
    const merged: TrackedRun[] = cliRuns.map((r) => {
      const override = this.stickyOverrides.get(r.id);
      return override ? { id: r.id, status: override } : r;
    });

    // Append synthetic entries for runs only known via sticky overrides.
    for (const [id, status] of this.stickyOverrides) {
      if (!merged.some((r) => r.id === id)) {
        merged.push({ id, status });
      }
    }

    return merged;
  }
}

function sameList(a: ReadonlyArray<TrackedRun>, b: ReadonlyArray<TrackedRun>): boolean {
  if (a.length !== b.length) { return false; }
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].status !== b[i].status) { return false; }
  }
  return true;
}
