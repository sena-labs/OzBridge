import * as vscode from 'vscode';
import {
  IOzCliService,
  IConfigManager,
  SlashCommandHandler,
} from '../types/index.js';
import { OutputFormatter } from '../parsers/outputFormatter.js';
import { t } from '../core/i18n.js';

/**
 * Creates the `/history` slash-command handler.
 *
 * Without arguments, lists recent agent runs with their status;
 * with a run ID, shows the full detail of that specific run.
 *
 * @param cli - Oz CLI service for `runList()` / `runGet()`.
 * @param cfgMgr - Configuration manager.
 * @returns A {@link SlashCommandHandler} for the `/history` command.
 */
export function createHistoryCommand(
  cli: IOzCliService,
  cfgMgr: IConfigManager,
): SlashCommandHandler {
  const formatter = new OutputFormatter(cfgMgr);
  return async (prompt, stream, _token) => {

    try {
      const trimmed = prompt.trim();

      if (trimmed) {
        // Prompt contains a runId → show detail
        stream.progress(t('oz.history_detail_progress', trimmed));
        const result = await cli.runGet(trimmed);
        formatter.formatRunResult(result, stream);
      } else {
        // No runId → list recent runs
        stream.progress(t('oz.history_progress'));
        const list = await cli.runList();
        if (list.items.length === 0) {
          stream.markdown(list.rawText
            ? `_${list.rawText}_\n`
            : t('oz.history_empty'));
        } else {
          stream.markdown(t('oz.history_count', list.items.length));
          formatter.formatList(list, ['id', 'status'], stream);
        }
      }
    } catch (err) {
      formatter.handleError(err, stream);
    }

    return {};
  };
}
