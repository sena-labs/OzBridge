import * as vscode from 'vscode';
import {
  OzRunResult,
  OzListResult,
  OzCliError,
  OzCliErrorKind,
  WarpBridgeConfig,
  IConfigManager,
} from '../types/index.js';
import { t } from '../core/i18n.js';

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

  // IMPL: formatta risultato di un agent run nel chat stream
  formatRunResult(
    result: OzRunResult,
    stream: vscode.ChatResponseStream,
    opts?: { autoOpened?: boolean; local?: boolean },
  ): void {
    const statusIcon = result.status === 'SUCCEEDED' ? '✅' : '❌';
    const header = t('oz.fmt_run_header', statusIcon, result.status);

    stream.markdown(`${header}\n\n`);

    if (result.runId) {
      stream.markdown(t('oz.fmt_run_id', result.runId));
    }

    if (result.durationMs > 0) {
      const secs = (result.durationMs / 1000).toFixed(1);
      stream.markdown(t('oz.fmt_run_duration', secs));
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
        title: t('oz.fmt_open_warp_web'),
      });
    }
    // autoOpened: Warp terminal opened automatically via --open flag
    // local: run eseguita localmente, conversation_id non è una sessione web
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
        : t('oz.fmt_list_empty'));
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

  // IMPL: formatta errore con azione suggerita (button login, link installazione)
  formatError(error: OzCliError, stream: vscode.ChatResponseStream): void {
    switch (error.kind) {
      case OzCliErrorKind.NOT_FOUND:
        stream.markdown(t('oz.fmt_err_not_found'));
        stream.button({
          command: 'vscode.open',
          arguments: [vscode.Uri.parse(WARP_INSTALL_URL)],
          title: t('oz.fmt_err_install'),
        });
        break;

      case OzCliErrorKind.NOT_AUTHENTICATED:
        stream.markdown(t('oz.fmt_err_not_auth'));
        stream.button({
          command: 'vscode.open',
          arguments: [vscode.Uri.parse(WARP_LOGIN_URL)],
          title: t('oz.fmt_err_login'),
        });
        break;

      case OzCliErrorKind.TIMEOUT:
        stream.markdown(t('oz.fmt_err_timeout', this.config.timeoutMs / 1000));
        break;

      case OzCliErrorKind.CANCELLED:
        stream.markdown(t('oz.fmt_err_cancelled'));
        break;

      case OzCliErrorKind.PARSE_ERROR:
        stream.markdown(
          t('oz.fmt_err_parse') +
          `\`\`\`\n${error.stderr?.substring(0, 500) ?? error.message}\n\`\`\`\n`
        );
        break;

      default:
        stream.markdown(
          t('oz.fmt_err_cli', error.exitCode ?? '?') +
          `\`\`\`\n${error.message}\n\`\`\`\n`
        );
        if (error.stderr) {
          stream.markdown(t('oz.fmt_err_stderr') + `\`\`\`\n${error.stderr.substring(0, 500)}\n\`\`\`\n`);
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
      stream.markdown(t('oz.error', err instanceof Error ? err.message : String(err)));
    }
  }

  // IMPL: tronca output a maxOutputChars con indicatore (decisione Q3 = 5000)
  private truncate(text: string): string {
    if (text.length <= this.config.maxOutputChars) {
      return text;
    }
    const truncated = text.substring(0, this.config.maxOutputChars);
    const remaining = text.length - this.config.maxOutputChars;
    return truncated + t('oz.fmt_truncated', remaining);
  }
}
