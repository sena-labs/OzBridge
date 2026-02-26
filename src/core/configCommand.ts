// ============================================================================
// Core — /config Command
// ============================================================================
// IMPL: Phase 2 — Global config view, per-plugin summaries (§3.4 Architecture)

import type { SlashCommandHandler } from 'copilot-chat-toolkit';
import type { II18nService } from 'copilot-chat-toolkit';
import type { PluginRegistry } from './pluginRegistry.js';

/**
 * Creates the `/config` slash-command handler.
 *
 * Lists configuration status for each registered plugin.
 * If a plugin provides `configSummary()`, its result is displayed;
 * otherwise a "no summary" placeholder is shown.
 *
 * @param registry - Plugin registry for plugin enumeration.
 * @param i18n     - Internationalisation service.
 * @returns A {@link SlashCommandHandler} for `/config`.
 */
export function createConfigCommand(
  registry: PluginRegistry,
  i18n: II18nService,
): SlashCommandHandler {
  return async (_prompt, stream, _token) => {
    stream.markdown(i18n.t('core.config_title'));

    const all = registry.getAll();

    if (all.length === 0) {
      stream.markdown(i18n.t('core.plugins_empty'));
      return {};
    }

    for (const info of all) {
      const summary = info.registration.configSummary
        ? info.registration.configSummary()
        : i18n.t('core.config_no_summary');

      stream.markdown(
        i18n.t(
          'core.config_plugin_section',
          info.plugin.displayName,
          info.plugin.id,
          summary,
        ),
      );
    }

    return {};
  };
}
