import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodexRegistrar, tomlKey } from '../../src/mcp/registrars/codexRegistrar.js';

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

function writeConfig(content: string): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, content, 'utf8');
}

function readConfig(): string {
  return fs.readFileSync(configPath, 'utf8');
}

describe('CodexRegistrar — metadata', () => {
  it('has the expected client id and display name', () => {
    expect(registrar.clientId).toBe('codex');
    expect(registrar.displayName).toContain('Codex');
    expect(registrar.configPath).toBe(configPath);
  });
});

describe('CodexRegistrar — register on a fresh file', () => {
  it('creates config.toml with a single [mcp_servers.<name>] table', async () => {
    await registrar.register({ name: 'oz-bridge', url: 'http://127.0.0.1:3847/mcp' });
    expect(fs.existsSync(configPath)).toBe(true);
    const content = readConfig();
    expect(content).toBe('[mcp_servers.oz-bridge]\nurl = "http://127.0.0.1:3847/mcp"\n');
    expect(content).not.toContain('[[mcp.servers]]');
    expect(content).not.toContain('bearer_token');
    expect(content).not.toContain('http_headers');
  });

  it('sends the bearer token through http_headers when one is provided', async () => {
    await registrar.register({ name: 'oz-bridge', url: 'http://127.0.0.1:3847/mcp', bearerToken: 's3cr3t' });
    expect(readConfig()).toContain('http_headers = { "Authorization" = "Bearer s3cr3t" }');
  });

  it('escapes embedded quotes in values', async () => {
    await registrar.register({ name: 'oz-bridge', url: 'http://"weird"/path', bearerToken: 'tok"en' });
    const content = readConfig();
    expect(content).toContain('url = "http://\\"weird\\"/path"');
    expect(content).toContain('"Bearer tok\\"en"');
  });

  it('quotes server names that are not valid bare TOML keys', async () => {
    expect(tomlKey('oz-bridge')).toBe('oz-bridge');
    expect(tomlKey('oz.bridge')).toBe('"oz.bridge"');
    await registrar.register({ name: 'oz.bridge', url: 'http://x' });
    expect(readConfig()).toContain('[mcp_servers."oz.bridge"]');
    expect(await registrar.status('oz.bridge')).toBe('registered');
  });
});

describe('CodexRegistrar — preservation of unrelated sections', () => {
  it('keeps arbitrary top-level keys and foreign tables intact', async () => {
    writeConfig(`# Codex config
log_level = "info"

[profile.default]
model = "gpt-4o"
`);
    await registrar.register({ name: 'oz-bridge', url: 'http://x' });

    const content = readConfig();
    expect(content).toContain('# Codex config');
    expect(content).toContain('log_level = "info"');
    expect(content).toContain('[profile.default]');
    expect(content).toContain('model = "gpt-4o"');
    expect(content).toContain('[mcp_servers.oz-bridge]');
  });

  it('preserves tables for other MCP servers', async () => {
    writeConfig(`[mcp_servers.other]
command = "npx"
args = ["-y", "other"]

[mcp_servers.other.env]
TOKEN = "t"
`);
    await registrar.register({ name: 'oz-bridge', url: 'http://new' });

    const content = readConfig();
    expect(content).toContain('[mcp_servers.other]');
    expect(content).toContain('[mcp_servers.other.env]');
    expect(content).toContain('TOKEN = "t"');
    expect(content).toContain('[mcp_servers.oz-bridge]');
  });
});

describe('CodexRegistrar — overwriting and migration', () => {
  it('replaces an existing table with the new one rather than duplicating it', async () => {
    await registrar.register({ name: 'oz-bridge', url: 'http://old' });
    await registrar.register({ name: 'oz-bridge', url: 'http://new' });

    const content = readConfig();
    expect(content).not.toContain('http://old');
    expect(content).toContain('http://new');
    expect(content.match(/\[mcp_servers\.oz-bridge\]/g)?.length).toBe(1);
  });

  it('also removes our subtables when replacing', async () => {
    writeConfig(`[mcp_servers.oz-bridge]
url = "http://old"

[mcp_servers.oz-bridge.env]
X = "1"
`);
    await registrar.register({ name: 'oz-bridge', url: 'http://new' });

    const content = readConfig();
    expect(content).not.toContain('[mcp_servers.oz-bridge.env]');
    expect(content).not.toContain('http://old');
    expect(content).toContain('url = "http://new"');
  });

  it('migrates the legacy [[mcp.servers]] block for the same server', async () => {
    writeConfig(`log_level = "info"

[[mcp.servers]]
name = "oz-bridge"
url = "http://127.0.0.1:3847/sse"
bearer_token = "old"

[[mcp.servers]]
name = "other"
url = "http://other"
`);
    await registrar.register({ name: 'oz-bridge', url: 'http://127.0.0.1:3847/mcp' });

    const content = readConfig();
    expect(content).not.toContain('name = "oz-bridge"');
    expect(content).not.toContain('bearer_token');
    expect(content).not.toContain('/sse');
    expect(content).toContain('name = "other"');
    expect(content).toContain('log_level = "info"');
    expect(content).toContain('[mcp_servers.oz-bridge]\nurl = "http://127.0.0.1:3847/mcp"');
  });
});

describe('CodexRegistrar — unregister and status', () => {
  it('unregister removes only the named table', async () => {
    await registrar.register({ name: 'oz-bridge', url: 'http://x' });
    await registrar.register({ name: 'other', url: 'http://y' });
    await registrar.unregister('oz-bridge');

    const content = readConfig();
    expect(content).not.toContain('[mcp_servers.oz-bridge]');
    expect(content).toContain('[mcp_servers.other]');
  });

  it('unregister removes a legacy block too', async () => {
    writeConfig('[[mcp.servers]]\nname = "oz-bridge"\nurl = "u"\n');
    await registrar.unregister('oz-bridge');
    expect(readConfig()).not.toContain('oz-bridge');
  });

  it('unregister is a no-op when the file does not exist', async () => {
    await registrar.unregister('oz-bridge');
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('unregister is a no-op when no table exists for the server', async () => {
    writeConfig('[mcp_servers.other]\nurl = "u"\n');
    const before = readConfig();
    await registrar.unregister('oz-bridge');
    expect(readConfig()).toBe(before);
  });

  it('status returns not-configured / missing / registered correctly', async () => {
    expect(await registrar.status('oz-bridge')).toBe('not-configured');

    writeConfig('');
    expect(await registrar.status('oz-bridge')).toBe('missing');

    writeConfig('[[mcp.servers]]\nname = "oz-bridge"\nurl = "u"\n');
    expect(await registrar.status('oz-bridge')).toBe('missing');

    await registrar.register({ name: 'oz-bridge', url: 'http://x' });
    expect(await registrar.status('oz-bridge')).toBe('registered');
  });
});
