import * as vscode from 'vscode';
import {
  OzRunResult,
  OzListResult,
  OzCliError,
  OzCliErrorKind,
  WarpBridgeConfig,
  IConfigManager,
} from '../types/index.js';

// IMPL: formattazione output Oz CLI → ChatResponseStream con troncamento (D7)

const WARP_INSTALL_URL = 'https://www.warp.dev/download';
const WARP_LOGIN_URL = 'https://app.warp.dev';

/** Formats Oz CLI output (run results, lists, errors) for the VS Code Chat stream. */
export class OutputFormatter {
  private readonly cfgMgr: IConfigManager;

  constructor(configManager: IConfigManager) {
    this.cfgMgr = configManager;
  }

  /** Lazily reads the current config — always reflects latest VS Code settings. */
  private get config(): WarpBridgeConfig {
    return this.cfgMgr.getConfig();
  }

  // IMPL: format an agent run result into the chat stream
  formatRunResult(
    result: OzRunResult,
    stream: vscode.ChatResponseStream,
    opts?: { autoOpened?: boolean; local?: boolean },
  ): void {
    const statusIcon = result.status === 'SUCCEEDED' ? '✅' : '❌';

    stream.markdown(`${statusIcon} **Agent run** — status: \`${result.status}\`\n\n`);

    if (result.runId) {
      stream.markdown(`**Run ID**: \`${result.runId}\`\n\n`);
    }

    if (result.durationMs > 0) {
      const secs = (result.durationMs / 1000).toFixed(1);
      stream.markdown(`⏱️ Duration: ${secs}s\n\n`);
    }

    if (result.output) {
      const output = this.truncate(result.output);
      stream.markdown(`---\n\n${output}\n`);
    }

    if (result.runId && !opts?.autoOpened && !opts?.local) {
      // Cloud run without auto-open → show web link to cloud session
      const sessionUrl = this.extractSessionUrl(result)
        || `https://app.warp.dev/session/${result.runId}`;
      stream.button({
        command: 'vscode.open',
        arguments: [vscode.Uri.parse(sessionUrl)],
        title: '🌐 Open in browser',
      });
    }
    // autoOpened: Warp terminal opened automatically via --open flag
    // local: run executed locally, conversation_id is not a web session
  }

  /**
   * Extracts the session URL from the raw output text of a cloud run.
   * Looks for "View agent session: https://app.warp.dev/session/..."
   */
  private extractSessionUrl(result: OzRunResult): string | null {
    const text = result.output || (typeof result.raw === 'string' ? result.raw : '');
    const match = text.match(/https:\/\/app\.warp\.dev\/session\/[a-f0-9-]+/i);
    return match ? match[0] : null;
  }

  /**
   * Renders a list of items as a markdown table in the chat stream.
   *
   * Each item is accessed dynamically via its string keys; `T` is expected
   * to be a flat DTO (e.g. {@link OzModel}, {@link OzProfile}).
   */
  formatList<T>(
    listResult: OzListResult<T>,
    columns: Array<keyof T & string>,
    stream: vscode.ChatResponseStream,
  ): void {
    if (listResult.items.length === 0) {
      stream.markdown(listResult.rawText
        ? `_${listResult.rawText}_\n`
        : '_No items found._\n');
      return;
    }

    // Header tabella
    const headerRow = '| ' + columns.join(' | ') + ' |';
    const separatorRow = '| ' + columns.map(() => '---').join(' | ') + ' |';
    const dataRows = listResult.items.map(
      (item) => '| ' + columns.map((col) => String((item as Record<string, unknown>)[col] ?? '')).join(' | ') + ' |'
    );

    stream.markdown([headerRow, separatorRow, ...dataRows].join('\n') + '\n');
  }

