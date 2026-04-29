import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ActiveRunsTracker } from '../../src/services/activeRunsTracker.js';
import { createMockCli, makeListResult } from '../helpers.js';
import type { OzRunStatus } from '../../src/types/index.js';

describe('ActiveRunsTracker overlap audit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not overlap concurrent runList ticks when CLI is slower than the interval', async () => {
    const cli = createMockCli();
    let inFlight = 0;
    let maxInFlight = 0;

    cli.runList.mockImplementation(() => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve) => {
        setTimeout(() => {
          inFlight -= 1;
          resolve(makeListResult<{ id: string; status: OzRunStatus }>([]));
        }, 60);
      });
    });

    const tracker = new ActiveRunsTracker(cli, 20);
    tracker.start();

    await vi.advanceTimersByTimeAsync(220);
    tracker.dispose();

    expect(maxInFlight).toBe(1);
  });
});
