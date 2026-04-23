import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

type Pkg = {
  activationEvents?: string[];
  contributes?: {
    views?: Record<string, Array<{ id: string }>>;
    commands?: Array<{ command: string }>;
  };
};

const ROOT = path.resolve(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as Pkg;

describe('activationEvents extended audit', () => {
  it('must include activation events for all contributed ozBridgeSidebar views', () => {
    const expectedViews = (pkg.contributes?.views?.ozBridgeSidebar ?? []).map((v) => `onView:${v.id}`);
    const activation = new Set(pkg.activationEvents ?? []);

    expect(expectedViews.length).toBeGreaterThan(0);
    for (const ev of expectedViews) {
      expect(
        activation.has(ev),
        `Missing activation event ${ev}. Sidebar may not activate extension on first open.`,
      ).toBe(true);
    }
  });

  it('must include dashboard command activation event aligned with contributed command id', () => {
    const dashboard = (pkg.contributes?.commands ?? []).find((c) => c.command === 'ozBridge.dashboard.open');
    expect(dashboard).toBeDefined();

    const expected = `onCommand:${dashboard!.command}`;
    expect(pkg.activationEvents ?? []).toContain(expected);
  });

  it('must not contain stale warpBridge activation prefixes', () => {
    const stale = (pkg.activationEvents ?? []).filter((e) => /warpBridge\./.test(e));
    expect(stale, `Stale activation events detected: ${stale.join(', ')}`).toEqual([]);
  });
});
