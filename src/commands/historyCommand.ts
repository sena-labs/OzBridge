import * as vscode from 'vscode';
import {
  IOzCliService,
  IConfigManager,
  OzRunStatus,
  SlashCommandHandler,
} from '../types/index.js';
import { OutputFormatter } from '../parsers/outputFormatter.js';

type HistoryFilter = 'all' | 'succeeded' | 'failed';

function parseHistoryArgs(prompt: string): { filter: HistoryFilter; runId: string | null } {
  const tokens = prompt.trim().split(/\s+/).filter(Boolean);
  let filter: HistoryFilter = 'all';
  let runId: string | null = null;

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === 'succeeded' || lower === 'failed' || lower === 'all') {
      filter = lower;
    } else if (!runId) {
      runId = token;
    }
  }
  return { filter, runId };
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
      const { filter, runId } = parseHistoryArgs(prompt);

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
