// ============================================================================
// Core — /help Command
// ============================================================================
// IMPL: Phase 2 — Context-aware help: core + plugin subcommands (§3.4 Architecture)

import type { SlashCommandHandler } from 'copilot-chat-toolkit';
import type { II18nService } from 'copilot-chat-toolkit';
import type { PluginRegistry } from './pluginRegistry.js';

/**
 * Creates the `/help` slash-command handler.
 *
 * - Without arguments: shows core commands and all plugin subcommands.
 * - With a plugin name: shows only that plugin's subcommands.
 *
 * @param registry - Plugin registry for plugin enumeration.
 * @param i18n     - Internationalisation service.
 * @returns A {@link SlashCommandHandler} for `/help`.
 */
export function createHelpCommand(
  registry: PluginRegistry,
  i18n: II18nService,
): SlashCommandHandler {
  return async (prompt, stream, _token) => {
    const target = prompt.trim().toLowerCase();

    // IMPL: if a specific plugin is requested, show only its commands
    if (target) {
      const info = registry.get(target);
      if (!info) {
        stream.markdown(i18n.t('core.help_plugin_not_found', target));
        return {};
      }

      stream.markdown(
        i18n.t('core.help_plugin_section', info.plugin.displayName, info.plugin.id),
      );

      for (const [name, _handler] of info.registration.commands) {
        stream.markdown(i18n.t('core.help_plugin_command', info.plugin.id, name, name));
      }

      return {};
    }

    // IMPL: general help — core + all plugins
    stream.markdown(i18n.t('core.help_title'));
    stream.markdown(i18n.t('core.help_core_section'));

    for (const info of registry.getAll()) {
      if (info.status !== 'active') {
        continue;
      }

      stream.markdown(
        i18n.t('core.help_plugin_section', info.plugin.displayName, info.plugin.id),
      );

      for (const [name, _handler] of info.registration.commands) {
        stream.markdown(i18n.t('core.help_plugin_command', info.plugin.id, name, name));
      }
    }

    return {};
  };
}
