import * as vscode from 'vscode';
import { OzCliError, OzCliErrorKind, OzRunResult, OzRunStatus } from '../types/index.js';

// ============================================================================
// Common helpers for LanguageModelTool implementations
// ============================================================================
//
// These utilities format tool results and errors in a way that is consistent
// across all Warp LM Tools and easy for the LLM to consume.

/**
 * Builds a successful `LanguageModelToolResult` with a single markdown text part.
 */
export function textResult(markdown: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(markdown),
  ]);
}

/**
 * Renders an {@link OzRunResult} as compact markdown suitable for LLM consumption.
 * Trims the output at `maxOutputChars` and adds a truncation note.
 */
export function renderRunResult(result: OzRunResult, maxOutputChars = 4000): string {
  const lines: string[] = [];
  const icon = result.status === 'SUCCEEDED' ? '✅' : result.status === 'FAILED' ? '❌' : '⏳';
  lines.push(`${icon} **Status**: \`${result.status}\``);
  if (result.runId) {
    lines.push(`**Run ID**: \`${result.runId}\``);
  }
  if (result.durationMs > 0) {
    lines.push(`**Duration**: ${(result.durationMs / 1000).toFixed(1)}s`);
  }
  lines.push(`**Exit code**: ${result.exitCode}`);
  if (result.output) {
    const trimmed = result.output.length > maxOutputChars
      ? result.output.substring(0, maxOutputChars) +
        `\n\n… (${result.output.length - maxOutputChars} chars truncated)`
      : result.output;
    lines.push('', '---', '', trimmed);
  }
  return lines.join('\n');
}

/**
 * Converts a caught error into an {@link vscode.LanguageModelToolResult}
 * with a user-friendly markdown error message.
 *
 * The LLM can inspect the text part to decide whether to retry, surface
 * the failure, or suggest corrective actions.
 */
export function errorResult(err: unknown): vscode.LanguageModelToolResult {
  if (err instanceof OzCliError) {
    const hint = errorHint(err.kind);
    return textResult(
      `❌ **Oz CLI error** (${err.kind}): ${err.message}` +
      (hint ? `\n\n_Hint_: ${hint}` : '') +
      (err.stderr ? `\n\n\`\`\`\n${err.stderr.substring(0, 500)}\n\`\`\`` : ''),
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  return textResult(`❌ **Unexpected error**: ${msg}`);
}

/**
 * Suggests a remediation hint for each {@link OzCliErrorKind}.
 * Intentionally terse so the LLM can act on it.
 */
export function errorHint(kind: OzCliErrorKind): string | undefined {
  switch (kind) {
    case OzCliErrorKind.NOT_FOUND:
      return 'Install Warp from https://www.warp.dev/download and ensure `oz` is in PATH.';
    case OzCliErrorKind.NOT_AUTHENTICATED:
      return 'Run `oz login` in a terminal to authenticate with Warp.';
    case OzCliErrorKind.INSUFFICIENT_CREDITS:
      return 'Warp account is out of credits or quota. Top up at https://app.warp.dev/settings/billing then retry.';
    case OzCliErrorKind.STALLED:
      return 'The Oz CLI produced no output for the idle window. Check Warp credits, network, and whether the Warp desktop app is waiting on an interactive prompt outside VS Code.';
    case OzCliErrorKind.TIMEOUT:
      return 'Increase `ozBridge.timeoutMs` or `ozBridge.cloudPollingTimeoutMs` in settings. Also check whether the Warp account has credits left — a depleted account can cause the CLI to hang until the timeout fires.';
    case OzCliErrorKind.CANCELLED:
      return 'The operation was cancelled by the user.';
    case OzCliErrorKind.PARSE_ERROR:
      return 'The Oz CLI returned unexpected output. Update Warp to the latest version.';
    default:
      return undefined;
  }
}

/**
 * Common status filter values accepted by list-oriented tools.
 */
export type StatusFilter = 'all' | 'active' | 'completed' | OzRunStatus;

/**
 * Applies a status filter to a list of runs, case-insensitively.
 */
export function filterRunsByStatus<T extends { status: OzRunStatus }>(
  items: T[],
  filter: StatusFilter = 'all',
): T[] {
  switch (filter) {
    case 'all':
      return items;
    case 'active':
      return items.filter((r) => r.status === 'QUEUED' || r.status === 'INPROGRESS');
    case 'completed':
      return items.filter((r) => r.status === 'SUCCEEDED' || r.status === 'FAILED');
    default:
      return items.filter((r) => r.status === filter);
  }
}
