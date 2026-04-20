import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  WorkspaceConfigResolver,
  WORKSPACE_CONFIG_PATH,
  ALLOWED_OVERRIDE_KEYS,
} from '../../src/services/workspaceConfigResolver.js';

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
