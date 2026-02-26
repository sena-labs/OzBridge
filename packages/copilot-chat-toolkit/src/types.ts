import * as vscode from 'vscode';
import type { II18nService } from './i18n/types.js';

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

// ============================================================================
// i18n (re-export convenience reference)
// ============================================================================
// IMPL: Phase 1 — re-export II18nService so consumers can import it
//       from types.ts without needing a separate i18n/ import.

export type { II18nService } from './i18n/types.js';

// ============================================================================
// Plugin System
// ============================================================================
// IMPL: Phase 1 — IPlugin, PluginContext, PluginRegistration, PluginInfo,
//       PluginRegistryChangeEvent, IPluginLogger (§3.1 Architecture)

/**
 * Logging facade passed to plugins during activation.
 * Implementations typically prefix messages with the plugin id.
 */
export interface IPluginLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/**
 * Context provided by the host to every plugin on {@link IPlugin.activate}.
 *
 * Contains shared services that plugins can use but do **not** own.
 */
export interface PluginContext {
  /** Scoped logger (messages prefixed with plugin namespace). */
  readonly logger: IPluginLogger;
  /** IDE context collector (workspace, file, selection, diagnostics). */
  readonly contextCollector: IContextCollector;
  /** VS Code extension context for disposable registration. */
  readonly extensionContext: vscode.ExtensionContext;
  /** Internationalisation service for `t()` translations. */
  readonly i18n: II18nService;
}

/**
 * Returned by {@link IPlugin.activate} — describes what the plugin provides.
 *
 * At minimum, a plugin must supply a non-empty `commands` map.
 */
export interface PluginRegistration {
  /** Subcommand name → handler. Names become `/<namespace> <subcommand>`. */
  commands: Map<string, SlashCommandHandler>;
  /** Optional followup suggestions, keyed by subcommand name. */
  followups?: FollowupMap;
  /**
   * If set, the plugin registers its **own** Chat Participant instead of
   * operating under the host's `@dev` participant.
   */
  ownParticipant?: { id: string; name: string; iconSubPath?: string };
  /** Disposables to clean up when the plugin is unloaded. */
  disposables?: vscode.Disposable[];
  /** Returns a human-readable config summary shown by `/config`. */
  configSummary?: () => string;
}

/**
 * Generic contract for a DevForge plugin.
 *
 * Plugins are activated by the {@link PluginRegistry} during extension
 * startup. Each plugin contributes slash-command handlers, optional
 * followups, and optional configuration.
 */
export interface IPlugin {
  /** Unique namespace used for routing (e.g. `'oz'`, `'shell'`). */
  readonly id: string;
  /** Human-readable name shown in `/plugins` output. */
  readonly displayName: string;
  /** SemVer version string. */
  readonly version: string;
  /**
   * Called once during registration. Must return a {@link PluginRegistration}
   * describing the commands and capabilities provided by this plugin.
   */
  activate(ctx: PluginContext): Promise<PluginRegistration>;
  /**
   * Called during extension deactivation. Optional — plugins that hold no
   * resources beyond `disposables` can omit this.
   */
  deactivate?(): Promise<void>;
}

/**
 * Runtime metadata about a registered plugin, stored by the registry.
 */
export interface PluginInfo {
  /** The plugin instance. */
  readonly plugin: IPlugin;
  /** The registration returned by {@link IPlugin.activate}. */
  readonly registration: PluginRegistration;
  /** Whether the plugin was loaded as built-in or via external API. */
  readonly source: 'builtin' | 'external';
  /** Lifecycle status. */
  status: 'active' | 'error' | 'disabled';
  /** Error message when `status === 'error'`. */
  readonly error?: string;
}

/**
 * Event emitted by the plugin registry when a plugin is added, removed,
 * or enters an error state.
 */
export type PluginRegistryChangeEvent = {
  pluginId: string;
  action: 'registered' | 'removed' | 'error';
};

