import * as vscode from 'vscode';
import { IOzCliService, OzRunStatus } from '../types/index.js';

/** A single entry as returned by {@link IOzCliService.runList}. */
export interface TrackedRun {
  id: string;
  status: OzRunStatus;
}

/**
 * Periodically polls `oz run list` and emits events whenever the set of runs
 * changes or when a polling error occurs. Used by the Status Bar indicator
 * and by the sidebar {@link import('../ui/runsTreeProvider.js').WarpRunsTreeProvider}.
 *
 * The tracker is intentionally decoupled from {@link BaseRunPoller}, which
 * exists to poll a single run until terminal state. Here we poll the full
 * list on a fixed cadence to keep activity surfaces live without assuming a
 * specific run id.
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
  private last: TrackedRun[] = [];

  constructor(
    private readonly cli: IOzCliService,
    private readonly intervalMs: number = 10_000,
  ) {}

  /** Most recent snapshot returned by the CLI. */
  get latest(): ReadonlyArray<TrackedRun> {
    return this.last;
  }

  /**
   * Starts periodic polling. Calling `start()` again is a no-op; to change the
   * interval, dispose and re-create the tracker.
   */
  start(): void {
    if (this.timer || this.disposed) {
      return;
    }
    // Fire an immediate tick so consumers get data without waiting a full interval.
    void this.tick();
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
  }

  /** Stops polling. The tracker can be restarted with {@link start}. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Manually triggers a poll (e.g. from a user-driven `Refresh` command). */
  async refresh(): Promise<void> {
    await this.tick();
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
      const next: TrackedRun[] = result.items.map((r) => ({ id: r.id, status: r.status }));
      if (!sameList(next, this.last)) {
        this.last = next;
        this._onDidChange.fire(next);
      }
    } catch (err) {
      this._onDidError.fire(err);
    }
  }
}

function sameList(a: ReadonlyArray<TrackedRun>, b: ReadonlyArray<TrackedRun>): boolean {
  if (a.length !== b.length) { return false; }
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].status !== b[i].status) { return false; }
  }
  return true;
}
