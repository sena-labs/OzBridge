import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  WorkspaceConfigResolver,
  WORKSPACE_CONFIG_PATH,
  ALLOWED_OVERRIDE_KEYS,
} from '../../src/services/workspaceConfigResolver.js';
import { workspace } from '../mocks/vscode.js';

/**
 * Grab the last-created mock FileSystemWatcher. The mock is a `vi.fn`
 * that returns a helper object exposing `_fireCreate / _fireChange /
 * _fireDelete`, so we can drive the watcher from tests.
 */
function lastWatcher(): {
  _fireCreate: () => void;
  _fireChange: () => void;
  _fireDelete: () => void;
} | undefined {
  const calls = workspace.createFileSystemWatcher.mock.results;
  if (calls.length === 0) { return undefined; }
  return calls[calls.length - 1].value as ReturnType<typeof lastWatcher>;
}

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warp-vsc-ws-'));
});

afterEach(() => {
  try {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function writeYaml(contents: string): void {
  const dir = path.join(workspaceRoot, '.warp');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'warp-bridge.yaml'), contents, 'utf8');
}

describe('WorkspaceConfigResolver — file reading', () => {
  it('returns {} when no workspace folder is available', () => {
    const resolver = new WorkspaceConfigResolver(undefined);
    expect(resolver.getOverrides()).toEqual({});
    resolver.dispose();
  });

  it('returns {} when the YAML file does not exist', () => {
    const resolver = new WorkspaceConfigResolver(workspaceRoot);
    expect(resolver.getOverrides()).toEqual({});
    resolver.dispose();
  });

  it('reads a well-formed YAML into typed overrides', () => {
    writeYaml([
      'defaultProfile: team-shared',
      'defaultEnvironment: staging',
      'timeoutMs: 60000',
      'mcpEnabled: true',
      'mcpPort: 3900',
      'mcpBindAddress: "0.0.0.0"',
    ].join('\n'));

    const resolver = new WorkspaceConfigResolver(workspaceRoot);
    expect(resolver.getOverrides()).toEqual({
      defaultProfile: 'team-shared',
      defaultEnvironment: 'staging',
      timeoutMs: 60000,
      mcpEnabled: true,
      mcpPort: 3900,
      mcpBindAddress: '0.0.0.0',
    });
    resolver.dispose();
  });

  it('skips unknown keys and keys with the wrong type', () => {
    writeYaml([
      'defaultProfile: ok',
      'unknownKey: 42',
      'mcpEnabled: "not-a-boolean"',
      'mcpPort: "3847"',
    ].join('\n'));

    const resolver = new WorkspaceConfigResolver(workspaceRoot);
    const overrides = resolver.getOverrides();
    expect(overrides.defaultProfile).toBe('ok');
    expect('unknownKey' in overrides).toBe(false);
    expect('mcpEnabled' in overrides).toBe(false);
    expect('mcpPort' in overrides).toBe(false);
    resolver.dispose();
  });

  it('refresh() re-reads the YAML synchronously after a manual edit', () => {
    writeYaml('defaultProfile: first');
    const resolver = new WorkspaceConfigResolver(workspaceRoot);
    expect(resolver.getOverrides().defaultProfile).toBe('first');
    writeYaml('defaultProfile: second');
    expect(resolver.refresh().defaultProfile).toBe('second');
    resolver.dispose();
  });

  it('never exposes a mutable snapshot', () => {
    writeYaml('defaultProfile: shared');
    const resolver = new WorkspaceConfigResolver(workspaceRoot);
    const snap = resolver.getOverrides();
    (snap as Record<string, unknown>).defaultProfile = 'mutated';
    expect(resolver.getOverrides().defaultProfile).toBe('shared');
    resolver.dispose();
  });
});

describe('WorkspaceConfigResolver — guardrails', () => {
  it('rejects secret keys even if a user tries to commit them', () => {
    writeYaml('mcpBearerToken: supersecret');
    const resolver = new WorkspaceConfigResolver(workspaceRoot);
    expect('mcpBearerToken' in resolver.getOverrides()).toBe(false);
    expect(ALLOWED_OVERRIDE_KEYS.has('mcpBearerToken')).toBe(false);
    resolver.dispose();
  });

  it('allowed-keys list matches the documented subset', () => {
    expect([...ALLOWED_OVERRIDE_KEYS].sort()).toEqual([
      'cloudPollingIntervalMs',
      'cloudPollingTimeoutMs',
      'defaultEnvironment',
      'defaultModel',
      'defaultProfile',
      'idleTimeoutMs',
      'maxOutputChars',
      'mcpBindAddress',
      'mcpEnabled',
      'mcpPort',
      'timeoutMs',
    ]);
  });

  it('constant matches the canonical relative path', () => {
    expect(WORKSPACE_CONFIG_PATH).toBe(path.join('.warp', 'warp-bridge.yaml'));
  });
});

describe('WorkspaceConfigResolver — watcher integration', () => {
  beforeEach(() => {
    workspace.createFileSystemWatcher.mockClear();
  });

  it('fires onDidChange and refreshes overrides when the watcher reports a change', () => {
    writeYaml('defaultProfile: first');
    const resolver = new WorkspaceConfigResolver(workspaceRoot);
    const watcher = lastWatcher();
    expect(watcher).toBeDefined();

    const events: Array<Partial<{ defaultProfile: string }>> = [];
    resolver.onDidChange((snapshot) => events.push(snapshot));

    // Simulate an external edit to the YAML followed by the watcher
    // firing — this mirrors what VS Code does when the file is saved.
    writeYaml('defaultProfile: second');
    watcher!._fireChange();

    expect(events).toHaveLength(1);
    expect(events[0].defaultProfile).toBe('second');
    expect(resolver.getOverrides().defaultProfile).toBe('second');
    resolver.dispose();
  });

  it('emits on onDidCreate when the YAML is created after the watcher is up', () => {
    // Start without a YAML file — resolver reads `{}` initially.
    const resolver = new WorkspaceConfigResolver(workspaceRoot);
    expect(resolver.getOverrides()).toEqual({});
    const watcher = lastWatcher();
    expect(watcher).toBeDefined();

    const fired = vi.fn();
    resolver.onDidChange(fired);

    writeYaml('mcpEnabled: true');
    watcher!._fireCreate();

    expect(fired).toHaveBeenCalledTimes(1);
    expect(resolver.getOverrides().mcpEnabled).toBe(true);
    resolver.dispose();
  });

  it('clears overrides on onDidDelete', () => {
    writeYaml('defaultProfile: gone-soon');
    const resolver = new WorkspaceConfigResolver(workspaceRoot);
    expect(resolver.getOverrides().defaultProfile).toBe('gone-soon');
    const watcher = lastWatcher();

    const snapshots: Array<Partial<{ defaultProfile: string }>> = [];
    resolver.onDidChange((s) => snapshots.push(s));

    fs.rmSync(path.join(workspaceRoot, WORKSPACE_CONFIG_PATH), { force: true });
    watcher!._fireDelete();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual({});
    expect(resolver.getOverrides()).toEqual({});
    resolver.dispose();
  });

  it('stops dispatching events after dispose()', () => {
    writeYaml('defaultProfile: first');
    const resolver = new WorkspaceConfigResolver(workspaceRoot);
    const watcher = lastWatcher();
    const fired = vi.fn();
    resolver.onDidChange(fired);

    resolver.dispose();
    // After dispose, internal reloadAndEmit is a no-op. Even if a stray
    // event arrives (e.g. during VS Code shutdown), nothing fires.
    watcher!._fireChange();
    expect(fired).not.toHaveBeenCalled();
  });
});
