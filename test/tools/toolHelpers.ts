/**
 * Shared helpers for LanguageModelTool tests.
 *
 * These utilities build realistic `options` and `token` arguments and extract
 * the concatenated text value from a `LanguageModelToolResult` so that each
 * test file can focus on behaviour rather than boilerplate.
 */
import type * as vscode from 'vscode';
import { LanguageModelTextPart } from '../mocks/vscode.js';
import { createMockToken } from '../helpers.js';

/**
 * Builds a `LanguageModelToolInvocationOptions` compatible payload for tests.
 */
export function makeInvokeOptions<T>(input: T): vscode.LanguageModelToolInvocationOptions<T> {
  return {
    input,
    toolInvocationToken: undefined,
  } as unknown as vscode.LanguageModelToolInvocationOptions<T>;
}

/**
 * Builds a `LanguageModelToolInvocationPrepareOptions` payload for tests.
 */
export function makePrepareOptions<T>(input: T): vscode.LanguageModelToolInvocationPrepareOptions<T> {
  return { input } as unknown as vscode.LanguageModelToolInvocationPrepareOptions<T>;
}

/**
 * A cancellation token compatible with the subset of the real VS Code API
 * used by our tools.
 */
export function makeToken(cancelled = false): vscode.CancellationToken {
  return createMockToken(cancelled) as unknown as vscode.CancellationToken;
}

/**
 * Extracts the concatenated text value of every `LanguageModelTextPart`
 * inside a `LanguageModelToolResult`, so tests can assert on the whole
 * message without caring about the internal part structure.
 */
export function resultText(result: vscode.LanguageModelToolResult): string {
  // The mock exposes `content: Array<LanguageModelTextPart | ...>`.
  const parts = (result as unknown as { content: unknown[] }).content;
  return parts
    .filter((p): p is LanguageModelTextPart => p instanceof LanguageModelTextPart)
    .map((p) => p.value)
    .join('\n');
}
