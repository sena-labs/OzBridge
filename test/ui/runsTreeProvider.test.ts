import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OzRunsTreeProvider, OzTreeNode, RunTreeDragAndDropController, RUN_NODE_MIME_TYPE } from '../../src/ui/runsTreeProvider.js';
import type { ActiveRunsTracker, TrackedRun } from '../../src/services/activeRunsTracker.js';
import { createMockCli, makeListResult } from '../helpers.js';
import * as vscodeMock from '../mocks/vscode.js';

function makeTracker(initial: TrackedRun[] = []): {
  tracker: ActiveRunsTracker;
  fireChange: (runs: TrackedRun[]) => void;
  setLatest: (runs: TrackedRun[]) => void;
} {
  const changeEmitter = new vscodeMock.EventEmitter<TrackedRun[]>();
  const errorEmitter = new vscodeMock.EventEmitter<unknown>();
  let latest = initial;

  const tracker = {
    get latest() { return latest; },
    onDidChange: changeEmitter.event,
    onDidError: errorEmitter.event,
    start: vi.fn(),
    stop: vi.fn(),
    refresh: vi.fn(),
    dispose: vi.fn(),
  } as unknown as ActiveRunsTracker;

  return {
    tracker,
    fireChange: (runs) => { latest = runs; changeEmitter.fire(runs); },
    setLatest: (runs) => { latest = runs; },
  };
}

function findCategory(nodes: OzTreeNode[], category: string): OzTreeNode {
  const node = nodes.find((n) => n.kind === 'category' && n.category === category);
  if (!node) { throw new Error(`category ${category} not found`); }
  return node;
}

let cli: ReturnType<typeof createMockCli>;

beforeEach(() => {
  cli = createMockCli();
});

