import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_CONFIG, OzBridgeConfig } from '../../src/types/index.js';

/**
 * Regression guard (residual-bug audit, 2026-06-01).
 *
 * Every key in {@link DEFAULT_CONFIG} is read back from VS Code settings by
 * `BaseConfigManager.readConfig` (it iterates `Object.keys(defaults)` and
 * calls `cfg.get(key, default)`). For each such key to be discoverable in the
 * Settings UI — and to avoid the "Unknown Configuration Setting" warning when
 * a user sets it in `settings.json` — it MUST also be contributed in
 * `package.json` under `contributes.configuration.properties` as
 * `ozBridge.<key>`.
 *
 * This test failed before `ozBridge.mcpSseMaxLifetimeMs` was added to the
 * manifest: the setting was typed, defaulted, validated (`readMcpConfig`) and
 * unit-tested, yet never contributed to `package.json`, so users could not
 * configure the SSE session lifetime from the Settings UI.
 */
const ROOT = path.resolve(__dirname, '..', '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  contributes?: { configuration?: { properties?: Record<string, unknown> } };
};

describe('config ↔ package.json manifest consistency', () => {
  const declared = new Set(
    Object.keys(PKG.contributes?.configuration?.properties ?? {}),
  );

  it('declares every DEFAULT_CONFIG key under contributes.configuration', () => {
    const missing = (Object.keys(DEFAULT_CONFIG) as Array<keyof OzBridgeConfig>)
      .map((key) => `ozBridge.${String(key)}`)
      .filter((full) => !declared.has(full));

    expect(
      missing,
      `package.json is missing configuration declarations for: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('exposes the SSE session lifetime setting with the validated bounds', () => {
    const prop = (PKG.contributes?.configuration?.properties ?? {})[
      'ozBridge.mcpSseMaxLifetimeMs'
    ] as { type?: string; default?: number; minimum?: number; maximum?: number } | undefined;

    expect(prop, 'ozBridge.mcpSseMaxLifetimeMs must be declared').toBeDefined();
    expect(prop?.type).toBe('integer');
    // Bounds and default must match readMcpConfig() in src/mcp/lifecycle.ts.
    expect(prop?.default).toBe(DEFAULT_CONFIG.mcpSseMaxLifetimeMs);
    expect(prop?.minimum).toBe(60_000);
    expect(prop?.maximum).toBe(86_400_000);
  });
});
