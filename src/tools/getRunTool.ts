import * as vscode from 'vscode';
import { IOzCliService, IConfigManager } from '../types/index.js';
import { errorResult, renderRunResult, textResult } from './baseTool.js';

/**
 * Input schema for `warp_get_run`.
 */
export interface GetRunInput {
  runId: string;
}

/**
 * LanguageModelTool that fetches the details of a specific Oz run by its ID.
 *
 * No side effects. Used by the agent when the user (or another tool invocation)
 * references a run ID and wants to know the status and output.
 */
export class GetRunTool implements vscode.LanguageModelTool<GetRunInput> {
  static readonly name = 'warp_get_run';

  constructor(
    private readonly cli: IOzCliService,
    private readonly cfgMgr: IConfigManager,
  ) {}

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<GetRunInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: new vscode.MarkdownString(
        `Fetching details for run \`${options.input.runId}\`…`,
      ),
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<GetRunInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const { runId } = options.input;

    if (!runId || !runId.trim()) {
      return textResult('❌ **Missing input**: `runId` is required.');
    }

    try {
      const result = await this.cli.runGet(runId.trim());
      return textResult(renderRunResult(result, this.cfgMgr.getConfig().maxOutputChars));
    } catch (err) {
      return errorResult(err);
    }
  }
}
