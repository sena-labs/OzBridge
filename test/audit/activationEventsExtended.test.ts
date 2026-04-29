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

  it('must NOT declare redundant onCommand:* activation events for contributed commands', () => {
    // VS Code ≥1.74 auto-generates onCommand activation events for every
    // contributed command; declaring them explicitly is redundant noise that
    // we audited away in v1.2 (MED-1). engines.vscode is pinned at ^1.96 so
    // this is safe.
    const commands = new Set((pkg.contributes?.commands ?? []).map((c) => c.command));
    const redundant = (pkg.activationEvents ?? [])
      .filter((e) => e.startsWith('onCommand:'))
      .map((e) => e.slice('onCommand:'.length))
      .filter((cmd) => commands.has(cmd));
    expect(
      redundant,
      `Found redundant onCommand activation events for contributed commands: ${redundant.join(', ')}`,
    ).toEqual([]);
  });

  it('relies on granular activation events instead of onStartupFinished (cold-start cost)', () => {
    const events = pkg.activationEvents ?? [];
    expect(events).not.toContain('onStartupFinished');
    // Sanity: at least one onView:* must be present so the sidebar wakes the extension.
    expect(events.some((e) => e.startsWith('onView:ozBridge.'))).toBe(true);
  });

  it('must not contain stale warpBridge activation prefixes', () => {
    const stale = (pkg.activationEvents ?? []).filter((e) => /warpBridge\./.test(e));
    expect(stale, `Stale activation events detected: ${stale.join(', ')}`).toEqual([]);
  });

  // C-L7: pin the four LM tool activation events explicitly so accidental
  // removal/rename surfaces here (in addition to the dynamic check in
  // test/manifestActivationConsistency.test.ts).
  it('must explicitly include onLanguageModelTool activation events for every oz_* tool', () => {
    const required = [
      'onLanguageModelTool:oz_run_local',
      'onLanguageModelTool:oz_run_cloud',
      'onLanguageModelTool:oz_get_run',
      'onLanguageModelTool:oz_list_runs',
    ];
    const activation = new Set(pkg.activationEvents ?? []);
    for (const ev of required) {
      expect(
        activation.has(ev),
        `Missing activation event ${ev}. Agent-mode invocation of the tool would fail to wake the extension.`,
      ).toBe(true);
    }
  });
});
