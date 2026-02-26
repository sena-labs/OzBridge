import { BaseConfigManager } from 'copilot-chat-toolkit';
import { WarpBridgeConfig, DEFAULT_CONFIG } from '../types/index.js';

// IMPL: thin wrapper — delegates to toolkit's BaseConfigManager with Warp defaults

/**
 * Manages the `warpBridge.*` VS Code settings with an in-memory cache.
 *
 * Extends the toolkit's {@link BaseConfigManager} with the Warp-specific
 * configuration section name and default values.
 */
export class ConfigManager extends BaseConfigManager<WarpBridgeConfig> {
  constructor() {
    super('warpBridge', DEFAULT_CONFIG);
  }
}
