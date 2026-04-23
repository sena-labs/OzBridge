import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CursorRegistrar } from '../../src/mcp/registrars/cursorRegistrar.js';

let tmpdir: string;
let configPath: string;
let registrar: CursorRegistrar;

beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'warp-cursor-'));
  configPath = path.join(tmpdir, '.cursor', 'mcp.json');
  registrar = new CursorRegistrar(configPath);
});

afterEach(() => {
  try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('CursorRegistrar', () => {
  it('has the expected metadata', () => {
    expect(registrar.clientId).toBe('cursor');
    expect(registrar.displayName).toBe('Cursor');
    expect(registrar.configPath).toBe(configPath);
  });

  it('creates `.cursor/mcp.json` and any missing parent directories', async () => {
    await registrar.register({ name: 'oz-bridge', url: 'http://127.0.0.1:3847/sse' });
    expect(fs.existsSync(configPath)).toBe(true);
    expect(fs.statSync(path.dirname(configPath)).isDirectory()).toBe(true);
  });

  it('writes a canonical `mcpServers` entry with bearer-token headers', async () => {
    await registrar.register({
      name: 'oz-bridge',
      url: 'http://127.0.0.1:3847/sse',
      bearerToken: 'abc',
    });
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(parsed.mcpServers['oz-bridge']).toEqual({
      url: 'http://127.0.0.1:3847/sse',
      headers: { Authorization: 'Bearer abc' },
    });
  });

  it('round-trips register → unregister → status cleanly', async () => {
    await registrar.register({ name: 'oz-bridge', url: 'http://x' });
    expect(await registrar.status('oz-bridge')).toBe('registered');
    await registrar.unregister('oz-bridge');
    expect(await registrar.status('oz-bridge')).toBe('missing');
  });

  it('preserves other servers on unregister', async () => {
    await registrar.register({ name: 'oz-bridge', url: 'http://x' });
    await registrar.register({ name: 'other', url: 'http://y' });
    await registrar.unregister('oz-bridge');

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(parsed.mcpServers).toEqual({ other: { url: 'http://y' } });
  });
});
