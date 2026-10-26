import * as vscode from 'vscode';
import { OzCliError, OzRunResult, OzRunStatus } from '../types/index.js';
import { errorHint } from './errorHint.js';

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

// The pure hint table lives in a vscode-free module so the standalone MCP
// server can share it; re-exported here so existing imports keep working.
export { errorHint } from './errorHint.js';

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
