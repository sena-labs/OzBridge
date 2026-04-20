import * as vscode from 'vscode';
import { BaseConfigManager } from 'copilot-chat-toolkit';
import { WarpBridgeConfig, DEFAULT_CONFIG } from '../types/index.js';
import { WorkspaceConfigResolver } from './workspaceConfigResolver.js';

// IMPL: thin wrapper — delegates to toolkit's BaseConfigManager with Warp
// defaults, then layers an optional workspace YAML resolver on top so that
// `.warp/warp-bridge.yaml` wins over VS Code settings.

/**
 * Manages the `warpBridge.*` VS Code settings with an in-memory cache.
 *
 * When a {@link WorkspaceConfigResolver} is supplied, the values it returns
 * take precedence over the VS Code configuration — useful for
 * committed-to-Git per-project defaults (shared profiles, MCP port, etc.).
 *
 * Precedence, highest first:
 *   1. `.warp/warp-bridge.yaml` overrides
 *   2. `warpBridge.*` VS Code settings
 *   3. Compiled-in defaults
 */
export class ConfigManager extends BaseConfigManager<WarpBridgeConfig> {
  private readonly resolverSubscription: vscode.Disposable | undefined;

  constructor(private readonly resolver?: WorkspaceConfigResolver) {
    super('warpBridge', DEFAULT_CONFIG);
    if (resolver) {
      // When the YAML file changes, invalidate the cached snapshot and
      // fire the inherited `onConfigChanged` so downstream services (MCP
      // lifecycle, status bar, …) react without a reload. We use the
      // toolkit's protected hooks rather than poking private fields.
      this.resolverSubscription = resolver.onDidChange(() => {
        this.invalidate();
        this.fireChange();
      });
    }
  }

  protected readConfig(cfg: vscode.WorkspaceConfiguration): WarpBridgeConfig {
    const base = super.readConfig(cfg);
    if (!this.resolver) { return base; }
    const overrides = this.resolver.getOverrides();
    return { ...base, ...overrides } as WarpBridgeConfig;
  }

  dispose(): void {
    this.resolverSubscription?.dispose();
    super.dispose();
  }
}
