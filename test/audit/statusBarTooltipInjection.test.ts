import { describe, it, expect } from 'vitest';
import { StatusBarManager } from '../../src/ui/statusBarItem.js';
import * as vscodeMock from '../mocks/vscode.js';
import type { ActiveRunsTracker, TrackedRun } from '../../src/services/activeRunsTracker.js';

function makeTracker(): {
  tracker: ActiveRunsTracker;
  fireChange: (runs: TrackedRun[]) => void;
} {
  const changeEmitter = new vscodeMock.EventEmitter<TrackedRun[]>();
  const errorEmitter = new vscodeMock.EventEmitter<unknown>();

  const tracker = {
    onDidChange: changeEmitter.event,
    onDidError: errorEmitter.event,
    latest: [] as TrackedRun[],
    start: () => undefined,
    stop: () => undefined,
    refresh: async () => undefined,
    dispose: () => undefined,
  } as unknown as ActiveRunsTracker;

  return {
    tracker,
    fireChange: (runs) => changeEmitter.fire(runs),
  };
}

describe('Status bar tooltip injection audit', () => {
  it('does not mark tooltip markdown as trusted when run ids are displayed', () => {
    const { tracker, fireChange } = makeTracker();
    const manager = new StatusBarManager(tracker);

    fireChange([{ id: 'abc` [x](command:evil)', status: 'INPROGRESS' }]);

    const item = manager.statusBarItem as unknown as { tooltip?: vscodeMock.MarkdownString };
    expect(item.tooltip).toBeInstanceOf(vscodeMock.MarkdownString);
    expect((item.tooltip as vscodeMock.MarkdownString).isTrusted).not.toBe(true);

    manager.dispose();
  });
});
