import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventEmitter } from './vscode-shim.js';
import { DEFAULT_CONFIG, OzBridgeConfig } from '../../../src/types/index.js';
import { parseFlatYaml } from '../../../src/services/yamlParser.js';
import type { IConfigManager } from '../../../src/types/index.js';

/**
 * VS Code-free implementation of IConfigManager for the standalone MCP server.
 *
 * Config precedence (highest → lowest):
 *   1. Environment variables (OZ_PATH, OZ_MCP_PORT, …)
 *   2. CWD/.warp/warp-bridge.yaml
 *   3. ~/.warp/warp-bridge.yaml
 *   4. Compiled-in DEFAULT_CONFIG
 */
export class StandaloneConfigManager implements IConfigManager {
  private readonly _cfg: OzBridgeConfig;
  private readonly _emitter = new EventEmitter<OzBridgeConfig>();

  readonly onConfigChanged = this._emitter.event;

  constructor(workspaceRoot?: string) {
    this._cfg = this._build(workspaceRoot);
  }

  getConfig(): OzBridgeConfig {
    return this._cfg;
  }

  dispose(): void {
    this._emitter.dispose();
  }

  // ---------------------------------------------------------------------------

  private _build(workspaceRoot?: string): OzBridgeConfig {
    const yaml = this._readYaml(workspaceRoot);

    const env = (key: string) => {
      const v = process.env[key];
      return v && v.length > 0 ? v : undefined;
    };
    const envNum = (key: string, fallback: number) =>
      Number(process.env[key]) || fallback;

    return {
      ...DEFAULT_CONFIG,
      ...yaml,
      ozPath:             env('OZ_PATH')            ?? yaml.ozPath             ?? DEFAULT_CONFIG.ozPath,
      defaultModel:       env('OZ_DEFAULT_MODEL')   ?? yaml.defaultModel       ?? DEFAULT_CONFIG.defaultModel,
      defaultProfile:     env('OZ_DEFAULT_PROFILE') ?? yaml.defaultProfile     ?? DEFAULT_CONFIG.defaultProfile,
      defaultEnvironment: env('OZ_DEFAULT_ENV')     ?? yaml.defaultEnvironment ?? DEFAULT_CONFIG.defaultEnvironment,
      // MCP is always enabled in standalone mode
      mcpEnabled:         true,
      mcpPort:            envNum('OZ_MCP_PORT', yaml.mcpPort ?? DEFAULT_CONFIG.mcpPort),
      mcpBindAddress:     env('OZ_MCP_BIND')        ?? yaml.mcpBindAddress      ?? DEFAULT_CONFIG.mcpBindAddress,
      mcpBearerToken:     env('OZ_MCP_TOKEN')       ?? DEFAULT_CONFIG.mcpBearerToken,
      timeoutMs:          envNum('OZ_TIMEOUT_MS',      DEFAULT_CONFIG.timeoutMs),
      idleTimeoutMs:      envNum('OZ_IDLE_TIMEOUT_MS', DEFAULT_CONFIG.idleTimeoutMs),
    };
  }

  private _readYaml(workspaceRoot?: string): Partial<OzBridgeConfig> {
    const candidates: string[] = [
      workspaceRoot ? path.join(workspaceRoot, '.warp', 'warp-bridge.yaml') : '',
      path.join(os.homedir(), '.warp', 'warp-bridge.yaml'),
    ].filter(Boolean);

    for (const p of candidates) {
      try {
        const src = fs.readFileSync(p, 'utf8');
        return parseFlatYaml(src).data as Partial<OzBridgeConfig>;
      } catch {
        // file missing or unreadable — try next candidate
      }
    }
    return {};
  }
}
