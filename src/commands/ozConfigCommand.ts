import * as vscode from 'vscode';
import {
  IOzCliService,
  IConfigManager,
  SlashCommandHandler,
} from '../types/index.js';
import { OutputFormatter } from '../parsers/outputFormatter.js';
import { logWarn, logError } from '../services/logger.js';
import { t } from '../core/i18n.js';

/**
 * Creates the `/config` slash-command handler.
 *
 * Displays the active Warp Bridge configuration, Oz CLI status, and
 * additional info (profiles, environments, integrations) when available.
 *
 * @param cli - Oz CLI service for profile/env/integration queries.
 * @param cfgMgr - Configuration manager.
 * @returns A {@link SlashCommandHandler} for the `/config` command.
 */
export function createConfigCommand(
  cli: IOzCliService,
  cfgMgr: IConfigManager,
): SlashCommandHandler {
  const formatter = new OutputFormatter(cfgMgr);
  return async (_prompt, stream, _token) => {
    const config = cfgMgr.getConfig();

    stream.markdown(t('oz.oz_config_title'));

    // Settings VS Code
    stream.markdown(t('oz.oz_config_settings_header'));
    stream.markdown(t('oz.oz_config_table_header'));
    stream.markdown(`| Oz Path | \`${config.ozPath}\` |\n`);
    stream.markdown(`| Default Model | \`${config.defaultModel}\` |\n`);
    stream.markdown(`| Default Profile | \`${config.defaultProfile}\` |\n`);
    stream.markdown(`| Default Environment | \`${config.defaultEnvironment || '(none)'}\` |\n`);
    stream.markdown(`| Timeout locale | ${config.timeoutMs / 1000}s |\n`);
    stream.markdown(`| Cloud polling interval | ${config.cloudPollingIntervalMs / 1000}s |\n`);
    stream.markdown(`| Cloud polling timeout | ${config.cloudPollingTimeoutMs / 1000}s |\n`);
    stream.markdown(`| Max output chars | ${config.maxOutputChars} |\n\n`);

    // Verifica CLI
    try {
      const avail = await cli.checkAvailability();
      stream.markdown(t('oz.oz_config_cli_title'));
      if (avail.available) {
        stream.markdown(t('oz.oz_config_available', avail.version ?? 'unknown'));

        // Profili
        try {
          const profiles = await cli.profileList();
          if (profiles.items.length > 0) {
            stream.markdown(t('oz.oz_config_profiles_header'));
            for (const p of profiles.items) {
              stream.markdown(`- \`${p.name}\` (${p.id})\n`);
            }
            stream.markdown('\n');
          }
        } catch (e) { logWarn('Failed to list profiles', e); }

        // Environments
        try {
          const envs = await cli.environmentList();
          if (envs.items.length > 0) {
            stream.markdown(t('oz.oz_config_envs_header'));
            for (const e of envs.items) {
              stream.markdown(`- \`${e.name}\` (${e.id}) — scope: ${e.scope}\n`);
            }
            stream.markdown('\n');
          }
        } catch (e) { logWarn('Failed to list environments', e); }

        // Integrations
        try {
          const integrations = await cli.integrationList();
          if (integrations.items.length > 0) {
            stream.markdown(t('oz.oz_config_integrations_header'));
            for (const i of integrations.items) {
              const connected = !i.status.toLowerCase().includes('not connected');
              stream.markdown(`- ${connected ? '🟢' : '🔴'} ${i.provider}: ${i.status}\n`);
            }
            stream.markdown('\n');
          }
        } catch (e) { logWarn('Failed to list integrations', e); }
      } else {
        stream.markdown(t('oz.oz_config_unavailable'));
        stream.button({
          command: 'vscode.open',
          arguments: [vscode.Uri.parse('https://www.warp.dev/download')],
          title: t('oz.oz_config_install_button'),
        });
      }
    } catch (err) {
      logError(`Config command error: ${err instanceof Error ? err.message : String(err)}`);
      formatter.handleError(err, stream);
    }

    return {};
  };
}
