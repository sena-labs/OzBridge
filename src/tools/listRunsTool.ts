import * as vscode from 'vscode';
import { IOzCliService } from '../types/index.js';
import { errorResult, filterRunsByStatus, StatusFilter, textResult } from './baseTool.js';

/**
 * Input schema for `oz_list_runs`.
 */
export interface ListRunsInput {
  status?: StatusFilter;
  limit?: number;
}

/**
 * LanguageModelTool that lists recent Oz runs with an optional status filter.
 *
 * The filter supports the semantic aliases `active` (QUEUED + INPROGRESS) and
 * `completed` (SUCCEEDED + FAILED), plus the raw OzRunStatus values.
 */
export class ListRunsTool implements vscode.LanguageModelTool<ListRunsInput> {
  static readonly name = 'oz_list_runs';

  constructor(private readonly cli: IOzCliService) {}

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ListRunsInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    const filter = options.input.status ?? 'all';
    return {
      invocationMessage: new vscode.MarkdownString(
        `Listing Oz runs (filter: \`${filter}\`)…`,
      ),
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ListRunsInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const { status = 'all', limit } = options.input;

    try {
      const list = await this.cli.runList();

      if (list.items.length === 0) {
        return textResult(
          list.rawText
            ? `_${list.rawText}_`
            : '_No runs found._',
        );
      }

      const filtered = filterRunsByStatus(list.items, status);
      const capped = typeof limit === 'number' && limit > 0
        ? filtered.slice(0, limit)
        : filtered;

      if (capped.length === 0) {
        return textResult(`_No runs match filter \`${status}\`._`);
      }

      const lines = [
        `**${capped.length} run${capped.length === 1 ? '' : 's'}** (filter: \`${status}\`)`,
        '',
        '| Run ID | Status |',
        '| --- | --- |',
        ...capped.map((r) => `| \`${r.id}\` | ${r.status} |`),
      ];
      return textResult(lines.join('\n'));
    } catch (err) {
      return errorResult(err);
    }
  }
}
