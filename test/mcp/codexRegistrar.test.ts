import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodexRegistrar } from '../../src/mcp/registrars/codexRegistrar.js';

let tmpdir: string;
let configPath: string;
let registrar: CodexRegistrar;

beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'warp-codex-'));
  configPath = path.join(tmpdir, '.codex', 'config.toml');
  registrar = new CodexRegistrar(configPath);
});

afterEach(() => {
  try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('CodexRegistrar — metadata', () => {
  it('has the expected client id and display name', () => {
    expect(registrar.clientId).toBe('codex');
    expect(registrar.displayName).toContain('Codex');
    expect(registrar.configPath).toBe(configPath);
  });
});

describe('CodexRegistrar — register on a fresh file', () => {
  it('creates config.toml with a single [[mcp.servers]] block', async () => {
    await registrar.register({
      name: 'warp-vsc-bridge',
      url: 'http://127.0.0.1:3847/sse',
    });
    expect(fs.existsSync(configPath)).toBe(true);
    const content = fs.readFileSync(configPath, 'utf8');
    expect(content).toContain('[[mcp.servers]]');
    expect(content).toContain('name = "warp-vsc-bridge"');
    expect(content).toContain('url = "http://127.0.0.1:3847/sse"');
    expect(content).not.toContain('bearer_token');
  });

  it('includes bearer_token when one is provided', async () => {
    await registrar.register({
      name: 'warp-vsc-bridge',
      url: 'http://127.0.0.1:3847/sse',
      bearerToken: 's3cr3t',
    });
    const content = fs.readFileSync(configPath, 'utf8');
    expect(content).toContain('bearer_token = "s3cr3t"');
  });

  it('escapes embedded quotes in values', async () => {
    await registrar.register({
      name: 'warp-vsc-bridge',
      url: 'http://"weird"/path',
      bearerToken: 'tok"en',
    });
    const content = fs.readFileSync(configPath, 'utf8');
    expect(content).toContain('url = "http://\\"weird\\"/path"');
    expect(content).toContain('bearer_token = "tok\\"en"');
  });
});

describe('CodexRegistrar — preservation of unrelated sections', () => {
  it('keeps arbitrary top-level keys and foreign tables intact', async () => {
    const original = `# Codex config
log_level = "info"

[profile.default]
model = "gpt-4o"
`;
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, original, 'utf8');

    await registrar.register({ name: 'warp-vsc-bridge', url: 'http://x' });

    const content = fs.readFileSync(configPath, 'utf8');
    expect(content).toContain('log_level = "info"');
    expect(content).toContain('[profile.default]');
    expect(content).toContain('model = "gpt-4o"');
    expect(content).toContain('[[mcp.servers]]');
    expect(content).toContain('name = "warp-vsc-bridge"');
  });

  it('preserves pre-existing [[mcp.servers]] blocks for other servers', async () => {
    const original = `[[mcp.servers]]
name = "other"
url = "http://other"
`;
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, original, 'utf8');

    await registrar.register({ name: 'warp-vsc-bridge', url: 'http://new' });

    const content = fs.readFileSync(configPath, 'utf8');
    // Both entries must still be present
    const blocks = content.match(/\[\[mcp\.servers\]\]/g) ?? [];
    expect(blocks.length).toBe(2);
    expect(content).toContain('name = "other"');
    expect(content).toContain('name = "warp-vsc-bridge"');
  });
});

describe('CodexRegistrar — overwriting the same server', () => {
  it('replaces an existing block with the new one rather than duplicating it', async () => {
    await registrar.register({ name: 'warp-vsc-bridge', url: 'http://old' });
    await registrar.register({ name: 'warp-vsc-bridge', url: 'http://new' });

    const content = fs.readFileSync(configPath, 'utf8');
    expect(content).not.toContain('http://old');
    expect(content).toContain('http://new');
    const headers = content.match(/\[\[mcp\.servers\]\]/g) ?? [];
    expect(headers.length).toBe(1);
  });
});

describe('CodexRegistrar — unregister and status', () => {
  it('unregister removes only the named block', async () => {
    await registrar.register({ name: 'warp-vsc-bridge', url: 'http://x' });
    await registrar.register({ name: 'other', url: 'http://y' });
    await registrar.unregister('warp-vsc-bridge');

    const content = fs.readFileSync(configPath, 'utf8');
    expect(content).not.toContain('name = "warp-vsc-bridge"');
    expect(content).toContain('name = "other"');
  });

  it('unregister is a no-op when the file does not exist', async () => {
    await registrar.unregister('warp-vsc-bridge');
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('unregister is a no-op when the block does not exist', async () => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '[[mcp.servers]]\nname = "other"\nurl = "u"\n', 'utf8');
    const before = fs.readFileSync(configPath, 'utf8');
    await registrar.unregister('warp-vsc-bridge');
    expect(fs.readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('status returns not-configured / missing / registered correctly', async () => {
    expect(await registrar.status('warp-vsc-bridge')).toBe('not-configured');

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '', 'utf8');
    expect(await registrar.status('warp-vsc-bridge')).toBe('missing');

    await registrar.register({ name: 'warp-vsc-bridge', url: 'http://x' });
    expect(await registrar.status('warp-vsc-bridge')).toBe('registered');
  });
});
