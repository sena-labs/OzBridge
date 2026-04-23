import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StatusBarManager } from '../../src/ui/statusBarItem.js';
import type { ActiveRunsTracker, TrackedRun } from '../../src/services/activeRunsTracker.js';
import * as vscodeMock from '../mocks/vscode.js';

/**
 * Builds a minimal tracker stub whose `onDidChange` / `onDidError` can be
 * driven explicitly by tests.
 */
function makeTracker(): {
  tracker: ActiveRunsTracker;
  fireChange: (runs: TrackedRun[]) => void;
  fireError: (err: unknown) => void;
} {
  const changeEmitter = new vscodeMock.EventEmitter<TrackedRun[]>();
  const errorEmitter = new vscodeMock.EventEmitter<unknown>();

  const tracker = {
    onDidChange: changeEmitter.event,
    onDidError: errorEmitter.event,
    latest: [] as TrackedRun[],
    start: vi.fn(),
    stop: vi.fn(),
    refresh: vi.fn(),
    dispose: vi.fn(),
  } as unknown as ActiveRunsTracker;

  return {
    tracker,
    fireChange: (runs) => changeEmitter.fire(runs),
    fireError: (err) => errorEmitter.fire(err),
  };
}

beforeEach(() => {
  vscodeMock.window.createStatusBarItem.mockClear();
});

describe('StatusBarManager', () => {
  it('creates a right-aligned status bar item with FOCUS_COMMAND as click handler', () => {
    const { tracker } = makeTracker();
    const manager = new StatusBarManager(tracker);

    expect(vscodeMock.window.createStatusBarItem).toHaveBeenCalledTimes(1);
    const item = manager.statusBarItem as any;
    expect(item.alignment).toBe(vscodeMock.StatusBarAlignment.Right);
    expect(item.priority).toBe(100);
    expect(item.command).toBe(StatusBarManager.FOCUS_COMMAND);
    expect(item.name).toBe('OzBridge');
    expect(item.show).toHaveBeenCalledTimes(1);
    expect(item.text).toBe('$(cloud) OzBridge: 0 active');
    expect(item.backgroundColor).toBeUndefined();
  });

  it('renders the active count and tooltip on tracker change (0 active → idle)', () => {
    const { tracker, fireChange } = makeTracker();
    const manager = new StatusBarManager(tracker);

    fireChange([
      { id: 'r1', status: 'SUCCEEDED' },
      { id: 'r2', status: 'FAILED' },
    ]);

    const item = manager.statusBarItem as any;
    expect(item.text).toBe('$(cloud) OzBridge: 0 active');
    expect(item.backgroundColor).toBeUndefined();
    expect((item.tooltip as any).value).toContain('r1');
    expect((item.tooltip as any).value).toContain('r2');
  });

  it('uses warning background for 1-2 active runs', () => {
    const { tracker, fireChange } = makeTracker();
    const manager = new StatusBarManager(tracker);

    fireChange([
      { id: 'r1', status: 'QUEUED' },
      { id: 'r2', status: 'SUCCEEDED' },
    ]);

    const item = manager.statusBarItem as any;
    expect(item.text).toBe('$(cloud) OzBridge: 1 active');
    expect(item.backgroundColor).toBeInstanceOf(vscodeMock.ThemeColor);
    expect(item.backgroundColor.id).toBe('statusBarItem.warningBackground');
  });

  it('uses error background for 3+ active runs', () => {
    const { tracker, fireChange } = makeTracker();
    const manager = new StatusBarManager(tracker);

    fireChange([
      { id: 'r1', status: 'QUEUED' },
      { id: 'r2', status: 'INPROGRESS' },
      { id: 'r3', status: 'INPROGRESS' },
    ]);

    const item = manager.statusBarItem as any;
    expect(item.text).toBe('$(cloud) OzBridge: 3 active');
    expect(item.backgroundColor.id).toBe('statusBarItem.errorBackground');
  });

  it('switches to the unavailable indicator when tracker fires onDidError', () => {
    const { tracker, fireError } = makeTracker();
    const manager = new StatusBarManager(tracker);

    fireError(new Error('oz missing'));

    const item = manager.statusBarItem as any;
    expect(item.text).toContain('unavailable');
    expect(item.backgroundColor.id).toBe('statusBarItem.errorBackground');
    expect(item.tooltip).toContain('unable to list runs');
  });

  it('dispose() releases the item', () => {
    const { tracker } = makeTracker();
    const manager = new StatusBarManager(tracker);
    const item = manager.statusBarItem as any;
    manager.dispose();
    expect(item.dispose).toHaveBeenCalled();
  });
});
