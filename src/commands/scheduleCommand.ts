import * as vscode from 'vscode';
import {
  IOzCliService,
  IConfigManager,
  SlashCommandHandler,
} from '../types/index.js';
import { OutputFormatter } from '../parsers/outputFormatter.js';

/**
 * Parses a single quoted argument starting at the beginning of `s`.
 *
 * Supports both `"…"` and `'…'` quoting. Inside the quoted value the
 * opposite quote character is allowed verbatim (so `"Run 'test' suite"`
 * works), and a literal backslash can escape the surrounding quote or
 * another backslash (`"He said \\"hi\\""`). Returns `null` if `s` does
 * not start with a quote or the closing quote is missing.
 */
function parseQuotedArg(s: string): { value: string; rest: string } | null {
  if (s.length === 0) { return null; }
  const quote = s[0];
  if (quote !== '"' && quote !== "'") { return null; }
  let value = '';
  let i = 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && (s[i + 1] === quote || s[i + 1] === '\\')) {
      value += s[i + 1];
      i += 2;
      continue;
    }
    if (c === quote) {
      return { value, rest: s.slice(i + 1) };
    }
    value += c;
    i += 1;
  }
  return null;
}

/**
 * Parses the arguments of `/schedule create <name> "<cron>" "<prompt>"`.
 *
 * Returns `null` when the input does not match the expected shape.
 */
function parseCreateArgs(
  input: string,
): { name: string; cron: string; prompt: string } | null {
  const nameMatch = input.match(/^(\S+)\s+/);
  if (!nameMatch) { return null; }
  let rest = input.slice(nameMatch[0].length);

  const cronArg = parseQuotedArg(rest);
  if (!cronArg) { return null; }
  rest = cronArg.rest.replace(/^\s+/, '');

  const promptArg = parseQuotedArg(rest);
  if (!promptArg || promptArg.rest.trim() !== '') { return null; }

  return { name: nameMatch[1], cron: cronArg.value, prompt: promptArg.value };
}

/**
 * Parses the optional flags of `/schedule update <id> [--name "x"] [--cron "y"] [--prompt "z"]`.
 *
 * Flags can appear in any order. Each flag MUST be followed by a quoted
 * value. Returns `null` only when the input contains a flag-like token
 * that is not one of the recognised flags (so the caller can show the
 * usage banner). An empty input yields an empty record (the caller then
 * tells the user that nothing would be changed).
 */
function parseUpdateArgs(
  input: string,
): { name?: string; cron?: string; prompt?: string } | null {
  const result: { name?: string; cron?: string; prompt?: string } = {};
  let rest = input.replace(/^\s+/, '');
  while (rest.length > 0) {
    const flagMatch = rest.match(/^(--name|--cron|--prompt)\s+/);
    if (!flagMatch) { return null; }
    const flag = flagMatch[1];
    rest = rest.slice(flagMatch[0].length);
    const arg = parseQuotedArg(rest);
    if (!arg) { return null; }
    rest = arg.rest.replace(/^\s+/, '');
    if (flag === '--name') { result.name = arg.value; }
    else if (flag === '--cron') { result.cron = arg.value; }
    else if (flag === '--prompt') { result.prompt = arg.value; }
  }
  return result;
}

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
          // Supports nested quotes of the opposite kind and `\\"` / `\\'` escapes.
          const argsInput = trimmed.slice('create'.length).replace(/^\s+/, '');
          const parsed = parseCreateArgs(argsInput);
          if (!parsed) {
            stream.markdown('**Usage**: `/schedule create <name> "<cron>" "<prompt>"`\n\nExample: `/schedule create daily-lint "0 9 * * *" "Run linting"`\n_You can use single or double quotes; nested quotes of the opposite kind are allowed (e.g. `"Run \'test\' suite"`)._\n');
            break;
          }
          const { name, cron, prompt: schedPrompt } = parsed;
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

        case 'get': {
          const id = parts[1];
          if (!id) {
            stream.markdown('**Usage**: `/schedule get <id>`\n');
            break;
          }
          stream.progress(`Fetching schedule ${id}...`);
          const sched = await cli.scheduleGet(id);
          stream.markdown(
            `**Schedule** \`${sched.id}\`\n\n` +
            `- **Name**: \`${sched.name}\`\n` +
            `- **Cron**: \`${sched.cron}\`\n` +
            `- **Status**: ${sched.paused ? '⏸️ paused' : '▶️ running'}\n` +
            `- **Prompt**:\n\n\`\`\`\n${sched.prompt}\n\`\`\`\n`,
          );
          break;
        }

        case 'update': {
          // Format: update <id> [--name "<x>"] [--cron "<y>"] [--prompt "<z>"]
          const id = parts[1];
          if (!id) {
            stream.markdown('**Usage**: `/schedule update <id> [--name "<name>"] [--cron "<cron>"] [--prompt "<prompt>"]`\n');
            break;
          }
          const updates = parseUpdateArgs(
            trimmed.slice('update'.length).replace(/^\s+/, '').slice(id.length).replace(/^\s+/, ''),
          );
          if (!updates) {
            stream.markdown('**Usage**: `/schedule update <id> [--name "<name>"] [--cron "<cron>"] [--prompt "<prompt>"]`\n');
            break;
          }
          if (!updates.name && !updates.cron && !updates.prompt) {
            stream.markdown('_Nothing to update — pass at least one of `--name`, `--cron`, `--prompt`._\n');
            break;
          }
          stream.progress(`Updating schedule ${id}...`);
          const updated = await cli.scheduleUpdate({ id, ...updates });
          stream.markdown(`✅ **Schedule updated**: \`${updated.name}\` (ID: \`${updated.id}\`)\n\nCron: \`${updated.cron}\`\n`);
          break;
        }

        default:
          stream.markdown('**Available commands**:\n- `/schedule list` — list all schedules\n- `/schedule get <id>` — show one schedule\n- `/schedule create <name> "<cron>" "<prompt>"` — create a schedule\n- `/schedule update <id> [--name "<x>"] [--cron "<y>"] [--prompt "<z>"]` — edit a schedule\n- `/schedule pause <id>` — pause\n- `/schedule unpause <id>` — resume\n- `/schedule delete <id>` — delete\n');
          break;
      }
    } catch (err) {
      formatter.handleError(err, stream);
    }

    return {};
  };
}
