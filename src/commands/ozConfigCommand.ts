import * as vscode from 'vscode';
import {
  IOzCliService,
  IConfigManager,
  SlashCommandHandler,
} from '../types/index.js';
import { OutputFormatter } from '../parsers/outputFormatter.js';
import { logWarn, logError } from '../services/logger.js';

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

    stream.markdown('## ⚙️ Warp Bridge Configuration\n\n');

    // VS Code Settings
    stream.markdown('### Extension Settings\n\n');
    stream.markdown('| Parameter | Value |\n| --- | --- |\n');
    stream.markdown(`| Oz Path | \`${config.ozPath}\` |\n`);
    stream.markdown(`| Default Model | \`${config.defaultModel}\` |\n`);
    stream.markdown(`| Default Profile | \`${config.defaultProfile}\` |\n`);
    stream.markdown(`| Default Environment | \`${config.defaultEnvironment || '(none)'}\` |\n`);
    stream.markdown(`| Local timeout | ${config.timeoutMs / 1000}s |\n`);
    stream.markdown(`| Cloud polling interval | ${config.cloudPollingIntervalMs / 1000}s |\n`);
    stream.markdown(`| Cloud polling timeout | ${config.cloudPollingTimeoutMs / 1000}s |\n`);
    stream.markdown(`| Max output chars | ${config.maxOutputChars} |\n\n`);

    // CLI check
    try {
      const avail = await cli.checkAvailability();
      stream.markdown('### Oz CLI Status\n\n');
      if (avail.available) {
        stream.markdown(`✅ **Available** — version: \`${avail.version ?? 'unknown'}\`\n\n`);

        // Profiles
        try {
          const profiles = await cli.profileList();
          if (profiles.items.length > 0) {
            stream.markdown('**Profiles:**\n');
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
            stream.markdown('**Environments:**\n');
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
            stream.markdown('**Integrations:**\n');
            for (const i of integrations.items) {
              const connected = !i.status.toLowerCase().includes('not connected');
              stream.markdown(`- ${connected ? '🟢' : '🔴'} ${i.provider}: ${i.status}\n`);
            }
            stream.markdown('\n');
          }
        } catch (e) { logWarn('Failed to list integrations', e); }
      } else {
        stream.markdown('❌ **Not available** — install Warp and verify `oz` is in your PATH.\n');
        stream.button({
          command: 'vscode.open',
          arguments: [vscode.Uri.parse('https://www.warp.dev/download')],
          title: '📥 Install Warp',
        });
      }
    } catch (err) {
      logError(`Config command error: ${err instanceof Error ? err.message : String(err)}`);
      formatter.handleError(err, stream);
    }

    return {};
  };
}
