import { BaseRunPoller } from 'copilot-chat-toolkit';
import { IOzCliService, IConfigManager } from '../types/index.js';

// IMPL: thin wrapper — delegates to toolkit's BaseRunPoller with Oz polling config

/**
 * Asynchronous poller for cloud Oz runs with exponential back-off.
 *
 * Extends the toolkit's {@link BaseRunPoller} with Warp-specific polling
 * configuration sourced from `warpBridge.cloudPollingIntervalMs` and
 * `warpBridge.cloudPollingTimeoutMs`.
 *
 * All polling logic (exponential back-off ×1.5, 30 s cap, AbortController,
 * VS Code CancellationToken integration) is inherited from the toolkit.
 */
export class RunPoller extends BaseRunPoller {
  constructor(cli: IOzCliService, configManager: IConfigManager) {
    super(cli, () => {
      const cfg = configManager.getConfig();
      return {
        intervalMs: cfg.cloudPollingIntervalMs,
        timeoutMs: cfg.cloudPollingTimeoutMs,
      };
    });
  }
}
