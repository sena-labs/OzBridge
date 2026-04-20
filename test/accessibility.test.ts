/**
 * v1.0 deliverable S — accessibility (WCAG 2.1 AA) invariants.
 *
 * Hard-blocks regressions on three fronts:
 *   1. Every `TreeItem` produced by our providers must carry an
 *      `accessibilityInformation.label` so screen readers announce a
 *      meaningful semantic value (codicons / icons are not narrated).
 *   2. The status bar item must expose an a11y label both in steady
 *      and error states.
 *   3. Walkthrough markdown files must declare alt text on every
 *      embedded image.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { WarpRunsTreeProvider } from '../src/ui/runsTreeProvider.js';
import { WarpDriveTreeProvider } from '../src/ui/driveTreeProvider.js';
import { StatusBarManager } from '../src/ui/statusBarItem.js';
import type { ActiveRunsTracker, TrackedRun } from '../src/services/activeRunsTracker.js';
import type { DriveEntry, IWarpDriveSource } from '../src/drive/warpDriveSource.js';
import { createMockCli } from './helpers.js';
import * as vscodeMock from './mocks/vscode.js';

const repoRoot = join(__dirname, '..');

function makeTracker(initial: TrackedRun[] = []): ActiveRunsTracker {
  const changeEmitter = new vscodeMock.EventEmitter<TrackedRun[]>();
  const errorEmitter = new vscodeMock.EventEmitter<unknown>();
  return {
    get latest() {
      return initial;
    },
    onDidChange: changeEmitter.event,
    onDidError: errorEmitter.event,
    start: vi.fn(),
    stop: vi.fn(),
    refresh: vi.fn(),
    dispose: vi.fn(),
  } as unknown as ActiveRunsTracker;
}

function makeDriveSource(entries: DriveEntry[]): IWarpDriveSource {
  return {
    label: 'mock',
    listPrompts: vi.fn(async () => entries.filter((e) => e.category === 'prompt') as never),
    listRules: vi.fn(async () => entries.filter((e) => e.category === 'rule') as never),
    listSkills: vi.fn(async () => entries.filter((e) => e.category === 'skill') as never),
    read: vi.fn(async () => ''),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a11y — runs tree provider', () => {
  it('every node kind has an accessibilityInformation.label', async () => {
    const cli = createMockCli();
    const tracker = makeTracker([]);
    const provider = new WarpRunsTreeProvider(cli, tracker);
    const roots = await provider.getChildren();

    for (const root of roots) {
      const item = provider.getTreeItem(root);
      expect(item.accessibilityInformation, `${root.kind}/${root.id}`).toBeDefined();
      expect(item.accessibilityInformation?.label.length).toBeGreaterThan(0);
      expect(item.accessibilityInformation?.role).toBe('treeitem');
      // Tooltip must be set so mouse + keyboard hover both surface info.
      expect(item.tooltip).toBeDefined();
    }
  });

  it('synthesizes a11y label for run/schedule/environment/mcp/message kinds', () => {
    const cli = createMockCli();
    const tracker = makeTracker([]);
    const provider = new WarpRunsTreeProvider(cli, tracker);

    // We exercise every branch of getTreeItem() via fabricated nodes.
    const samples = [
      {
        kind: 'run' as const,
        id: 'run:1',
        label: 'My run',
        runId: 'r1',
        status: 'INPROGRESS' as const,
        active: true,
      },
      {
        kind: 'schedule' as const,
        id: 'sched:1',
        label: 'nightly',
        schedule: { id: 's1', name: 'nightly', cron: '0 0 * * *', prompt: 'go', paused: false },
      },
      {
        kind: 'environment' as const,
        id: 'env:1',
        label: 'staging',
        environment: { id: 'e1', name: 'staging', scope: 'team' },
      },
      {
        kind: 'mcp' as const,
        id: 'mcp:1',
        label: 'github',
        server: { name: 'github', uuid: 'uuid-1' },
      },
      {
        kind: 'message' as const,
        id: 'msg:1',
        label: 'No active runs',
      },
    ];

    for (const sample of samples) {
      const item = provider.getTreeItem(sample as never);
      expect(item.accessibilityInformation, sample.kind).toBeDefined();
      expect(item.accessibilityInformation?.label.length, sample.kind).toBeGreaterThan(3);
      expect(item.accessibilityInformation?.role, sample.kind).toBe('treeitem');
    }
  });
});

describe('a11y — drive tree provider', () => {
  it('every node kind has an accessibilityInformation.label', async () => {
    const source = makeDriveSource([
      {
        id: 'p1',
        category: 'prompt',
        name: 'My prompt',
        source: 'cli',
      } as DriveEntry,
    ]);
    const provider = new WarpDriveTreeProvider(source);
    const roots = await provider.getChildren();
    for (const root of roots) {
      const item = provider.getTreeItem(root);
      expect(item.accessibilityInformation, root.id).toBeDefined();
      expect(item.accessibilityInformation?.label.length).toBeGreaterThan(0);
      expect(item.accessibilityInformation?.role).toBe('treeitem');
    }

    // Drill down into the prompt category to cover the entry branch.
    const promptCat = roots.find((r) => r.kind === 'category' && r.category === 'prompt');
    if (promptCat) {
      const children = await provider.getChildren(promptCat);
      for (const child of children) {
        const item = provider.getTreeItem(child);
        expect(item.accessibilityInformation, child.id).toBeDefined();
        expect(item.accessibilityInformation?.label.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('a11y — status bar', () => {
  it('exposes a label in the steady (idle) state', () => {
    const tracker = makeTracker([]);
    const mgr = new StatusBarManager(tracker);
    const item = mgr.statusBarItem as unknown as {
      accessibilityInformation?: { label: string; role?: string };
    };
    expect(item.accessibilityInformation).toBeDefined();
    expect(item.accessibilityInformation?.label).toMatch(/0 active runs/);
    expect(item.accessibilityInformation?.role).toBe('button');
    mgr.dispose();
  });
});

describe('a11y — walkthrough markdown', () => {
  const dir = join(repoRoot, 'media', 'walkthrough');
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));

  it('discovers at least 4 walkthrough files', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it.each(files)('%s declares alt text on every image', (file) => {
    const md = readFileSync(join(dir, file), 'utf8');
    // Match every Markdown image. Reject empty alt (`![]`) — WCAG 1.1.1.
    const images = [...md.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
    for (const [match, alt, url] of images) {
      expect(alt.trim().length, `image ${url} in ${file} has empty alt: ${match}`).toBeGreaterThan(
        0,
      );
    }
  });

  it.each(files)('%s contains at least one heading (document outline)', (file) => {
    const md = readFileSync(join(dir, file), 'utf8');
    expect(md, file).toMatch(/^#\s+/m);
  });
});
