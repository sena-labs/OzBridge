import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

describe('Publishing readiness (deliverable M)', () => {
  it('declares every mandatory publisher/marketplace field', () => {
    expect(PKG.publisher).toBe('sena-labs');
    expect(PKG.name).toBe('ozbridge');
    expect(typeof PKG.displayName).toBe('string');
    expect(typeof PKG.description).toBe('string');
    expect(PKG.license).toBe('MIT');
    expect(PKG.icon).toMatch(/\.(png|jpg|svg)$/);
    expect(Array.isArray(PKG.categories)).toBe(true);
    expect(PKG.categories.length).toBeGreaterThan(0);
  });

  it('repository, bugs and homepage point at the sena-labs org', () => {
    expect(PKG.repository).toBeDefined();
    expect(PKG.repository.type).toBe('git');
    expect(PKG.repository.url).toMatch(/sena-labs\/OzBridge/);
    expect(PKG.bugs?.url).toMatch(/sena-labs\/OzBridge\/issues/);
    expect(PKG.homepage).toMatch(/sena-labs\/OzBridge/);
  });

  it('ships the packaged icon referenced in package.json', () => {
    const iconPath = path.join(ROOT, PKG.icon);
    expect(fs.existsSync(iconPath), `icon ${PKG.icon} missing on disk`).toBe(true);
    const size = fs.statSync(iconPath).size;
    expect(size).toBeGreaterThan(0);
  });

  it('declares a compatible VS Code engine and an esbuild-produced entry point', () => {
    expect(PKG.engines?.vscode).toMatch(/^\^?[0-9]+\.[0-9]+\.[0-9]+$/);
    expect(PKG.main).toBe('./dist/extension.js');
  });

  it('publish workflow defines the three required jobs', () => {
    const yml = fs.readFileSync(
      path.join(ROOT, '.github', 'workflows', 'publish.yml'),
      'utf8',
    );
    // Job keys appear as top-level two-space-indented identifiers under
    // the `jobs:` section — check each explicitly.
    for (const job of [
      'build',
      'publish-marketplace',
      'publish-openvsx',
      'github-release',
    ]) {
      expect(
        new RegExp(`^  ${job}:`, 'm').test(yml),
        `missing job ${job}`,
      ).toBe(true);
    }
    // Each publish job must depend on the build artifact.
    expect(yml).toMatch(/publish-marketplace:[\s\S]*?needs:\s*build/);
    expect(yml).toMatch(/publish-openvsx:[\s\S]*?needs:\s*build/);
    expect(yml).toMatch(/github-release:[\s\S]*?needs:\s*build/);
  });

  it('publish workflow wires the VSCE_PAT and OVSX_PAT secrets', () => {
    const yml = fs.readFileSync(
      path.join(ROOT, '.github', 'workflows', 'publish.yml'),
      'utf8',
    );
    expect(yml).toMatch(/VSCE_PAT:\s*\$\{\{\s*secrets\.VSCE_PAT\s*\}\}/);
    expect(yml).toMatch(/OVSX_PAT:\s*\$\{\{\s*secrets\.OVSX_PAT\s*\}\}/);
  });

  it('README install section documents both registries', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    expect(readme).toMatch(/marketplace\.visualstudio\.com/i);
    expect(readme).toMatch(/open-vsx\.org/i);
    expect(readme).toMatch(/sena-labs\.ozbridge/);
  });
});
