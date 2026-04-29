import * as vscode from 'vscode';
import {
  IOzCliService,
  IConfigManager,
  OzRunStatus,
  SlashCommandHandler,
} from '../types/index.js';
import { OutputFormatter } from '../parsers/outputFormatter.js';

type HistoryFilter = 'all' | 'succeeded' | 'failed';

function parseHistoryArgs(
  prompt: string,
): { filter: HistoryFilter; runId: string | null; conflictingFilters: string[] } {
  const tokens = prompt.trim().split(/\s+/).filter(Boolean);
  let filter: HistoryFilter = 'all';
  let filterSet = false;
  let runId: string | null = null;
  const seenFilters: string[] = [];

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === 'succeeded' || lower === 'failed' || lower === 'all') {
      // First filter token wins; subsequent ones are tracked so the
      // command can warn the user instead of silently overriding.
      if (!filterSet) {
        filter = lower;
        filterSet = true;
      }
      seenFilters.push(lower);
    } else if (!runId) {
      runId = token;
    }
  }

  const conflictingFilters = seenFilters.length > 1 ? seenFilters : [];
  return { filter, runId, conflictingFilters };
}

function matchesFilter(status: OzRunStatus, filter: HistoryFilter): boolean {
  if (filter === 'all') {
    return status === 'SUCCEEDED' || status === 'FAILED';
  }
  if (filter === 'succeeded') {
    return status === 'SUCCEEDED';
  }
  return status === 'FAILED';
}

/**
 * Creates the `/history` slash-command handler.
 *
 * Focuses on completed runs. Without arguments, lists runs with status
 * `SUCCEEDED` or `FAILED`. Accepts an optional filter token
 * (`succeeded`, `failed`, `all`) and/or a run ID for details.
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
      const { filter, runId, conflictingFilters } = parseHistoryArgs(prompt);

      if (conflictingFilters.length > 0) {
        stream.markdown(
          `_⚠️ Multiple filter tokens (${conflictingFilters.join(', ')}); using \`${filter}\`._\n`,
        );
      }

      if (runId) {
        // Run ID provided → show detail
        stream.progress(`Fetching run details for ${runId}...`);
        const result = await cli.runGet(runId);
        formatter.formatRunResult(result, stream);
        return {};
      }

      // No runId → list completed runs
      stream.progress('Fetching run history...');
      const list = await cli.runList();
      const completed = list.items.filter((item) => matchesFilter(item.status, filter));

      if (completed.length === 0) {
        stream.markdown(list.rawText
          ? `_${list.rawText}_\n`
          : '_No runs in history._\n');
      } else {
        const label = filter === 'all' ? 'completed' : filter;
        stream.markdown(`**${completed.length} ${label} run${completed.length === 1 ? '' : 's'}:**\n\n`);
        formatter.formatList({ items: completed }, ['id', 'status'], stream);
      }
    } catch (err) {
      formatter.handleError(err, stream);
    }

    return {};
  };
}
