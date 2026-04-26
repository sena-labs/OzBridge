import * as vscode from 'vscode';

// ============================================================================
// Re-export generic types from copilot-chat-toolkit with Oz-specific aliases
// ============================================================================
import {
  CliError,
  CliErrorKind,
  type RunStatus,
  type RunResult,
  type ListResult,
  type BridgeConfig,
  type DiagnosticEntry,
  type ContextPayload,
  type IContextCollector,
  type SlashCommandHandler,
} from 'copilot-chat-toolkit';

// IMPL: re-export toolkit types with backwards-compatible Oz-prefixed names
export { CliError as OzCliError, CliErrorKind as OzCliErrorKind } from 'copilot-chat-toolkit';
export type OzRunStatus = RunStatus;
export type OzRunResult = RunResult;
export type OzListResult<T> = ListResult<T>;
export type { DiagnosticEntry, ContextPayload, SlashCommandHandler };

// ============================================================================
// OzBridge Configuration (extends toolkit's BridgeConfig)
// ============================================================================

/** Extension settings read from `vscode.workspace.getConfiguration('ozBridge')`. */
export interface WarpBridgeConfig extends BridgeConfig {
  /** Path to the `oz` CLI executable. */
  ozPath: string;
  /** Default AI model for agent runs (`'auto'` = CLI decides). */
  defaultModel: string;
  /** Default Oz agent profile name. */
  defaultProfile: string;
  /** Default cloud environment name (empty string = none). */
  defaultEnvironment: string;
  /** Initial polling interval for cloud runs, in milliseconds. */
  cloudPollingIntervalMs: number;
  /** Maximum total polling duration for cloud runs, in milliseconds. */
  cloudPollingTimeoutMs: number;
  /**
   * Idle timeout for the local Oz CLI subprocess (ms). When no
   * stdout/stderr data is received for this long the process is
   * killed and a `STALLED` error is raised so the user sees an
   * actionable message immediately instead of waiting for
   * `timeoutMs`. Set to `0` to disable. Default 90s.
   */
  idleTimeoutMs: number;
  /** Whether to auto-start the embedded MCP server at activation. */
  mcpEnabled: boolean;
  /** Port the MCP server listens on when enabled. */
  mcpPort: number;
  /** Bind address for the MCP server (loopback by default). */
  mcpBindAddress: string;
  /** Optional bearer token required on every MCP request. */
  mcpBearerToken: string;
}

/**
 * Rebrand alias: prefer `OzBridgeConfig` for new code. The original
 * `WarpBridgeConfig` name is retained for backward compatibility with
 * existing imports across the codebase.
 */
export type OzBridgeConfig = WarpBridgeConfig;

// IMPL: valori di default allineati con package.json contributes.configuration
export const DEFAULT_CONFIG: WarpBridgeConfig = {
  ozPath: 'oz',
  defaultModel: 'auto',
  defaultProfile: 'Default',
  defaultEnvironment: '',
  cloudPollingIntervalMs: 5_000,
  cloudPollingTimeoutMs: 1_800_000,
  timeoutMs: 300_000,
  idleTimeoutMs: 90_000,
  maxOutputChars: 15_000,
  mcpEnabled: false,
  mcpPort: 3847,
  mcpBindAddress: '127.0.0.1',
  mcpBearerToken: '',
};

// ============================================================================
// Oz-specific DTOs (not in toolkit — Warp platform models)
// ============================================================================

/** An AI model available in the Oz platform. */
export interface OzModel {
  id: string;
}

/** An MCP (Model Context Protocol) server configured in Warp. */
export interface OzMcpServer {
  uuid: string;
  name: string;
}

/** An Oz agent profile. */
export interface OzProfile {
  id: string;
  name: string;
}

/** A cloud execution environment for Oz agents. */
export interface OzEnvironment {
  id: string;
  name: string;
  base_image: { docker_image: string };
  github_repos: Array<{ owner: string; repo: string }>;
  setup_commands: string[];
  creator_email: string;
  last_edited: string;
  scope: string;
}

/** A third-party integration connected to the Warp account. */
export interface OzIntegration {
  provider: string;
  status: string;
}

/** A scheduled cron job for automated agent runs. */
export interface OzSchedule {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  paused: boolean;
}

// ============================================================================
// Mappa Agenti → Skill
// ============================================================================

export const AGENT_SKILL_MAP: Record<string, string> = {
  'spec': '1-spec-agent',
  'design': '2-design-agent',
  'implement': '3-implement-agent',
  'review': '4-review-agent',
  'test': '5-test-agent',
  'deploy': '6-deploy-agent',
  'maintenance': '7-maintenance-agent',
};

// ============================================================================
// Interfacce dei servizi (Oz-specific, extending toolkit interfaces)
// ============================================================================

/** Service interface for executing Oz CLI commands. */
export interface IOzCliService {
  checkAvailability(): Promise<{ available: boolean; version: string | null; path: string | null }>;

  agentRun(opts: {
    prompt: string;
    model?: string;
    profile?: string;
    skill?: string;
    cwd?: string;
    cancellation?: vscode.CancellationToken;
  }): Promise<OzRunResult>;

  agentRunCloud(opts: {
    prompt: string;
    model?: string;
    environment?: string;
    noEnvironment?: boolean;
    open?: boolean;
    skill?: string;
    cancellation?: vscode.CancellationToken;
  }): Promise<OzRunResult>;

  runList(): Promise<OzListResult<{ id: string; status: OzRunStatus }>>;
  runGet(runId: string): Promise<OzRunResult>;

