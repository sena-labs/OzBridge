// ============================================================================
// Core — /plugins Command
// ============================================================================
// IMPL: Phase 2 — Lists registered plugins with status (§3.4 Architecture)

import type { SlashCommandHandler } from 'copilot-chat-toolkit';
import type { II18nService } from 'copilot-chat-toolkit';
import type { PluginRegistry } from './pluginRegistry.js';

/**
 * Creates the `/plugins` slash-command handler.
 *
 * Outputs a markdown table of all registered plugins showing:
 * id, displayName, version, status, and source.
 *
 * @param registry - Plugin registry for listing.
 * @param i18n     - Internationalisation service.
 * @returns A {@link SlashCommandHandler} for `/plugins`.
 */
export function createPluginsCommand(
  registry: PluginRegistry,
  i18n: II18nService,
): SlashCommandHandler {
  return async (_prompt, stream, _token) => {
    const all = registry.getAll();

    if (all.length === 0) {
      stream.markdown(i18n.t('core.plugins_empty'));
      return {};
    }

    // IMPL: header + table rows built via i18n catalog
    stream.markdown(i18n.t('core.plugins_title'));
    stream.markdown(i18n.t('core.plugins_header') + '\n');

    for (const info of all) {
      const statusIcon = info.status === 'active' ? '✅' : '❌';
      stream.markdown(
        i18n.t(
          'core.plugins_row',
          info.plugin.id,
          info.plugin.displayName,
          info.plugin.version,
          statusIcon,
          info.source,
        ) + '\n',
      );
    }

    return {};
  };
}
