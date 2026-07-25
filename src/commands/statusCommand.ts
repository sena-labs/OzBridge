import {
  IOzCliService,
  IConfigManager,
  SlashCommandHandler,
} from '../types/index.js';
import { OutputFormatter } from '../parsers/outputFormatter.js';

/**
 * Creates the `/status` slash-command handler.
 *
 * Focuses on currently active runs. Without arguments, lists runs with
 * status `QUEUED` or `INPROGRESS`; with a run ID, shows the detail of
 * that specific run.
 *
 * @param cli - Oz CLI service for `runList()` / `runGet()`.
 * @param cfgMgr - Configuration manager.
 * @returns A {@link SlashCommandHandler} for the `/status` command.
 */
export function createStatusCommand(
  cli: IOzCliService,
  cfgMgr: IConfigManager,
): SlashCommandHandler {
  const formatter = new OutputFormatter(cfgMgr);
  return async (prompt, stream, _token) => {

    try {
      const trimmed = prompt.trim();

      if (trimmed) {
        // Prompt contains a runId → detail
        stream.progress(`Fetching run status ${trimmed}...`);
        const result = await cli.runGet(trimmed);
        formatter.formatRunResult(result, stream);
      } else {
        // No runId → list of active runs only (QUEUED or INPROGRESS)
        stream.progress('Fetching active runs...');
        const list = await cli.runList();
        const active = list.items.filter(
          (item) => item.status === 'QUEUED' || item.status === 'INPROGRESS',
        );

        if (active.length === 0) {
          stream.markdown(list.rawText
            ? `_${list.rawText}_\n`
            : '_No active runs. Use `/history` to see past runs._\n');
        } else {
          stream.markdown(`**${active.length} active run${active.length === 1 ? '' : 's'}:**\n\n`);
          formatter.formatList({ items: active }, ['id', 'status'], stream);
        }
      }
    } catch (err) {
      formatter.handleError(err, stream);
    }

    return {};
  };
}
