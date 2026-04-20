import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ActiveRunsTracker, TrackedRun } from '../../src/services/activeRunsTracker.js';
import type { OzRunStatus } from '../../src/types/index.js';
import { createMockCli, makeListResult } from '../helpers.js';

let cli: ReturnType<typeof createMockCli>;

beforeEach(() => {
  vi.useFakeTimers();
  cli = createMockCli();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ActiveRunsTracker', () => {
  it('fires onDidChange on the initial tick with the parsed list', async () => {
    cli.runList.mockResolvedValue(
      makeListResult<{ id: string; status: OzRunStatus }>([{ id: 'r1', status: 'QUEUED' }]),
    );

    const tracker = new ActiveRunsTracker(cli, 5_000);
    const received: TrackedRun[][] = [];
    tracker.onDidChange((runs) => received.push([...runs]));

    tracker.start();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(received.length).toBe(1);
    expect(received[0]).toEqual([{ id: 'r1', status: 'QUEUED' }]);
    expect(tracker.latest).toEqual([{ id: 'r1', status: 'QUEUED' }]);
  });

  it('does not fire when the snapshot is unchanged', async () => {
    cli.runList.mockResolvedValue(
      makeListResult<{ id: string; status: OzRunStatus }>([{ id: 'r1', status: 'INPROGRESS' }]),
    );

    const tracker = new ActiveRunsTracker(cli, 1_000);
    const fired = vi.fn();
    tracker.onDidChange(fired);

    tracker.start();
    await vi.runOnlyPendingTimersAsync();

    // Second tick — same result from CLI → must NOT fire again.
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();

    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('emits onDidError when runList throws and keeps polling', async () => {
    cli.runList
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(
        makeListResult<{ id: string; status: OzRunStatus }>([{ id: 'r2', status: 'SUCCEEDED' }]),
      );

    const tracker = new ActiveRunsTracker(cli, 1_000);
    const errors: unknown[] = [];
    const changes: TrackedRun[][] = [];
    tracker.onDidError((e) => errors.push(e));
    tracker.onDidChange((r) => changes.push([...r]));

    tracker.start();
    await vi.runOnlyPendingTimersAsync();

    expect(errors.length).toBe(1);
    expect(errors[0]).toBeInstanceOf(Error);

    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();

    expect(changes).toEqual([[{ id: 'r2', status: 'SUCCEEDED' }]]);
  });

  it('refresh() triggers an immediate poll without waiting for the interval', async () => {
    cli.runList.mockResolvedValue(
      makeListResult<{ id: string; status: OzRunStatus }>([{ id: 'r1', status: 'QUEUED' }]),
    );

    const tracker = new ActiveRunsTracker(cli, 60_000);
    // Don't start() — we only want refresh() to drive the poll.
    await tracker.refresh();

    expect(cli.runList).toHaveBeenCalledTimes(1);
    expect(tracker.latest).toEqual([{ id: 'r1', status: 'QUEUED' }]);
  });

  it('start() is idempotent', async () => {
    cli.runList.mockResolvedValue(makeListResult<{ id: string; status: OzRunStatus }>([]));

    // Baseline: start() called once — remember the final call count.
    const single = new ActiveRunsTracker(cli, 1_000);
    single.start();
    await vi.advanceTimersByTimeAsync(3_000);
    const baseline = cli.runList.mock.calls.length;
    single.dispose();

    cli.runList.mockClear();

    // Now start() three times on a fresh tracker: must match baseline exactly.
    const triple = new ActiveRunsTracker(cli, 1_000);
    triple.start();
    triple.start();
    triple.start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(cli.runList).toHaveBeenCalledTimes(baseline);
    triple.dispose();
  });

  it('dispose() stops polling and releases listeners', async () => {
    cli.runList.mockResolvedValue(makeListResult<{ id: string; status: OzRunStatus }>([]));

    const tracker = new ActiveRunsTracker(cli, 1_000);
    tracker.start();
    await vi.runOnlyPendingTimersAsync();

    tracker.dispose();
    const before = cli.runList.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(cli.runList).toHaveBeenCalledTimes(before);
  });
});
