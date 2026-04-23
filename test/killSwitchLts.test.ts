/**
 * v1.0 deliverable T — kill-switch + LTS policy invariants.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..');

function read(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

async function loadFresh(configValues: Record<string, unknown>): Promise<{
  activate: (ctx: unknown) => void;
  deactivate: () => void;
  vscode: typeof import('vscode');
}> {
  vi.resetModules();
  const vscode = await import('vscode');
  (vscode.workspace.getConfiguration as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    () =>
      ({
        get: (key: string, fallback?: unknown) =>
          key in configValues ? configValues[key] : fallback,
        has: (k: string) => k in configValues,
        inspect: () => undefined,
        update: () => Promise.resolve(),
      }) as unknown as ReturnType<typeof vscode.workspace.getConfiguration>,
  );
  const showWarningSpy = vscode.window.showWarningMessage as unknown as ReturnType<typeof vi.fn>;
  showWarningSpy.mockClear();
  const ext = await import('../src/extension.js');
  return { activate: ext.activate as (c: unknown) => void, deactivate: ext.deactivate, vscode };
}

describe('Kill-switch — activation short-circuit', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns early and shows a warning when killSwitch.enabled is true', async () => {
    const { activate, deactivate, vscode } = await loadFresh({
      'killSwitch.enabled': true,
      'killSwitch.reason': 'incident-123',
    });
    const subs: Array<{ dispose: () => void }> = [];
    activate({
      extensionUri: { fsPath: '/ext' },
      subscriptions: subs,
    });

    // Only the OutputChannel should have been pushed onto subscriptions
    // before the early return.
    expect(subs.length).toBeLessThanOrEqual(1);
    const showWarning = vscode.window.showWarningMessage as unknown as ReturnType<typeof vi.fn>;
    expect(showWarning).toHaveBeenCalledTimes(1);
    const msg = showWarning.mock.calls[0][0] as string;
    expect(msg).toMatch(/kill-switch/i);
    expect(msg).toMatch(/incident-123/);

    expect(() => deactivate()).not.toThrow();
  });

  it('proceeds normally when killSwitch.enabled is false (default)', async () => {
    const { activate, deactivate, vscode } = await loadFresh({});
    const subs: Array<{ dispose: () => void }> = [];
    activate({
      extensionUri: { fsPath: '/ext' },
      subscriptions: subs,
    });

    expect(subs.length).toBeGreaterThan(1);
    const showWarning = vscode.window.showWarningMessage as unknown as ReturnType<typeof vi.fn>;
    expect(showWarning).not.toHaveBeenCalled();
    deactivate();
  });
});

describe('Kill-switch — package.json contributions', () => {
  const pkg = JSON.parse(read('package.json')) as {
    contributes: {
      configuration: { properties: Record<string, { type: string; default: unknown; scope?: string }> };
    };
  };
  const props = pkg.contributes.configuration.properties;

  it('declares ozBridge.killSwitch.enabled as a boolean defaulting to false', () => {
    const setting = props['ozBridge.killSwitch.enabled'];
    expect(setting).toBeDefined();
    expect(setting.type).toBe('boolean');
    expect(setting.default).toBe(false);
    expect(setting.scope).toBe('machine-overridable');
  });

  it('declares ozBridge.killSwitch.reason as an empty-string default', () => {
    const setting = props['ozBridge.killSwitch.reason'];
    expect(setting).toBeDefined();
    expect(setting.type).toBe('string');
    expect(setting.default).toBe('');
  });
});

describe('LTS policy — SECURITY.md', () => {
  const md = read('SECURITY.md');

  it('publishes the kill-switch playbook', () => {
    expect(md).toMatch(/Kill-switch \(v1\.0 deliverable T\)/);
    expect(md).toMatch(/ozBridge\.killSwitch\.enabled/);
    expect(md).toMatch(/ozBridge\.killSwitch\.reason/);
  });

  it('publishes the LTS commitment table', () => {
    expect(md).toMatch(/LTS Policy \(v1\.0 deliverable T\)/);
    expect(md).toMatch(/18 months/);
    expect(md).toMatch(/Critical-only window/);
    expect(md).toMatch(/release\/v<major>\.<minor>\.x/);
  });
});
