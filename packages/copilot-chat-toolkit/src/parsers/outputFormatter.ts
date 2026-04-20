import * as vscode from 'vscode';
import { RunResult, ListResult, CliError, CliErrorKind, BridgeConfig } from '../types.js';

/**
 * Configuration for the output formatter.
 * All options are optional — sensible defaults are provided.
 */
export interface FormatterOptions {
  /** URL for the CLI install page (shown on NOT_FOUND errors). */
  installUrl?: string;
  /** Label for the install button. */
  installLabel?: string;
  /** URL for the login page (shown on NOT_AUTHENTICATED errors). */
  loginUrl?: string;
  /** Label for the login button. */
  loginLabel?: string;
  /** URL template for opening a run in the web UI. `{runId}` is replaced. */
  runUrlTemplate?: string;
  /** Label for the "open run" button. */
  runUrlLabel?: string;
}

const DEFAULTS: Required<FormatterOptions> = {
  installUrl: '#',
  installLabel: '📥 Install CLI',
  loginUrl: '#',
  loginLabel: '🔑 Login',
  runUrlTemplate: '',
  runUrlLabel: '🔗 Open in browser',
};

/**
 * Formats CLI output (run results, lists, errors) for a VS Code Chat stream.
 *
 * Designed to be extended or configured per-product via {@link FormatterOptions}.
 */
export class OutputFormatter {
  protected readonly opts: Required<FormatterOptions>;

  constructor(
    private readonly getConfig: () => Pick<BridgeConfig, 'maxOutputChars' | 'timeoutMs'>,
    options?: FormatterOptions,
  ) {
    this.opts = { ...DEFAULTS, ...options };
  }

  /** Render an agent run result to the chat stream. */
  formatRunResult(result: RunResult, stream: vscode.ChatResponseStream): void {
    const statusIcon = result.status === 'SUCCEEDED' ? '✅' : '❌';
    stream.markdown(`${statusIcon} **Agent run** — status: \`${result.status}\`\n\n`);

    if (result.runId) {
      stream.markdown(`**Run ID**: \`${result.runId}\`\n\n`);
    }
    if (result.durationMs > 0) {
      stream.markdown(`⏱️ Duration: ${(result.durationMs / 1000).toFixed(1)}s\n\n`);
    }
    if (result.output) {
      stream.markdown(`---\n\n${this.truncate(result.output)}\n`);
    }
    if (result.runId && this.opts.runUrlTemplate) {
      const url = this.opts.runUrlTemplate.replace('{runId}', result.runId);
      stream.button({
        command: 'vscode.open',
        arguments: [vscode.Uri.parse(url)],
        title: this.opts.runUrlLabel,
      });
    }
  }

  /** Render a list of items as a markdown table. */
  formatList<T>(
    listResult: ListResult<T>,
    columns: Array<keyof T & string>,
    stream: vscode.ChatResponseStream,
  ): void {
    if (listResult.items.length === 0) {
      stream.markdown(listResult.rawText ? `_${listResult.rawText}_\n` : '_No items found._\n');
      return;
    }
    const headerRow = '| ' + columns.join(' | ') + ' |';
    const separatorRow = '| ' + columns.map(() => '---').join(' | ') + ' |';
    const dataRows = listResult.items.map(
      (item) => '| ' + columns.map((col) => String((item as Record<string, unknown>)[col] ?? '')).join(' | ') + ' |',
    );
    stream.markdown([headerRow, separatorRow, ...dataRows].join('\n') + '\n');
  }

  /** Render a typed CLI error with contextual actions. */
  formatError(error: CliError, stream: vscode.ChatResponseStream): void {
    switch (error.kind) {
      case CliErrorKind.NOT_FOUND:
        stream.markdown('⚠️ **CLI not found.** Make sure the CLI is installed and in your PATH.\n\n');
        if (this.opts.installUrl !== '#') {
          stream.button({
            command: 'vscode.open',
            arguments: [vscode.Uri.parse(this.opts.installUrl)],
            title: this.opts.installLabel,
          });
        }
        break;

      case CliErrorKind.NOT_AUTHENTICATED:
        stream.markdown('🔒 **Not authenticated.** Please log in first.\n\n');
        if (this.opts.loginUrl !== '#') {
          stream.button({
            command: 'vscode.open',
            arguments: [vscode.Uri.parse(this.opts.loginUrl)],
            title: this.opts.loginLabel,
          });
        }
        break;

      case CliErrorKind.INSUFFICIENT_CREDITS:
        stream.markdown(
          '💳 **Account out of credits or quota.** The remote service rejected the request.\n\n'
          + 'Top up your account or upgrade your plan, then retry.\n',
        );
        if (error.stderr) {
          stream.markdown(`\n<details><summary>CLI output</summary>\n\n\`\`\`\n${error.stderr.substring(0, 500)}\n\`\`\`\n\n</details>\n`);
        }
        break;

      case CliErrorKind.STALLED:
        stream.markdown(
          '🛑 **CLI unresponsive.** The process produced no output for the configured idle window and was terminated.\n\n'
          + 'Most common causes: depleted account credits, network outage, or the CLI is waiting for an interactive prompt outside the editor.\n',
        );
        break;

      case CliErrorKind.TIMEOUT: {
        const secs = this.getConfig().timeoutMs / 1000;
        stream.markdown(
          `⏰ **Timeout.** The operation exceeded the ${secs}s limit.\n\n`
          + 'Common causes: account out of credits (the CLI may hang waiting for an interactive prompt), slow network, or a genuinely long-running task.\n',
        );
        break;
      }

      case CliErrorKind.CANCELLED:
        stream.markdown('🚫 **Operation cancelled.**\n');
        break;

      case CliErrorKind.PARSE_ERROR:
        stream.markdown(
          `⚠️ **Parse error.** Unexpected CLI output.\n\n` +
          `\`\`\`\n${error.stderr?.substring(0, 500) ?? error.message}\n\`\`\`\n`,
        );
        break;

      default:
        stream.markdown(
          `❌ **CLI error** (exit code ${error.exitCode ?? '?'}):\n\n` +
          `\`\`\`\n${error.message}\n\`\`\`\n`,
        );
        if (error.stderr) {
          stream.markdown(`\n**stderr:**\n\`\`\`\n${error.stderr.substring(0, 500)}\n\`\`\`\n`);
        }
        break;
    }
  }

  /** Truncate text to the configured maximum with an indicator. */
  protected truncate(text: string): string {
    const max = this.getConfig().maxOutputChars;
    if (text.length <= max) {
      return text;
    }
    const remaining = text.length - max;
    return `${text.substring(0, max)}\n\n---\n_… output truncated (${remaining} chars remaining)._\n`;
  }
}
