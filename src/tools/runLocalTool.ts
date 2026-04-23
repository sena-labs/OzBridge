import * as vscode from 'vscode';
import { IOzCliService, IConfigManager, IContextCollector } from '../types/index.js';
import { errorResult, renderRunResult, textResult } from './baseTool.js';

/**
 * Input schema for `oz_run_local`.
 *
 * Must stay in sync with `contributes.languageModelTools[].inputSchema`
 * in `package.json` (keys, types, `required` flags).
 */
export interface RunLocalInput {
  prompt: string;
  model?: string;
  profile?: string;
  skill?: string;
  includeIdeContext?: boolean;
}

/**
 * LanguageModelTool that runs a local Warp Oz agent in the current workspace.
 *
 * Corresponds to `/run` but is invoked autonomously by the agent mode of the
 * VS Code chat. The IDE context (workspace path, active file, selection,
 * diagnostics) is injected into the prompt by default; the caller can opt out
 * via `includeIdeContext: false`.
 */
export class RunLocalTool implements vscode.LanguageModelTool<RunLocalInput> {
  static readonly name = 'oz_run_local';

  constructor(
    private readonly cli: IOzCliService,
    private readonly cfgMgr: IConfigManager,
    private readonly ctx: IContextCollector,
  ) {}

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<RunLocalInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    const { prompt, model, profile, skill } = options.input;
    const detail = [
      `**Prompt**: ${truncate(prompt, 200)}`,
      model ? `**Model**: \`${model}\`` : null,
      profile ? `**Profile**: \`${profile}\`` : null,
      skill ? `**Skill**: \`${skill}\`` : null,
    ].filter(Boolean).join('  \n');

    return {
      invocationMessage: new vscode.MarkdownString(
        `Running local Oz agent with prompt:\n\n${truncate(prompt, 120)}`,
      ),
      confirmationMessages: {
        title: 'Run local Oz agent?',
        message: new vscode.MarkdownString(
          `The Warp Oz CLI will run locally in the current workspace.\n\n${detail}`,
        ),
      },
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<RunLocalInput>,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const { prompt, model, profile, skill, includeIdeContext } = options.input;

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
      let workspacePath: string | undefined;

      if (includeIdeContext !== false) {
        const ctxPayload = this.ctx.gather();
        const contextBlock = this.ctx.formatForPrompt(ctxPayload);
        fullPrompt = `${contextBlock}\n\n${prompt}`;
        workspacePath = ctxPayload.workspacePath || undefined;
      }

      const result = await this.cli.agentRun({
        prompt: fullPrompt,
        model: model ?? (config.defaultModel !== 'auto' ? config.defaultModel : undefined),
        profile: profile ?? (config.defaultProfile !== 'Default' ? config.defaultProfile : undefined),
        skill,
        cwd: workspacePath,
        cancellation: token,
      });

      return textResult(renderRunResult(result, config.maxOutputChars));
    } catch (err) {
      return errorResult(err);
    }
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) { return text; }
  return text.substring(0, maxLen) + '…';
}
