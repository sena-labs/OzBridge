import * as vscode from 'vscode';
import {
  IOzCliService,
  IConfigManager,
  IContextCollector,
  IRunPoller,
} from '../types/index.js';
import { errorResult, renderRunResult, textResult } from './baseTool.js';

/**
 * Input schema for `warp_run_cloud`.
 *
 * Must stay in sync with `contributes.languageModelTools[].inputSchema`
 * in `package.json` (keys, types, `required` flags).
 */
export interface RunCloudInput {
  prompt: string;
  model?: string;
  environment?: string;
  skill?: string;
  includeIdeContext?: boolean;
  wait?: boolean;
}

/**
 * LanguageModelTool that launches a cloud Oz agent run.
 *
 * **Cloud runs consume Warp credits**, therefore `prepareInvocation` surfaces
 * a confirmation dialog with a prominent credits warning regardless of the
 * user's `Bypass Approvals` preference.
 *
 * Behaviour:
 * - If `wait` is omitted or `true` and the run returned a `runId`, the tool
 *   polls until a terminal status is reached (via {@link IRunPoller}).
 * - If `wait` is `false`, returns immediately with the submitted run ID.
 */
export class RunCloudTool implements vscode.LanguageModelTool<RunCloudInput> {
  static readonly name = 'warp_run_cloud';

  constructor(
    private readonly cli: IOzCliService,
    private readonly cfgMgr: IConfigManager,
    private readonly ctx: IContextCollector,
    private readonly poller: IRunPoller,
  ) {}

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<RunCloudInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    const { prompt, model, environment, skill } = options.input;
    const cfg = this.cfgMgr.getConfig();
    const env = environment ?? cfg.defaultEnvironment ?? '(auto-detect)';

    const detail = [
      `**Prompt**: ${truncate(prompt, 200)}`,
      `**Environment**: \`${env}\``,
      model ? `**Model**: \`${model}\`` : null,
      skill ? `**Skill**: \`${skill}\`` : null,
    ].filter(Boolean).join('  \n');

    return {
      invocationMessage: new vscode.MarkdownString(
        `☁️ Launching cloud Oz agent:\n\n${truncate(prompt, 120)}`,
      ),
      confirmationMessages: {
        title: '⚠️ Launch cloud Oz agent? (consumes Warp credits)',
        message: new vscode.MarkdownString(
          `**This operation consumes Warp cloud credits.**\n\n${detail}`,
        ),
      },
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<RunCloudInput>,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const { prompt, model, environment, skill, includeIdeContext, wait } = options.input;

    if (!prompt || !prompt.trim()) {
      return textResult('❌ **Missing input**: `prompt` is required and must not be empty.');
    }

    try {
      const avail = await this.cli.checkAvailability();
      if (!avail.available) {
        return textResult(
          '⚠️ **Oz CLI not found.** Install Warp (https://www.warp.dev/download) and ensure `oz` is in PATH.',
        );
      }

      const config = this.cfgMgr.getConfig();
      let fullPrompt = prompt;
      if (includeIdeContext !== false) {
        const ctxPayload = this.ctx.gather();
        fullPrompt = `${this.ctx.formatForPrompt(ctxPayload)}\n\n${prompt}`;
      }

      // Resolve environment: explicit input > config > auto-detect first available > none.
      // Empty strings from `defaultEnvironment` are normalized to undefined so the
      // CLI call does not receive a bogus empty `--environment ''`.
      let envId: string | undefined = (environment || config.defaultEnvironment) || undefined;
      let noEnvironment = false;
      if (!envId) {
        try {
          const envResult = await this.cli.environmentList();
          if (envResult.items.length > 0) {
            envId = envResult.items[0].id;
          } else {
            noEnvironment = true;
          }
        } catch {
          noEnvironment = true;
        }
      }

      const result = await this.cli.agentRunCloud({
        prompt: fullPrompt,
        model: model ?? (config.defaultModel !== 'auto' ? config.defaultModel : undefined),
        environment: envId,
        noEnvironment,
        open: false, // tool invocation should never pop a Warp window
        skill,
        cancellation: token,
      });

      // If we have a runId and the caller did not opt out, poll to terminal state.
      if (result.runId && wait !== false) {
        try {
          const finalResult = await this.poller.poll(
            result.runId,
            () => { /* no UI progress inside a tool call */ },
            token,
          );
          return textResult(
            `☁️ **Cloud run finished**\n\n` +
            renderRunResult(finalResult, config.maxOutputChars),
          );
        } catch (pollErr) {
          return errorResult(pollErr);
        }
      }

      // Submitted without waiting (or no runId returned)
      return textResult(
        result.runId
          ? `☁️ **Cloud run submitted** — Run ID: \`${result.runId}\`\n\n` +
            'Call `warp_get_run` with this ID to retrieve status later.'
          : renderRunResult(result, config.maxOutputChars),
      );
    } catch (err) {
      return errorResult(err);
    }
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) { return text; }
  return text.substring(0, maxLen) + '…';
}