describe('OzRunsTreeProvider', () => {
  it('renders the 5 top-level categories with stable ids', async () => {
    const { tracker } = makeTracker();
    const provider = new OzRunsTreeProvider(cli, tracker);

    const roots = await provider.getChildren();
    const categoryIds = roots.map((n) => n.id);
    expect(categoryIds).toEqual([
      'category:activeRuns',
      'category:history',
      'category:schedules',
      'category:environments',
      'category:mcp',
      'category:secrets',
    ]);
  });

  it('Active Runs shows an empty message when there are none', async () => {
    const { tracker } = makeTracker();
    const provider = new OzRunsTreeProvider(cli, tracker);
    const node = findCategory(await provider.getChildren(), 'activeRuns');
    const children = await provider.getChildren(node);
    expect(children).toHaveLength(1);
    expect(children[0].kind).toBe('message');
    expect(children[0].label).toBe('No active runs');
  });

  it('Active Runs lists QUEUED + INPROGRESS runs', async () => {
    const { tracker } = makeTracker([
      { id: 'r1', status: 'QUEUED' },
      { id: 'r2', status: 'INPROGRESS' },
      { id: 'r3', status: 'SUCCEEDED' },
    ]);
    const provider = new OzRunsTreeProvider(cli, tracker);

    const node = findCategory(await provider.getChildren(), 'activeRuns');
    const children = await provider.getChildren(node);
    expect(children.map((c) => c.kind)).toEqual(['run', 'run']);
    expect(children.map((c) => (c as any).runId)).toEqual(['r1', 'r2']);
  });

  it('History shows SUCCEEDED + FAILED runs capped at HISTORY_LIMIT', async () => {
    const many: TrackedRun[] = Array.from({ length: 25 }, (_, i) => ({
      id: `r${i}`,
      status: 'SUCCEEDED' as const,
    }));
    const { tracker } = makeTracker(many);
    const provider = new OzRunsTreeProvider(cli, tracker);

    const node = findCategory(await provider.getChildren(), 'history');
    const children = await provider.getChildren(node);
    expect(children).toHaveLength(OzRunsTreeProvider.HISTORY_LIMIT);
  });

  it('Schedules category renders CLI results', async () => {
    cli.scheduleList.mockResolvedValue(
      makeListResult([
        { id: 's1', name: 'Daily', cron: '0 9 * * *', prompt: 'Do X', paused: false },
      ]),
    );
    const { tracker } = makeTracker();
    const provider = new OzRunsTreeProvider(cli, tracker);

    const node = findCategory(await provider.getChildren(), 'schedules');
    const children = await provider.getChildren(node);
    expect(children).toHaveLength(1);
    expect(children[0].kind).toBe('schedule');
    expect(children[0].label).toBe('Daily');
  });

  it('Schedules category renders an error node when CLI throws', async () => {
    cli.scheduleList.mockRejectedValue(new Error('no network'));
    const { tracker } = makeTracker();
    const provider = new OzRunsTreeProvider(cli, tracker);

    const node = findCategory(await provider.getChildren(), 'schedules');
    const children = await provider.getChildren(node);
    expect(children).toHaveLength(1);
    expect(children[0].kind).toBe('message');
    expect(children[0].label).toContain('no network');
  });

  it('MCP and Environments categories return empty messages on empty CLI lists', async () => {
    cli.mcpList.mockResolvedValue(makeListResult([]));
    cli.environmentList.mockResolvedValue(makeListResult([]));
    const { tracker } = makeTracker();
    const provider = new OzRunsTreeProvider(cli, tracker);

    const roots = await provider.getChildren();
    const mcpChildren = await provider.getChildren(findCategory(roots, 'mcp'));
    const envChildren = await provider.getChildren(findCategory(roots, 'environments'));

    expect(mcpChildren[0].label).toContain('No MCP servers');
    expect(envChildren[0].label).toContain('No environments');
  });

  it('fires onDidChangeTreeData when the tracker reports a change', () => {
    const { tracker, fireChange } = makeTracker();
    const provider = new OzRunsTreeProvider(cli, tracker);
    const fired = vi.fn();
    provider.onDidChangeTreeData(fired);

    fireChange([{ id: 'r1', status: 'QUEUED' }]);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('getTreeItem returns a TreeItem with the expected contextValue per node kind', async () => {
    const { tracker } = makeTracker([{ id: 'r1', status: 'QUEUED' }]);
    cli.scheduleList.mockResolvedValue(
      makeListResult([
        { id: 's1', name: 'Daily', cron: '0 9 * * *', prompt: 'Do X', paused: false },
        { id: 's2', name: 'Weekly', cron: '0 9 * * 1', prompt: 'Do Y', paused: true },
      ]),
    );
    const provider = new OzRunsTreeProvider(cli, tracker);

    const activeCategory = findCategory(await provider.getChildren(), 'activeRuns');
    const [runNode] = await provider.getChildren(activeCategory);
    expect(provider.getTreeItem(runNode).contextValue).toBe('warpRun:active');

    const scheduleCategory = findCategory(await provider.getChildren(), 'schedules');
    const [s1, s2] = await provider.getChildren(scheduleCategory);
    expect(provider.getTreeItem(s1).contextValue).toBe('warpSchedule:running');
    expect(provider.getTreeItem(s2).contextValue).toBe('warpSchedule:paused');
  });
});

// =============================================================================
// RunTreeDragAndDropController
// =============================================================================

describe('RunTreeDragAndDropController', () => {
  const mockRunNode = {
    kind: 'run' as const,
    id: 'run:abc',
    label: 'abc',
    runId: 'abc',
    status: 'SUCCEEDED' as const,
    active: false,
  };

  const mockCategoryNode = {
    kind: 'category' as const,
    id: 'category:history',
    label: 'History',
    category: 'history' as const,
  };

  const mockToken = {
    isCancellationRequested: false,
    onCancellationRequested: vi.fn(),
  };

  it('dovrebbe esporre dragMimeTypes con RUN_NODE_MIME_TYPE e text/plain', () => {
    const ctrl = new RunTreeDragAndDropController();
    expect(ctrl.dragMimeTypes).toContain(RUN_NODE_MIME_TYPE);
    expect(ctrl.dragMimeTypes).toContain('text/plain');
  });

  it('dovrebbe esporre dropMimeTypes come array vuoto', () => {
    const ctrl = new RunTreeDragAndDropController();
    expect(ctrl.dropMimeTypes).toEqual([]);
  });

  it('dovrebbe popolare DataTransfer con entrambi i MIME per RunNode items', () => {
    const ctrl = new RunTreeDragAndDropController();
    const dt = new vscodeMock.DataTransfer();
    ctrl.handleDrag([mockRunNode], dt as unknown as Parameters<typeof ctrl.handleDrag>[1], mockToken as never);
    expect(dt.get(RUN_NODE_MIME_TYPE)).toBeDefined();
    expect(dt.get('text/plain')).toBeDefined();
    // The internal MIME carries the JSON-serialised run-id array.
    expect(dt.get(RUN_NODE_MIME_TYPE)!.value).toBe(JSON.stringify([mockRunNode.runId]));
  });

  it('dovrebbe lasciare DataTransfer vuoto per nodi non-RunNode', () => {
    const ctrl = new RunTreeDragAndDropController();
    const dt = new vscodeMock.DataTransfer();
    ctrl.handleDrag([mockCategoryNode], dt as unknown as Parameters<typeof ctrl.handleDrag>[1], mockToken as never);
    expect(dt.get(RUN_NODE_MIME_TYPE)).toBeUndefined();
    expect(dt.get('text/plain')).toBeUndefined();
  });

  it('dovrebbe ignorare handleDrop senza lanciare (no-op)', () => {
    const ctrl = new RunTreeDragAndDropController();
    expect(() => ctrl.handleDrop()).not.toThrow();
  });
});