  // IMPL: format an error with suggested action (login button, install link)
  formatError(error: OzCliError, stream: vscode.ChatResponseStream): void {
    switch (error.kind) {
      case OzCliErrorKind.NOT_FOUND:
        stream.markdown('⚠️ **Oz CLI not found.** Make sure Warp is installed and `oz` is in your PATH.\n\n');
        stream.button({
          command: 'vscode.open',
          arguments: [vscode.Uri.parse(WARP_INSTALL_URL)],
          title: '📥 Install Warp',
        });
        break;

      case OzCliErrorKind.NOT_AUTHENTICATED:
        stream.markdown('🔒 **Not authenticated.** Please log in to Warp.\n\n');
        stream.button({
          command: 'vscode.open',
          arguments: [vscode.Uri.parse(WARP_LOGIN_URL)],
          title: '🔑 Login Warp',
        });
        break;

      case OzCliErrorKind.INSUFFICIENT_CREDITS:
        stream.markdown(
          '💳 **Out of Warp credits.** Your account has hit its quota or has no credits left, '
          + 'so the agent could not start.\n\n'
          + 'Open the Warp account dashboard to top up or upgrade your plan, then retry.\n',
        );
        if (error.stderr) {
          stream.markdown(`\n<details><summary>CLI output</summary>\n\n\`\`\`\n${error.stderr.substring(0, 500)}\n\`\`\`\n\n</details>\n`);
        }
        stream.button({
          command: 'vscode.open',
          arguments: [vscode.Uri.parse('https://app.warp.dev/settings/billing')],
          title: '💳 Manage Warp billing',
        });
        break;

      case OzCliErrorKind.STALLED:
        stream.markdown(
          `🛑 **Oz CLI unresponsive.** No output for ${this.config.idleTimeoutMs / 1000}s — the process was terminated to avoid waiting the full ${this.config.timeoutMs / 1000}s timeout.\n\n`
          + 'Most common causes:\n'
          + '- Warp account out of credits (top up at https://app.warp.dev/settings/billing)\n'
          + '- Network outage or upstream Warp service degradation\n'
          + '- Warp desktop app waiting for an interactive prompt outside VS Code.\n\n'
          + 'Adjust **Settings → OzBridge → Idle Timeout Ms** if your prompts are legitimately long-running with periods of silence.\n',
        );
        break;

      case OzCliErrorKind.TIMEOUT:
        stream.markdown(
          `⏰ **Timeout.** Operation exceeded the ${this.config.timeoutMs / 1000}s limit.\n\n`
          + 'Common causes:\n'
          + '- Warp account out of credits (the CLI may hang waiting for an interactive prompt)\n'
          + '- Slow network or upstream service degradation\n'
          + '- Prompt is genuinely large — increase the limit in **Settings → OzBridge → Timeout**.\n',
        );
        break;

      case OzCliErrorKind.CANCELLED:
        stream.markdown('🚫 **Operation cancelled.**\n');
        break;

      case OzCliErrorKind.PARSE_ERROR:
        stream.markdown(
          '⚠️ **Parsing error.** Unexpected output from Oz CLI.\n\n' +
          `\`\`\`\n${error.stderr?.substring(0, 500) ?? error.message}\n\`\`\`\n`,
        );
        break;

      default:
        stream.markdown(
          `❌ **CLI Error** (exit code ${error.exitCode ?? '?'}):\n\n` +
          `\`\`\`\n${error.message}\n\`\`\`\n`,
        );
        // Avoid printing the same payload twice when OzCliError was
        // constructed with `message = stderr` (typical non-zero exits).
        if (error.stderr && error.stderr.trim() !== error.message.trim()) {
          stream.markdown(`\n**stderr:**\n\`\`\`\n${error.stderr.substring(0, 500)}\n\`\`\`\n`);
        }
        break;
    }
  }

  /**
   * Convenience method for the common catch pattern.
   * Handles both {@link OzCliError} and generic `unknown` errors.
   */
  handleError(err: unknown, stream: vscode.ChatResponseStream): void {
    if (err instanceof OzCliError) {
      this.formatError(err, stream);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      stream.markdown(`❌ Error: ${msg}\n`);
    }
  }

  // IMPL: truncate output to maxOutputChars with indicator (default 15000)
  private truncate(text: string): string {
    if (text.length <= this.config.maxOutputChars) {
      return text;
    }
    const truncated = text.substring(0, this.config.maxOutputChars);
    const remaining = text.length - this.config.maxOutputChars;
    return truncated + `\n\n---\n_… output truncated (${remaining} chars remaining). Use \`/status\` with the Run ID for full output._\n`;
  }
}