  scheduleCreate(opts: {
    name: string;
    cron: string;
    prompt: string;
    skill?: string;
    environment?: string;
  }): Promise<OzSchedule>;
  scheduleList(): Promise<OzListResult<OzSchedule>>;
  schedulePause(id: string): Promise<void>;
  scheduleUnpause(id: string): Promise<void>;
  scheduleDelete(id: string): Promise<void>;

  modelList(): Promise<OzListResult<OzModel>>;
  mcpList(): Promise<OzListResult<OzMcpServer>>;
  profileList(): Promise<OzListResult<OzProfile>>;
  environmentList(): Promise<OzListResult<OzEnvironment>>;
  integrationList(): Promise<OzListResult<OzIntegration>>;

  /**
   * Invokes `oz drive list <category> --output-format json` and returns
   * the parsed JSON payload (array, `{ items: [...] }`, or
   * `{ <category>s: [...] }`). Throws {@link OzCliError} with kind
   * `NOT_FOUND` or `CLI_ERROR`/"unknown command" stderr when the
   * subcommand is unavailable, so the drive factory can fall back.
   */
  driveList(category: 'prompt' | 'rule' | 'skill'): Promise<unknown>;

  /**
   * Invokes `oz drive get --id <id>` and returns the raw markdown body.
   * Same error semantics as {@link driveList} for unavailable subcommand.
   */
  driveGet(id: string): Promise<string>;

  /**
   * Invokes `oz agent run --continue <runId> --prompt <text> --output-format json`.
   *
   * Used by {@link IRunSteerer} when the underlying CLI exposes the
   * `--continue` flag. Implementations MUST sanitise `runId` and reject
   * empty `prompt`.
   *
   * Throws {@link OzCliError} with kind `NOT_FOUND` or `CLI_ERROR` (with
   * `unknown command`/`unknown option` stderr) when the flag is not
   * available, so the caller can fall back to the inlined strategy.
   */
  agentContinue(opts: {
    runId: string;
    prompt: string;
    cancellation?: vscode.CancellationToken;
  }): Promise<OzRunResult>;

  /**
   * Returns the raw stdout of `oz agent run --help`.
   *
   * Used by {@link IRunSteerer} to probe whether the `--continue` flag
   * is exposed by the installed Oz CLI version. Cached by callers.
   */
  helpAgentRun(): Promise<string>;
}

/** Reactive wrapper around VS Code extension settings with caching and change events. */
export interface IConfigManager {
  /** Returns the current configuration snapshot (cached until next change). */
  getConfig(): WarpBridgeConfig;
  /** Fires when `ozBridge.*` settings change, with the new configuration. */
  onConfigChanged: vscode.Event<WarpBridgeConfig>;
  /** Disposes the configuration change listener. */
  dispose(): void;
}

// ============================================================================
// Run steering (v0.8 deliverable F)
// ============================================================================

/** Strategy actually used by an {@link IRunSteerer} to deliver the follow-up. */
export type SteerStrategy = 'native-continue' | 'inlined-fallback';

/** Input for {@link IRunSteerer.steer}. */
export interface SteerRunOptions {
  /** Identifier of the cloud run to steer. */
  runId: string;
  /** Follow-up text to send. Must be non-empty after trimming. */
  prompt: string;
  /** Optional cancellation token forwarded to the underlying CLI call. */
  cancellation?: vscode.CancellationToken;
}

/** Outcome of a {@link IRunSteerer.steer} call. */
export interface SteerRunResult {
  /** Run id of the resulting in-flight run (may differ from input). */
  runId: string | null;
  /** Strategy actually used to deliver the prompt. */
  strategy: SteerStrategy;
  /** Raw {@link OzRunResult} returned by the CLI. */
  raw: OzRunResult;
}

/** Capabilities probed by {@link IRunSteerer.capabilities}. */
export interface SteerCapabilities {
  /** Whether the CLI exposes the `--continue` flag on `oz agent run`. */
  nativeContinue: boolean;
  /** Wall-clock timestamp (ms) at which the probe was performed. */
  detectedAt: number;
}

/**
 * Sends follow-up prompts to in-flight cloud runs with a documented
 * progressive fallback (see roadmap decision log, 2026-04-20):
 *
 * 1. **Primary** — `oz agent run --continue <runId> --prompt <text>`
 *    when the CLI exposes the flag.
 * 2. **Fallback** — `oz agent run-cloud --prompt "[CONTINUING <runId>] <text>"`
 *    with the run id inlined in the prompt.
 *
 * The implementation MUST cache the capability probe result, since
 * `oz agent run --help` is a moderately expensive sub-process call.
 */
export interface IRunSteerer {
  /** Sends a follow-up prompt to a still-running cloud run. */
  steer(opts: SteerRunOptions): Promise<SteerRunResult>;
  /** Returns (and caches) the underlying CLI capabilities. */
  capabilities(): Promise<SteerCapabilities>;
}

/** Gathers IDE context (workspace, file, selection, diagnostics) for prompt injection. */
export type { IContextCollector };

/** Polls a cloud agent run until terminal status, with exponential backoff. */
export interface IRunPoller {
  /** Polls `runGet()` until SUCCEEDED/FAILED, calling `onProgress` on each tick. */
  poll(
    runId: string,
    onProgress: (status: OzRunStatus) => void,
    cancellation?: vscode.CancellationToken,
  ): Promise<OzRunResult>;
  /** Aborts all active polling loops and clears the internal set. Idempotent. */
  disposeAll(): void;
}
