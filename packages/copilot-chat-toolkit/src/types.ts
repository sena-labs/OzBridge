import * as vscode from 'vscode';

// ============================================================================
// Configuration
// ============================================================================

/** Minimal base config interface for Copilot Chat extensions. */
export interface BridgeConfig {
  /** Timeout for local operations, in milliseconds. */
  timeoutMs: number;
  /** Maximum characters shown in chat before truncation. */
  maxOutputChars: number;
}

/** Polling configuration for long-running operations. */
export interface PollingConfig {
  /** Polling interval in milliseconds. */
  intervalMs: number;
  /** Maximum total polling time in milliseconds. */
  timeoutMs: number;
}

// ============================================================================
// CLI Results
// ============================================================================

/** Terminal status of an agent run. */
export type RunStatus = 'QUEUED' | 'INPROGRESS' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';

/** Result of an agent execution (local or cloud). */
export interface RunResult {
  /** Unique run identifier, or `null` for local runs without structured output. */
  runId: string | null;
  /** Current execution status. */
  status: RunStatus;
  /** Textual output produced by the agent. */
  output: string;
  /** Process exit code (0 = success). */
  exitCode: number;
  /** Wall-clock execution time in milliseconds. */
  durationMs: number;
  /** Raw parsed JSON payload, or `null` if output was plain text. */
  raw: unknown;
}

/** Generic list result from a CLI list command. */
export interface ListResult<T> {
  /** Parsed items. Empty array if no structured data was returned. */
  items: T[];
  /** Raw text fallback when items could not be parsed. */
  rawText?: string;
}

// ============================================================================
// IDE Context
// ============================================================================

/** A single diagnostic entry from the active editor. */
export interface DiagnosticEntry {
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  range: { startLine: number; endLine: number };
}

/** IDE context payload injected into agent prompts. */
export interface ContextPayload {
  workspacePath: string;
  activeFilePath: string | null;
  activeFileLanguageId: string | null;
  selection: string | null;
  diagnostics: DiagnosticEntry[];
}

// ============================================================================
// Typed Errors
// ============================================================================

export enum CliErrorKind {
  NOT_FOUND = 'NOT_FOUND',
  NOT_AUTHENTICATED = 'NOT_AUTHENTICATED',
  /**
   * The remote agent service rejected the request because the
   * caller's account is out of credits / quota / billing seats.
   * Detected from stderr keywords (`out of credits`, `quota`,
   * `payment required`, HTTP 402/429) so that the UI layer can
   * surface an actionable upgrade message instead of a generic
   * `CLI_ERROR` or — worse — a `TIMEOUT` when the CLI hangs
   * waiting for an interactive Warp prompt.
   */
  INSUFFICIENT_CREDITS = 'INSUFFICIENT_CREDITS',
  /**
   * The CLI subprocess produced no stdout/stderr for the configured
   * idle window (`idleTimeoutMs`). Indicates the underlying process
   * is hung — typically because the upstream Warp service is not
   * responding (out of credits with no fail-fast signal, network
   * partition, or Warp app waiting for an interactive prompt).
   * Surfaced separately from `TIMEOUT` so the message can be sharper
   * and the wait window much shorter than the global timeout.
   */
  STALLED = 'STALLED',
  TIMEOUT = 'TIMEOUT',
  PARSE_ERROR = 'PARSE_ERROR',
  CLI_ERROR = 'CLI_ERROR',
  CANCELLED = 'CANCELLED',
}

/**
 * Typed error thrown by CLI operations.
 * The {@link kind} field allows callers to handle specific failure modes
 * (e.g. authentication, timeout, parsing) with targeted UX.
 */
export class CliError extends Error {
  constructor(
    public readonly kind: CliErrorKind,
    message: string,
    public readonly exitCode?: number,
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

// ============================================================================
// Service Interfaces
// ============================================================================

/** Reactive wrapper around VS Code extension settings with caching and change events. */
export interface IConfigManager<C = object> {
  /** Returns the current configuration snapshot (cached until next change). */
  getConfig(): C;
  /** Fires when settings change, with the new configuration. */
  onConfigChanged: vscode.Event<C>;
  /** Disposes the configuration change listener. */
  dispose(): void;
}

/** Gathers IDE context (workspace, file, selection, diagnostics) for prompt injection. */
export interface IContextCollector {
  /** Collects the current IDE state into a structured payload. */
  gather(): ContextPayload;
  /** Formats a context payload as a `[CONTEXT]...[/CONTEXT]` block for prompt injection. */
  formatForPrompt(payload: ContextPayload): string;
}

/** Minimal interface for polling run status. */
export interface IRunStatusProvider {
  /** Fetches the current status of a run by ID. */
  runGet(runId: string): Promise<RunResult>;
}

/** Polls a long-running operation until terminal status, with exponential backoff. */
export interface IRunPoller {
  /** Polls until SUCCEEDED/FAILED, calling `onProgress` on each tick. */
  poll(
    runId: string,
    onProgress: (status: RunStatus) => void,
    cancellation?: vscode.CancellationToken,
  ): Promise<RunResult>;
  /** Aborts all active polling loops and clears the internal set. Idempotent. */
  disposeAll(): void;
}

/** Handler function type for a single slash command. */
export type SlashCommandHandler = (
  prompt: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
) => Promise<vscode.ChatResult>;

/** Configurable follow-up map: command name → suggested next actions. */
export type FollowupMap = Record<string, vscode.ChatFollowup[]>;

/** Keyword → skill name mapping for intent detection. */
export type SkillMap = Record<string, string>;


