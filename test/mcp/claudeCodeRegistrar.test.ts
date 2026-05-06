import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeCodeRegistrar } from '../../src/mcp/registrars/claudeCodeRegistrar.js';

let tmpdir: string;
let configPath: string;
let registrar: ClaudeCodeRegistrar;

beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'warp-claude-'));
  configPath = path.join(tmpdir, '.claude.json');
  registrar = new ClaudeCodeRegistrar(configPath);
});

afterEach(() => {
  try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('ClaudeCodeRegistrar', () => {
  it('identifies itself with stable metadata', () => {
    expect(registrar.clientId).toBe('claude-code');
    expect(registrar.displayName).toContain('Claude');
    expect(registrar.configPath).toBe(configPath);
  });

  it('creates a new config file when none exists', async () => {
    await registrar.register({ name: 'oz-bridge', url: 'http://127.0.0.1:3847/sse' });
    expect(fs.existsSync(configPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(parsed.mcpServers['oz-bridge'].url).toBe('http://127.0.0.1:3847/sse');
    // Claude Code requires `type: "sse"` to select the SSE transport
    expect(parsed.mcpServers['oz-bridge'].type).toBe('sse');
  });

  it('embeds an Authorization header when a bearer token is supplied', async () => {
    await registrar.register({
      name: 'oz-bridge',
      url: 'http://127.0.0.1:3847/sse',
      bearerToken: 's3cr3t',
    });
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(parsed.mcpServers['oz-bridge'].headers.Authorization).toBe('Bearer s3cr3t');
    expect(parsed.mcpServers['oz-bridge'].type).toBe('sse');
  });

  it('omits headers entirely when no bearer token is supplied', async () => {
    await registrar.register({ name: 'oz-bridge', url: 'http://127.0.0.1:3847/sse' });
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(parsed.mcpServers['oz-bridge'].headers).toBeUndefined();
    expect(parsed.mcpServers['oz-bridge'].type).toBe('sse');
  });

  it('preserves unrelated top-level keys on register', async () => {
    fs.writeFileSync(configPath, JSON.stringify({
      autoUpdate: false,
      uiTheme: 'dark',
      mcpServers: { 'other-server': { url: 'http://example' } },
    }, null, 2));

    await registrar.register({ name: 'oz-bridge', url: 'http://127.0.0.1:3847/sse' });

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(parsed.autoUpdate).toBe(false);
    expect(parsed.uiTheme).toBe('dark');
    expect(parsed.mcpServers['other-server'].url).toBe('http://example');
    expect(parsed.mcpServers['oz-bridge'].url).toBe('http://127.0.0.1:3847/sse');
  });

  it('overwrites an existing entry with the same name', async () => {
    await registrar.register({ name: 'oz-bridge', url: 'http://old' });
    await registrar.register({ name: 'oz-bridge', url: 'http://new' });
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(parsed.mcpServers['oz-bridge'].url).toBe('http://new');
  });

  it('unregister removes only the named server', async () => {
    await registrar.register({ name: 'oz-bridge', url: 'http://x' });
    await registrar.register({ name: 'keep-me', url: 'http://y' });
    await registrar.unregister('oz-bridge');

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(parsed.mcpServers['oz-bridge']).toBeUndefined();
    expect(parsed.mcpServers['keep-me'].url).toBe('http://y');
  });

  it('unregister is a no-op when the file does not exist', async () => {
    await registrar.unregister('oz-bridge');
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('unregister is a no-op when the entry does not exist', async () => {
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { other: { url: 'u' } } }));
    const before = fs.readFileSync(configPath, 'utf8');
    await registrar.unregister('oz-bridge');
    expect(fs.readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('status returns not-configured when the file is missing', async () => {
    expect(await registrar.status('oz-bridge')).toBe('not-configured');
  });

  it('status returns missing when the file exists but the entry is absent', async () => {
    fs.writeFileSync(configPath, '{}');
    expect(await registrar.status('oz-bridge')).toBe('missing');
  });

  it('status returns registered when the entry is present', async () => {
    await registrar.register({ name: 'oz-bridge', url: 'http://127.0.0.1:3847/sse' });
    expect(await registrar.status('oz-bridge')).toBe('registered');
  });

  it('rejects register() when the file contains invalid JSON', async () => {
    fs.writeFileSync(configPath, '{ this is not json');
    await expect(
      registrar.register({ name: 'oz-bridge', url: 'http://x' }),
    ).rejects.toThrow(/not valid JSON/);
  });

  it('writes atomically (no .tmp artifacts left in the config directory)', async () => {
    await registrar.register({ name: 'oz-bridge', url: 'http://127.0.0.1:3847/sse' });
    const residual = fs.readdirSync(tmpdir).filter((f) => f.endsWith('.tmp'));
    expect(residual).toEqual([]);
  });

  it('serializes concurrent register() calls so no entry is lost (B3)', async () => {
    // Without per-path locking, a read-modify-write race lets the last
    // rename win and silently drops every prior caller's entry.
    const names = ['srv-a', 'srv-b', 'srv-c', 'srv-d', 'srv-e'];
    await Promise.all(
      names.map((name) => registrar.register({ name, url: `http://example/${name}` })),
    );

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    for (const name of names) {
      expect(parsed.mcpServers[name]?.url).toBe(`http://example/${name}`);
    }
  });

  it('serializes register() against unregister() on the same path (B3)', async () => {
    await registrar.register({ name: 'oz-bridge', url: 'http://x' });
    await Promise.all([
      registrar.register({ name: 'sibling', url: 'http://y' }),
      registrar.unregister('oz-bridge'),
    ]);

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    // The unregister could have run before or after the sibling register,
    // but in *every* serialization order `sibling` must end up present and
    // `oz-bridge` must end up absent.
    expect(parsed.mcpServers.sibling?.url).toBe('http://y');
    expect(parsed.mcpServers['oz-bridge']).toBeUndefined();
  });
});
