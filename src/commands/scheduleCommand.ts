import * as vscode from 'vscode';
import {
  IOzCliService,
  IConfigManager,
  SlashCommandHandler,
} from '../types/index.js';
import { OutputFormatter } from '../parsers/outputFormatter.js';

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
          stream.progress('Fetching schedules...');
          const list = await cli.scheduleList();
          if (list.items.length === 0) {
            stream.markdown('_No schedules found._\n');
          } else {
            formatter.formatList(list, ['id', 'name', 'cron', 'paused'], stream);
          }
          break;
        }

        case 'create': {
          // Format: create <name> <cron> <prompt>
          // Ex: create daily-lint "0 9 * * *" "Run linting"
          const createMatch = trimmed.match(/^create\s+(\S+)\s+(["'])([^"']+)\2\s+(["'])([^"']+)\4$/i);
          if (!createMatch) {
            stream.markdown('**Usage**: `/schedule create <name> "<cron>" "<prompt>"`\n\nExample: `/schedule create daily-lint "0 9 * * *" "Run linting"`\n_You can use single or double quotes._\n');
            break;
          }
          const [, name, , cron, , schedPrompt] = createMatch;
          stream.progress(`Creating schedule "${name}"...`);
          const schedule = await cli.scheduleCreate({
            name,
            cron,
            prompt: schedPrompt,
            environment: config.defaultEnvironment || undefined,
          });
          stream.markdown(`✅ **Schedule created**: \`${schedule.name}\` (ID: \`${schedule.id}\`)\n\nCron: \`${schedule.cron}\`\n`);
          break;
        }

        case 'pause': {
          const id = parts[1];
          if (!id) {
            stream.markdown('**Usage**: `/schedule pause <id>`\n');
            break;
          }
          stream.progress(`Pausing schedule ${id}...`);
          await cli.schedulePause(id);
          stream.markdown(`⏸️ Schedule \`${id}\` paused.\n`);
          break;
        }

        case 'unpause': {
          const id = parts[1];
          if (!id) {
            stream.markdown('**Usage**: `/schedule unpause <id>`\n');
            break;
          }
          stream.progress(`Resuming schedule ${id}...`);
          await cli.scheduleUnpause(id);
          stream.markdown(`▶️ Schedule \`${id}\` resumed.\n`);
          break;
        }

        case 'delete': {
          const id = parts[1];
          if (!id) {
            stream.markdown('**Usage**: `/schedule delete <id>`\n');
            break;
          }
          stream.progress(`Deleting schedule ${id}...`);
          await cli.scheduleDelete(id);
          stream.markdown(`🗑️ Schedule \`${id}\` deleted.\n`);
          break;
        }

        default:
          stream.markdown('**Available commands**:\n- `/schedule list` — list all schedules\n- `/schedule create <name> "<cron>" "<prompt>"` — create a schedule\n- `/schedule pause <id>` — pause\n- `/schedule unpause <id>` — resume\n- `/schedule delete <id>` — delete\n');
          break;
      }
    } catch (err) {
      formatter.handleError(err, stream);
    }

    return {};
  };
}
