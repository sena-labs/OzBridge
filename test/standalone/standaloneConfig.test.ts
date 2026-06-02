import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { StandaloneConfigManager } from '../../packages/oz-mcp-server/src/standaloneConfig.js';

/**
 * Regression guard (residual-bug audit, 2026-06-01).
 *
 * The standalone config builder coalesced env-derived numbers with `|| fallback`,
 * which treats a valid `0` as "missing" and silently substitutes the default.
 * That defeated two documented behaviours:
 *   - `OZ_IDLE_TIMEOUT_MS=0` is documented as "disable the idle timeout" but was
 *     rewritten to the 90s default.
 *   - `OZ_MCP_PORT=0` requests an OS-assigned ephemeral port but was rewritten
 *     to 3847.
 */

const ENV_KEYS = [
  'OZ_PATH', 'OZ_DEFAULT_MODEL', 'OZ_DEFAULT_PROFILE', 'OZ_DEFAULT_ENV',
  'OZ_MCP_PORT', 'OZ_MCP_BIND', 'OZ_MCP_TOKEN', 'OZ_TIMEOUT_MS', 'OZ_IDLE_TIMEOUT_MS',
];

let saved: Record<string, string | undefined>;
let workspaceRoot: string;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // Isolated workspace with an empty warp-bridge.yaml so the home-dir YAML
  // (if present on the dev machine) can never bleed into the assertions.
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ozbridge-cfg-'));
  fs.mkdirSync(path.join(workspaceRoot, '.warp'), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, '.warp', 'warp-bridge.yaml'), '', 'utf8');
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) { delete process.env[k]; }
    else { process.env[k] = saved[k]; }
  }
  try { fs.rmSync(workspaceRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('StandaloneConfigManager env numeric parsing', () => {
  it('honours OZ_IDLE_TIMEOUT_MS=0 as "disable" instead of substituting the default', () => {
    process.env.OZ_IDLE_TIMEOUT_MS = '0';
    const cfg = new StandaloneConfigManager(workspaceRoot).getConfig();
    expect(cfg.idleTimeoutMs).toBe(0);
  });

  it('honours OZ_MCP_PORT=0 as "ephemeral" instead of substituting 3847', () => {
    process.env.OZ_MCP_PORT = '0';
    const cfg = new StandaloneConfigManager(workspaceRoot).getConfig();
    expect(cfg.mcpPort).toBe(0);
  });

  it('still falls back to the default for a non-numeric value', () => {
    process.env.OZ_TIMEOUT_MS = 'not-a-number';
    const cfg = new StandaloneConfigManager(workspaceRoot).getConfig();
    expect(cfg.timeoutMs).toBe(300_000);
  });

  it('uses an explicit positive value', () => {
    process.env.OZ_TIMEOUT_MS = '120000';
    const cfg = new StandaloneConfigManager(workspaceRoot).getConfig();
    expect(cfg.timeoutMs).toBe(120_000);
  });

  it('preserves a bearer token from .warp/warp-bridge.yaml when OZ_MCP_TOKEN is unset', () => {
    // Regression: line 66 previously did `env('OZ_MCP_TOKEN') ?? DEFAULT` and
    // skipped the yaml rung, dropping a configured token → unauthenticated.
    fs.writeFileSync(path.join(workspaceRoot, '.warp', 'warp-bridge.yaml'), 'mcpBearerToken: s3cret\n', 'utf8');
    const cfg = new StandaloneConfigManager(workspaceRoot).getConfig();
    expect(cfg.mcpBearerToken).toBe('s3cret');
  });
});
