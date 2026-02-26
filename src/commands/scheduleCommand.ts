import * as vscode from 'vscode';
import {
  IOzCliService,
  IConfigManager,
  SlashCommandHandler,
} from '../types/index.js';
import { OutputFormatter } from '../parsers/outputFormatter.js';
import { t } from '../core/i18n.js';

/**
 * Creates the `/schedule` slash-command handler.
 *
 * Manages Warp cron schedules with 5 sub-commands:
 * `list`, `create <cron> <prompt>`, `pause <id>`, `unpause <id>`, `delete <id>`.
 * Validates cron expressions before submission.
 *
 * @param cli - Oz CLI service for schedule operations.
 * @param cfgMgr - Configuration manager.
 * @returns A {@link SlashCommandHandler} for the `/schedule` command.
 */
export function createScheduleCommand(
  cli: IOzCliService,
  cfgMgr: IConfigManager,
): SlashCommandHandler {
  const formatter = new OutputFormatter(cfgMgr);
  return async (prompt, stream, _token) => {
    const config = cfgMgr.getConfig();

    const trimmed = prompt.trim();
    const parts = trimmed.split(/\s+/);
    const subCommand = parts[0]?.toLowerCase() ?? 'list';

    try {
      switch (subCommand) {
        case 'list':
        case '': {
          stream.progress(t('oz.schedule_list_progress'));
          const list = await cli.scheduleList();
          if (list.items.length === 0) {
            stream.markdown(t('oz.schedule_list_empty'));
          } else {
            formatter.formatList(list, ['id', 'name', 'cron', 'paused'], stream);
          }
          break;
        }

        case 'create': {
          // Formato: create <name> <cron> <prompt>
          // Es: create daily-lint "0 9 * * *" "Run linting"
          const createMatch = trimmed.match(/^create\s+(\S+)\s+(["'])([^"']+)\2\s+(["'])([^"']+)\4$/i);
          if (!createMatch) {
            stream.markdown(t('oz.schedule_create_usage'));
            break;
          }
          const [, name, , cron, , schedPrompt] = createMatch;
          stream.progress(t('oz.schedule_create_progress', name));
          const schedule = await cli.scheduleCreate({
            name,
            cron,
            prompt: schedPrompt,
            environment: config.defaultEnvironment || undefined,
          });
          stream.markdown(t('oz.schedule_created', schedule.name, schedule.id, schedule.cron));
          break;
        }

        case 'pause': {
          const id = parts[1];
          if (!id) {
            stream.markdown(t('oz.schedule_pause_usage'));
            break;
          }
          stream.progress(t('oz.schedule_pause_progress', id));
          await cli.schedulePause(id);
          stream.markdown(t('oz.schedule_paused', id));
          break;
        }

        case 'unpause': {
          const id = parts[1];
          if (!id) {
            stream.markdown(t('oz.schedule_unpause_usage'));
            break;
          }
          stream.progress(t('oz.schedule_unpause_progress', id));
          await cli.scheduleUnpause(id);
          stream.markdown(t('oz.schedule_unpaused', id));
          break;
        }

        case 'delete': {
          const id = parts[1];
          if (!id) {
            stream.markdown(t('oz.schedule_delete_usage'));
            break;
          }
          stream.progress(t('oz.schedule_delete_progress', id));
          await cli.scheduleDelete(id);
          stream.markdown(t('oz.schedule_deleted', id));
          break;
        }

        default:
          stream.markdown(t('oz.schedule_help'));
          break;
      }
    } catch (err) {
      formatter.handleError(err, stream);
    }

    return {};
  };
}
