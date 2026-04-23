import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorkspaceConfigResolver } from '../../src/services/workspaceConfigResolver.js';

function mkWorkspace(profile: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ozbridge-audit-ws-'));
  const dir = path.join(root, '.warp');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'warp-bridge.yaml'), `defaultProfile: ${profile}\n`, 'utf8');
  return root;
}

describe('WorkspaceConfigResolver multi-root/no-workspace audit', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });

  it('can bind from undefined workspace to an opened folder without reload', () => {
    const root = mkWorkspace('first');
    tempRoots.push(root);

    const resolver = new WorkspaceConfigResolver(undefined);
    expect(resolver.getOverrides()).toEqual({});

    resolver.setWorkspaceRoot(root);
    expect(resolver.getOverrides().defaultProfile).toBe('first');

    resolver.dispose();
  });

  it('can switch to another workspace root and refresh overrides', () => {
    const root1 = mkWorkspace('alpha');
    const root2 = mkWorkspace('beta');
    tempRoots.push(root1, root2);

    const resolver = new WorkspaceConfigResolver(root1);
    expect(resolver.getOverrides().defaultProfile).toBe('alpha');

    resolver.setWorkspaceRoot(root2);
    expect(resolver.getOverrides().defaultProfile).toBe('beta');

    resolver.dispose();
  });
});
