import * as vscode from 'vscode';
import {
  IOzCliService,
  IConfigManager,
  SlashCommandHandler,
} from '../types/index.js';
import { OutputFormatter } from '../parsers/outputFormatter.js';
import { t } from '../core/i18n.js';

/**
 * Creates the `/status` slash-command handler.
 *
 * Without arguments, lists recent Oz runs; with a run ID, shows the detail
 * of that specific run.
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
        // Prompt contiene un runId → dettaglio
        stream.progress(t('oz.status_detail_progress', trimmed));
        const result = await cli.runGet(trimmed);
        formatter.formatRunResult(result, stream);
      } else {
        // Nessun runId → lista
        stream.progress(t('oz.status_list_progress'));
        const list = await cli.runList();
        if (list.items.length === 0) {
          stream.markdown(list.rawText
            ? `_${list.rawText}_\n`
            : t('oz.status_empty'));
        } else {
          formatter.formatList(list, ['id', 'status'], stream);
        }
      }
    } catch (err) {
      formatter.handleError(err, stream);
    }

    return {};
  };
}
