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
    expect(dashboard).toMatchObject({ command: 'ozBridge.dashboard.open' });

    const expected = `onCommand:${dashboard!.command}`;
    expect(pkg.activationEvents ?? []).toContain(expected);
  });

  it('must explicitly activate for every contributed command', () => {
    const commands = (pkg.contributes?.commands ?? []).map((c) => c.command);
    const activation = new Set(pkg.activationEvents ?? []);

    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      const expected = `onCommand:${command}`;
      expect(
        activation.has(expected),
        `Missing activation event ${expected}. Command Palette invocation may not wake the extension on older VS Code hosts.`,
      ).toBe(true);
    }
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
