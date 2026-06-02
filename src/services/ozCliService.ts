import * as vscode from 'vscode';
import { spawn, ChildProcess, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  IOzCliService,
  OzRunResult,
  OzRunStatus,
  OzListResult,
  OzModel,
  OzMcpServer,
  OzProfile,
  OzEnvironment,
  OzIntegration,
  OzSchedule,
  OzArtifact,
  OzSecret,
  OzCliError,
  OzCliErrorKind,
  IConfigManager,
  isValidOzRunStatus,
} from '../types/index.js';
import { parse } from '../parsers/jsonParser.js';
import { getErrorMessage } from '../utils/error.js';
import { logWarn } from 'copilot-chat-toolkit';

/**
 * Wraps the Warp Oz CLI (`oz`) via `child_process.spawn`.
 *
 * Every public method builds an argument array, delegates to the private
 * `exec()` helper, and parses the JSON output. Supports per-command
 * timeout, VS Code cancellation, and input sanitisation (`sanitizeId()`).
 */

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/**
 * Sensitive parent-env keys never propagated to the spawned `oz` child.
 * Mirrors the deny-list shipped by `npm exec` / `pnpm exec` and extends it
 * with additional well-known credential keys (MED-6).
 */
const SENSITIVE_ENV_KEYS = new Set([
  'NPM_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITLAB_TOKEN',
  'GITLAB_PRIVATE_TOKEN',
  'JIRA_API_TOKEN',
  'SLACK_TOKEN',
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'HUGGINGFACE_TOKEN',
  'HF_TOKEN',
]);

/**
 * Prefix-based blocklist for credential families with many variants.
 * Any env var whose name starts with one of these prefixes is filtered
 * out of the child process environment regardless of suffix (MED-6).
 */
const SENSITIVE_ENV_PREFIXES = [
  'STRIPE_',
  'TWILIO_',
  'SENDGRID_',
  'MAILGUN_',
  'PAGERDUTY_',
  'DATADOG_',
];

/**
 * Permissive validator for `--jq <FILTER>` values. Allows the characters
 * actually used by jq syntax (dots, brackets, parens, pipes, quotes,
 * commas, comparison operators, arithmetic) while blocking shell
 * metacharacters that could enable command injection in the
 * Windows-shell code path (`shell: true`). Keep in sync with `exec()`.
 */
function validateJqFilter(filter: string): void {
  // Block characters that have special meaning to cmd.exe / sh and are
  // not part of jq syntax: backtick, $(, &, ;, >, <, newline, CR.
  // These are the only shell-injection vectors that survive when
  // `shell: true` is used (Windows non-.exe path fallback).
  if (/[`;\n\r]|\$\(|&&|\|\||>|<(?!=)/.test(filter)) {
    throw new OzCliError(
      OzCliErrorKind.CLI_ERROR,
      `Invalid jq filter: contains disallowed shell metacharacters`,
    );
  }
  if (filter.length > 1024) {
    throw new OzCliError(
      OzCliErrorKind.CLI_ERROR,
      `Invalid jq filter: exceeds 1024 characters`,
    );
  }
}

export class OzCliService implements IOzCliService {
  /**
   * Optional extension-lifetime cancellation token. When set, every
   * spawned child process is killed automatically once the token is
   * cancelled (typically from `deactivate()`), preventing orphaned `oz`
   * processes when the host shuts down with calls in flight.
   */
  private extensionToken: vscode.CancellationToken | undefined;

  constructor(private readonly configManager: IConfigManager) {}

  /**
   * Registers a token that will cancel **every** subsequent `exec()` call
   * in addition to any caller-provided token. Intended for the extension
   * host to broadcast a global cancellation on `deactivate()`.
   */
  setExtensionToken(token: vscode.CancellationToken): void {
    this.extensionToken = token;
  }

  /** Accesso dinamico alla config — ogni lettura riflette le impostazioni correnti */
  private get config() {
    return this.configManager.getConfig();
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async checkAvailability(): Promise<{ available: boolean; version: string | null; path: string | null }> {
    try {
      // `--help` is independent of WARP_OUTPUT_FORMAT — pass null so we
      // don't perturb the CLI's default formatting for the probe.
      await this.exec(['--help'], undefined, undefined, { readOnly: true, outputFormat: null });
      return { available: true, version: null, path: this.resolveOzPath() };
    } catch (err) {
      // A-L10: surface the underlying reason to the OutputChannel so users
      // can diagnose missing PATH / wrong `ozBridge.ozPath` without enabling
      // debug telemetry. Stays a warning — the caller maps the result to a
      // first-run experience and a single notification.
      logWarn('Oz CLI availability probe failed', getErrorMessage(err));
      return { available: false, version: null, path: null };
    }
  }

  // =========================================================================
  // Agent execution
  // =========================================================================

  async agentRun(opts: {
    prompt: string;
    model?: string;
    profile?: string;
    skill?: string;
    cwd?: string;
    cancellation?: vscode.CancellationToken;
    /**
     * Optional progressive-event callback. When provided the CLI is
     * invoked with `WARP_OUTPUT_FORMAT=ndjson` and every newline-delimited
     * JSON event is forwarded to the callback as it arrives, while the
     * full aggregated payload is still parsed and returned at the end.
     * Errors thrown by the callback are swallowed so a UI mistake never
     * breaks the underlying CLI invocation.
     */
    onProgress?: (eventLine: string) => void;
  }): Promise<OzRunResult> {
    if (!opts.prompt?.trim()) {
      throw new OzCliError(OzCliErrorKind.CLI_ERROR, 'Prompt cannot be empty');
    }
    if (opts.model) { this.validateCliArg(opts.model, 'model'); }
    if (opts.profile) { this.validateCliArg(opts.profile, 'profile'); }
    if (opts.skill) { this.validateCliArg(opts.skill, 'skill'); }

    const args = ['agent', 'run', '-p', opts.prompt];

    if (opts.model) {
      args.push('--model', opts.model);
    }
    if (opts.profile) {
      args.push('--profile', opts.profile);
    }
    if (opts.skill) {
      args.push('--skill', opts.skill);
    }

    // `--output-format` is a GLOBAL option upstream; we now propagate it
    // through the WARP_OUTPUT_FORMAT env var (set in `exec()`), so we no
    // longer push the flag onto every argv.
    const onProgress = opts.onProgress;
    let onLine: ((line: string) => void) | undefined;
    if (onProgress) {
      onLine = (line) => {
        try { onProgress(line); } catch (cbErr) { logWarn('ozCliService onProgress callback threw', getErrorMessage(cbErr)); }
      };
    }

    // Always use 'json', never 'ndjson'. Warp's ndjson mode makes the CLI
    // *follow* the run and never exit on piped (non-TTY) stdout, hanging the
    // spawn until the idle timeout fires ("Starting local Oz agent…" then a
    // 90s STALL). json mode emits the SAME newline-delimited events
    // incrementally — so `onLine` still streams live progress to the chat —
    // but the process exits cleanly once the run completes.
    const result = await this.exec(args, opts.cwd, opts.cancellation, {
      outputFormat: 'json',
      onLine,
    });
    return this.toRunResult(result);
  }

  async agentRunCloud(opts: {
    prompt: string;
    model?: string;
    environment?: string;
    noEnvironment?: boolean;
    open?: boolean;
    skill?: string;
    cancellation?: vscode.CancellationToken;
  }): Promise<OzRunResult> {
    if (!opts.prompt?.trim()) {
      throw new OzCliError(OzCliErrorKind.CLI_ERROR, 'Prompt cannot be empty');
    }
    if (opts.model) { this.validateCliArg(opts.model, 'model'); }
    if (opts.environment) { this.validateCliArg(opts.environment, 'environment'); }
    if (opts.skill) { this.validateCliArg(opts.skill, 'skill'); }

    const args = ['agent', 'run-cloud', '-p', opts.prompt];

    if (opts.model) {
      args.push('--model', opts.model);
    }
    if (opts.environment) {
      args.push('-e', opts.environment);
    } else if (opts.noEnvironment) {
      args.push('--no-environment');
    }
    if (opts.open) {
      args.push('--open');
    }
    if (opts.skill) {
      args.push('--skill', opts.skill);
    }

    // Output format is now driven by WARP_OUTPUT_FORMAT (set in exec()).

    const result = await this.exec(args, undefined, opts.cancellation);
    const base = this.toRunResult(result);

    // The CLI banner "Spawned ambient agent with run ID: <UUID>" is the
    // authoritative source for the run id. It takes precedence over any
    // JSON `id` field that may belong to a different entity (e.g. session).
    const combined = result.stdout + '\n' + result.stderr;
    const bannerRunId = OzCliService.extractCloudBannerRunId(combined);
    if (bannerRunId) {
      return { ...base, runId: bannerRunId };
    }
    return base;
  }

  /**
   * Extracts the run ID from the CLI banner line emitted by `agent run-cloud`.
   *
   * The CLI prints: "Spawned ambient agent with run ID: <UUID>"
   * This ID is the canonical run identifier and must be used with `run get`
   * and in all sidebar/history entries.
   *
   * @internal Exported for testing.
   */
  static extractCloudBannerRunId(text: string): string | null {
    const match = /spawned ambient agent with run id[:\s]+([a-zA-Z0-9_-]+)/i.exec(text);
    return match ? match[1].toLowerCase() : null;
  }

  // =========================================================================
  // Run management
  // =========================================================================

  async runList(opts?: { jq?: string }): Promise<OzListResult<{ id: string; status: OzRunStatus }>> {
    const args = ['run', 'list'];
    if (opts?.jq) {
      validateJqFilter(opts.jq);
      args.push('--jq', opts.jq);
    }
    const result = await this.exec(args, undefined, undefined, { readOnly: true });
    return this.toListResult(result);
  }

  async runGet(runId: string, opts?: { jq?: string }): Promise<OzRunResult> {
    this.sanitizeId(runId, 'runId');
    const args = ['run', 'get', runId];
    if (opts?.jq) {
      validateJqFilter(opts.jq);
      args.push('--jq', opts.jq);
    }
    const result = await this.exec(args, undefined, undefined, { readOnly: true });
    return this.toRunResult(result);
  }

  // =========================================================================
  // Schedules
  // =========================================================================

  async scheduleCreate(opts: {
    name: string;
    cron: string;
    prompt: string;
    skill?: string;
    environment?: string;
  }): Promise<OzSchedule> {
    if (!opts.prompt?.trim()) {
      throw new OzCliError(OzCliErrorKind.CLI_ERROR, 'Prompt cannot be empty');
    }
    this.validateCliArg(opts.name, 'schedule name');
    this.validateCliArg(opts.cron, 'cron expression');
    if (opts.skill) { this.validateCliArg(opts.skill, 'skill'); }
    if (opts.environment) { this.validateCliArg(opts.environment, 'environment'); }

    const args = ['schedule', 'create', '--name', opts.name, '--cron', opts.cron, '-p', opts.prompt];

    if (opts.skill) {
      args.push('--skill', opts.skill);
    }
    if (opts.environment) {
      args.push('-e', opts.environment);
    }

    const result = await this.exec(args);
    const parsed = parse<OzSchedule>(result.stdout);
    if (!parsed.parsed) {
      throw new OzCliError(OzCliErrorKind.PARSE_ERROR, 'Failed to parse schedule create output', result.exitCode, result.stderr);
    }
    return parsed.parsed;
  }

  async scheduleList(opts?: { jq?: string }): Promise<OzListResult<OzSchedule>> {
    const args = ['schedule', 'list'];
    if (opts?.jq) {
      validateJqFilter(opts.jq);
      args.push('--jq', opts.jq);
    }
    const result = await this.exec(args, undefined, undefined, { readOnly: true });
    return this.toListResult(result);
  }

  // Upstream `oz schedule pause|unpause|delete` accept the schedule ID as a
  // positional argument (see `PauseScheduleArgs`/`UnpauseScheduleArgs`/
  // `DeleteScheduleArgs` in warpdotdev/warp `crates/warp_cli/src/schedule.rs`).
  // Passing `--id <id>` causes clap to reject the call with
  // `unexpected argument '--id'`. We therefore pass the ID positionally.
  async schedulePause(id: string): Promise<void> {
    this.sanitizeId(id, 'schedule id');
    await this.exec(['schedule', 'pause', id]);
  }

  async scheduleUnpause(id: string): Promise<void> {
    this.sanitizeId(id, 'schedule id');
    await this.exec(['schedule', 'unpause', id]);
  }

  async scheduleDelete(id: string): Promise<void> {
    this.sanitizeId(id, 'schedule id');
    await this.exec(['schedule', 'delete', id]);
  }

  async scheduleGet(id: string): Promise<OzSchedule> {
    this.sanitizeId(id, 'schedule id');
    const result = await this.exec(['schedule', 'get', id], undefined, undefined, { readOnly: true });
    const parsed = parse<OzSchedule>(result.stdout);
    if (!parsed.parsed) {
      throw new OzCliError(OzCliErrorKind.PARSE_ERROR, 'Failed to parse schedule get output', result.exitCode, result.stderr);
    }
    return parsed.parsed;
  }

  async scheduleUpdate(opts: {
    id: string;
    name?: string;
    cron?: string;
    prompt?: string;
    skill?: string;
    environment?: string;
    removeEnvironment?: boolean;
    removeSkill?: boolean;
  }): Promise<OzSchedule> {
    this.sanitizeId(opts.id, 'schedule id');
    const args: string[] = ['schedule', 'update', opts.id];

    if (opts.name) {
      this.validateCliArg(opts.name, 'schedule name');
      args.push('--name', opts.name);
    }
    if (opts.cron) {
      this.validateCliArg(opts.cron, 'cron expression');
      args.push('--cron', opts.cron);
    }
    if (opts.prompt && opts.prompt.trim().length > 0) {
      args.push('-p', opts.prompt);
    }
    if (opts.skill) {
      this.validateCliArg(opts.skill, 'skill');
      args.push('--skill', opts.skill);
    } else if (opts.removeSkill) {
      args.push('--remove-skill');
    }
    if (opts.environment) {
      this.validateCliArg(opts.environment, 'environment');
      args.push('-e', opts.environment);
    } else if (opts.removeEnvironment) {
      args.push('--remove-environment');
    }

    const result = await this.exec(args);
    const parsed = parse<OzSchedule>(result.stdout);
    if (!parsed.parsed) {
      throw new OzCliError(OzCliErrorKind.PARSE_ERROR, 'Failed to parse schedule update output', result.exitCode, result.stderr);
    }
    return parsed.parsed;
  }

  // =========================================================================
  // Artifacts
  // =========================================================================

  async artifactGet(uid: string): Promise<OzArtifact> {
    this.sanitizeId(uid, 'artifact uid');
    const result = await this.exec(['artifact', 'get', uid], undefined, undefined, { readOnly: true });
    const parsed = parse<Record<string, unknown>>(result.stdout);
    if (!parsed.parsed) {
      throw new OzCliError(OzCliErrorKind.PARSE_ERROR, 'Failed to parse artifact get output', result.exitCode, result.stderr);
    }
    return OzCliService.normalizeArtifact(uid, parsed.parsed);
  }

  async artifactDownload(uid: string, outPath: string): Promise<string> {
    this.sanitizeId(uid, 'artifact uid');
    if (typeof outPath !== 'string' || outPath.trim().length === 0) {
      throw new OzCliError(OzCliErrorKind.CLI_ERROR, 'Invalid outPath: must be a non-empty string');
    }
    // outPath comes from a `vscode.window.showSaveDialog` result so the
    // user already authored it. We still forbid NUL bytes which would
    // truncate strings inside libuv / Win32 path APIs.
    if (outPath.includes('\u0000')) {
      throw new OzCliError(OzCliErrorKind.CLI_ERROR, 'Invalid outPath: contains NUL byte');
    }
    await this.exec(['artifact', 'download', uid, '-o', outPath], undefined, undefined, { readOnly: true });
    return outPath;
  }

  // =========================================================================
  // Secrets
  // =========================================================================

  async secretList(opts?: { jq?: string }): Promise<OzListResult<OzSecret>> {
    const args = ['secret', 'list'];
    if (opts?.jq) {
      validateJqFilter(opts.jq);
      args.push('--jq', opts.jq);
    }
    const result = await this.exec(args, undefined, undefined, { readOnly: true });
    return this.toListResult(result);
  }

  async secretCreate(opts: {
    name: string;
    value: string;
    description?: string;
    scope?: 'team' | 'personal';
  }): Promise<void> {
    this.validateCliArg(opts.name, 'secret name');
    if (typeof opts.value !== 'string' || opts.value.length === 0) {
      throw new OzCliError(OzCliErrorKind.CLI_ERROR, 'Secret value cannot be empty');
    }
    if (opts.description) { this.validateCliArg(opts.description, 'secret description'); }

    const args: string[] = ['secret', 'create', opts.name, '-t', 'raw-value'];
    if (opts.description) { args.push('-d', opts.description); }
    if (opts.scope === 'team') { args.push('--team'); }
    if (opts.scope === 'personal') { args.push('--personal'); }

    // SECURITY: pipe the secret value through stdin so it never appears
    // in argv (visible via `ps`/Task Manager) or in the env block.
    await this.exec(args, undefined, undefined, { stdin: opts.value });
  }

  async secretUpdate(opts: {
    name: string;
    value?: string;
    description?: string;
    scope?: 'team' | 'personal';
  }): Promise<void> {
    this.validateCliArg(opts.name, 'secret name');
    if (opts.description) { this.validateCliArg(opts.description, 'secret description'); }
    if (opts.value === undefined && opts.description === undefined) {
      throw new OzCliError(OzCliErrorKind.CLI_ERROR, 'secretUpdate requires at least value or description');
    }

    const args: string[] = ['secret', 'update', opts.name];
    if (opts.description) { args.push('-d', opts.description); }
    if (opts.scope === 'team') { args.push('--team'); }
    if (opts.scope === 'personal') { args.push('--personal'); }

    if (opts.value !== undefined) {
      // Upstream expects the new value via the `--value` interactive
      // prompt — which reads from stdin when not a TTY. We therefore
      // pipe the value identically to `secretCreate` and avoid placing
      // it in argv.
      args.push('--value');
      await this.exec(args, undefined, undefined, { stdin: opts.value });
    } else {
      await this.exec(args);
    }
  }

  async secretDelete(name: string, opts?: { scope?: 'team' | 'personal' }): Promise<void> {
    this.validateCliArg(name, 'secret name');
    const args: string[] = ['secret', 'delete', name, '--force'];
    if (opts?.scope === 'team') { args.push('--team'); }
    if (opts?.scope === 'personal') { args.push('--personal'); }
    await this.exec(args);
  }

  // =========================================================================
  // Discovery
  // =========================================================================

  async modelList(opts?: { jq?: string }): Promise<OzListResult<OzModel>> {
    const args = ['model', 'list'];
    if (opts?.jq) {
      validateJqFilter(opts.jq);
      args.push('--jq', opts.jq);
    }
    const result = await this.exec(args, undefined, undefined, { readOnly: true });
    return this.toListResult(result);
  }

  async mcpList(opts?: { jq?: string }): Promise<OzListResult<OzMcpServer>> {
    const args = ['mcp', 'list'];
    if (opts?.jq) {
      validateJqFilter(opts.jq);
      args.push('--jq', opts.jq);
    }
    const result = await this.exec(args, undefined, undefined, { readOnly: true });
    return this.toListResult(result);
  }

  async profileList(opts?: { jq?: string }): Promise<OzListResult<OzProfile>> {
    const args = ['agent', 'profile', 'list'];
    if (opts?.jq) {
      validateJqFilter(opts.jq);
      args.push('--jq', opts.jq);
    }
    const result = await this.exec(args, undefined, undefined, { readOnly: true });
    return this.toListResult(result);
  }

  async environmentList(opts?: { jq?: string }): Promise<OzListResult<OzEnvironment>> {
    const args = ['environment', 'list'];
    if (opts?.jq) {
      validateJqFilter(opts.jq);
      args.push('--jq', opts.jq);
    }
    const result = await this.exec(args, undefined, undefined, { readOnly: true });
    return this.toListResult(result);
  }

  /**
   * `oz integration` is gated behind a `FeatureFlag` upstream
   * (warpdotdev/warp `crates/warp_cli/src/lib.rs`). On builds where the
   * flag is off, clap rejects the call with `unrecognized subcommand`
   * — we treat that as "no integrations available" and return an empty
   * list so callers can continue rendering their UI.
   */
  async integrationList(opts?: { jq?: string }): Promise<OzListResult<OzIntegration>> {
    const args = ['integration', 'list'];
    if (opts?.jq) {
      validateJqFilter(opts.jq);
      args.push('--jq', opts.jq);
    }
    try {
      const result = await this.exec(args, undefined, undefined, { readOnly: true });
      return this.toListResult(result);
    } catch (err) {
      if (err instanceof OzCliError && OzCliService.isUnrecognizedSubcommandError(err)) {
        return { items: [] };
      }
      throw err;
    }
  }

  /**
   * Detects clap's "unrecognized subcommand" / "unknown command" error
   * shapes so callers can offer a graceful fallback for feature-flagged
   * commands.
   * @internal Exported on the class for testing.
   */
  static isUnrecognizedSubcommandError(err: OzCliError): boolean {
    if (err.kind !== OzCliErrorKind.CLI_ERROR && err.kind !== OzCliErrorKind.NOT_FOUND) {
      return false;
    }
    const haystack = `${err.message} ${err.stderr ?? ''}`.toLowerCase();
    return /unrecognized subcommand|unknown subcommand|unknown command|unrecognized argument/.test(haystack);
  }

  /**
   * Normalises the heterogeneous JSON shape returned by `oz artifact get`
   * into a stable {@link OzArtifact}. Upstream key names have shifted
   * across releases (`uid|id`, `name|filename`, `content_type|mime_type`,
   * `size_bytes|size`, `run_id|runId`), so we coalesce them defensively
   * and always preserve the raw payload for forward compatibility.
   */
  static normalizeArtifact(uid: string, raw: Record<string, unknown>): OzArtifact {
    const pickString = (...keys: string[]): string | undefined => {
      for (const k of keys) {
        const v = raw[k];
        if (typeof v === 'string' && v.length > 0) { return v; }
      }
      return undefined;
    };
    const pickNumber = (...keys: string[]): number | undefined => {
      for (const k of keys) {
        const v = raw[k];
        if (typeof v === 'number' && Number.isFinite(v)) { return v; }
      }
      return undefined;
    };
    return {
      uid: pickString('uid', 'id', 'artifact_uid') ?? uid,
      name: pickString('name', 'filename', 'file_name'),
      contentType: pickString('content_type', 'contentType', 'mime_type', 'mimeType'),
      sizeBytes: pickNumber('size_bytes', 'sizeBytes', 'size'),
      runId: pickString('run_id', 'runId'),
      raw,
    };
  }

  // =========================================================================
  // Warp Drive (RF-5)
  // =========================================================================

  async driveList(category: 'prompt' | 'rule' | 'skill', opts?: { jq?: string }): Promise<unknown> {
    if (category !== 'prompt' && category !== 'rule' && category !== 'skill') {
      throw new OzCliError(
        OzCliErrorKind.CLI_ERROR,
        `Invalid drive category: ${String(category)}`,
      );
    }
    const args = ['drive', 'list', category];
    if (opts?.jq) {
      validateJqFilter(opts.jq);
      args.push('--jq', opts.jq);
    }
    const result = await this.exec(args, undefined, undefined, { readOnly: true });
    const { parsed, rawText } = parse<unknown>(result.stdout);
    return parsed ?? rawText;
  }

  async driveGet(id: string): Promise<string> {
    this.sanitizeId(id, 'drive id');
    // `drive get` returns raw markdown; do NOT force WARP_OUTPUT_FORMAT=json
    // or the body would be wrapped/escaped.
    const result = await this.exec(
      ['drive', 'get', '--id', id],
      undefined,
      undefined,
      { readOnly: true, outputFormat: null },
    );
    return result.stdout;
  }

  // =========================================================================
  // Run steering (v0.8 deliverable F)
  // =========================================================================

  async agentContinue(opts: {
    runId: string;
    prompt: string;
    cancellation?: vscode.CancellationToken;
  }): Promise<OzRunResult> {
    if (!opts.prompt?.trim()) {
      throw new OzCliError(OzCliErrorKind.CLI_ERROR, 'Prompt cannot be empty');
    }
    this.sanitizeId(opts.runId, 'runId');

    // Upstream Oz CLI exposes the resume flag as `--conversation <ID>`
    // (see warpdotdev/warp `crates/warp_cli/src/agent.rs`). The flag is
    // gated by the `CloudConversations` feature flag; if absent, callers
    // should rely on {@link IRunSteerer} which probes `--help` and falls
    // back to {@link agentRunCloud} with an inlined run-id prefix.
    const args = [
      'agent', 'run',
      '--conversation', opts.runId,
      '--prompt', opts.prompt,
    ];

    const result = await this.exec(args, undefined, opts.cancellation);
    return this.toRunResult(result);
  }

  async helpAgentRun(): Promise<string> {
    // Help text is independent of the output format — don't override it.
    const result = await this.exec(['agent', 'run', '--help'], undefined, undefined, { outputFormat: null });
    return result.stdout;
  }

  // =========================================================================
  // Internals
  // =========================================================================

  // IMPL: esecuzione core con child_process.spawn — gestisce timeout, cancellazione, errori
  private exec(
    args: string[],
    cwd?: string,
    cancellation?: vscode.CancellationToken,
    options?: {
      readOnly?: boolean;
      /**
       * Value forwarded to the upstream `WARP_OUTPUT_FORMAT` env var.
       * - `'json'` (default): structured JSON output (used by all
       *   programmatic callers).
       * - `'ndjson'`: newline-delimited JSON, suitable for streaming
       *   `oz agent run` events line-by-line.
       * - `null`: do NOT set the env var — used by `--help` and by
       *   `drive get` (raw markdown body).
       */
      outputFormat?: 'json' | 'ndjson' | null;
      /**
       * Optional line-buffered stdout sink. Each complete newline-
       * terminated line is forwarded as it arrives. Useful with
       * `outputFormat: 'ndjson'` for progressive event delivery.
       */
      onLine?: (line: string) => void;
      /**
       * Optional UTF-8 string written to the child's stdin and then
       * the stream is closed. Used by commands like `oz secret create`
       * / `oz secret update` that read sensitive values from stdin so
       * they never appear in `argv`.
       */
      stdin?: string;
    },
  ): Promise<ExecResult> {
    // Read-only commands (list/get) cannot consume Warp credits per
    // https://docs.warp.dev/reference/api-and-sdk/troubleshooting/errors/insufficient-credits
    // (insufficient_credits is HTTP 403 emitted only by `agent run`/task
    // endpoints). We pass this flag through to the close-handler so a
    // misleading credits classification cannot bubble up from a list call.
    const readOnly = options?.readOnly === true;
    const outputFormat = options?.outputFormat === undefined ? 'json' : options.outputFormat;
    const onLine = options?.onLine;
    const stdinPayload = options?.stdin;
    return new Promise((resolve, reject) => {
      if (cancellation?.isCancellationRequested || this.extensionToken?.isCancellationRequested) {
        reject(new OzCliError(OzCliErrorKind.CANCELLED, 'Operation cancelled by user'));
        return;
      }

      const startTime = Date.now();

      // Determina il path dell'eseguibile
      const ozPath = this.resolveOzPath();
      const spawnCwd = cwd || undefined;

      // On Windows we need shell:true for .cmd wrappers and unresolved
      // names (like 'oz') so cmd.exe can locate them.  Only skip the
      // shell when we resolved to a concrete .exe path. Declared at the
      // outer scope so `terminateProcess` (MED-7 taskkill branch) can
      // see it.
      const needsShell = process.platform === 'win32' && !/\.exe$/i.test(ozPath);

      let proc: ChildProcess;
      try {

        // Inherit the full parent environment so the Oz CLI sees every
        // platform variable it needs to function. Stripping the env down
        // to a hand-picked allowlist (as we did in commits 861eb5e and
        // earlier) was a security-theatre regression that broke the CLI
        // on Windows: dropping `SystemRoot`, `COMSPEC`, `WINDIR`,
        // `PROGRAMFILES`/`PROGRAMFILES(X86)`, `PROCESSOR_ARCHITECTURE`,
        // and the user's `WARP_*` auth variables made several Warp
        // backend calls (run list / schedule list / agent run) hang
        // forever without any output — the CLI started but could not
        // resolve TLS / DNS / Win32 APIs, then sat waiting on the
        // stdlib. The user's own shell already exposes these variables
        // to the IDE, so re-exporting them to a child process the same
        // user is launching is not an additional information leak.
        //
        // We still apply a tiny *blocklist* of well-known secret keys
        // that should never be passed to a child the user did not
        // explicitly mark as trusted (matching the deny list shipped
        // by `npm exec` / `pnpm exec`). This preserves the spirit of
        // the original hardening without breaking the CLI.
        //
        // Output format is propagated via `WARP_OUTPUT_FORMAT` (a
        // documented upstream env override for the global
        // `--output-format` clap option), so individual callers no
        // longer have to repeat the flag on every argv.
        const childEnv = OzCliService.buildChildEnv(outputFormat);

        proc = spawn(ozPath, args, {
          cwd: spawnCwd,
          shell: needsShell,
          windowsHide: true,
          env: childEnv,
        });
      } catch (err) {
        reject(new OzCliError(
          OzCliErrorKind.NOT_FOUND,
          `Failed to spawn '${ozPath}': ${getErrorMessage(err)}`,
        ));
        return;
      }

      let stdout = '';
      let stderr = '';
      let lineBuffer = '';
      let killed = false;
      let stalled = false;
      let settled = false;
      let forceKillHandle: NodeJS.Timeout | undefined;
      let idleHandle: NodeJS.Timeout | undefined;

      // Pipe sensitive payloads (e.g. secret values) through stdin so
      // they never appear in argv or in process listings. We write
      // synchronously and immediately end() the stream — there is no
      // upstream command that expects multi-chunk interactive input.
      if (stdinPayload !== undefined) {
        try {
          proc.stdin?.write(stdinPayload);
          proc.stdin?.end();
        } catch (writeErr) {
          logWarn('ozCliService stdin write failed', getErrorMessage(writeErr));
        }
      }

      const idleMs = this.config.idleTimeoutMs ?? 0;

      const armIdleTimer = () => {
        if (idleMs <= 0) { return; }
        if (idleHandle) { clearTimeout(idleHandle); }
        idleHandle = setTimeout(() => {
          if (settled) { return; }
          stalled = true;
          terminateProcess();
        }, idleMs);
      };

      const terminateProcess = () => {
        // Cleanup order:
        //   1. Mark `killed` so the eventual `proc.on('exit')` handler can
        //      classify the termination correctly.
        //   2. Send SIGTERM (best-effort — errors are intentionally
        //      swallowed because the child may have already exited).
        //   3. Schedule SIGKILL as a safety net guarded by `settled` so it
        //      becomes a no-op once `cleanup()` has run.
        // Idempotency: `terminateProcess` may be called multiple times
        // (idle timer, global timeout, cancellation). Skip the work once we
        // have already initiated termination so we don't pile up SIGKILL
        // timers on the event loop.
        if (killed) { return; }
        killed = true;
        // MED-7: on Windows when we spawn via `shell: true` (because the CLI
        // resolved to a `.cmd` / `.bat` shim) `proc.kill()` only kills the
        // shell wrapper, not the descendant `oz.exe` process. Use
        // `taskkill /T /F` to reap the entire process tree, then still
        // invoke `proc.kill()` as a belt-and-braces signal for the
        // wrapper itself (and to satisfy mocks in unit tests).
        if (process.platform === 'win32' && needsShell && proc.pid !== undefined) {
          try {
            spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore',
            });
          } catch { /* best-effort */ }
        }
        try { proc.kill('SIGTERM'); } catch { /* already exited */ }

        // Clear any previous force-kill handle (defensive — should be unset
        // here thanks to the `killed` guard above) before scheduling a new
        // one, so we never leak a pending timer.
        if (forceKillHandle) { clearTimeout(forceKillHandle); }
        forceKillHandle = setTimeout(() => {
          if (settled) { return; }
          try { proc.kill('SIGKILL'); } catch { /* already exited */ }
        }, 1_500);
      };

      const cleanup = () => {
        clearTimeout(timeoutHandle);
        if (forceKillHandle) {
          clearTimeout(forceKillHandle);
        }
        if (idleHandle) {
          clearTimeout(idleHandle);
        }
        cancelListener?.dispose();
        extensionCancelListener?.dispose();
      };

      // Hard memory cap on the in-process accumulators. Renderers truncate
      // at `maxOutputChars` (default 15 KB) but if a runaway CLI streams
      // gigabytes of output we still need a guard before V8 OOMs the
      // extension host. 10 MiB leaves three orders of magnitude of headroom
      // over the default render limit while keeping memory bounded. Once
      // the cap is hit we keep draining the pipe (so the child's writes
      // don't block) but stop appending or forwarding progress lines from
      // discarded chunks.
      const STDIO_CAP = 10 * 1024 * 1024;
      let stdoutTruncated = false;
      let stderrTruncated = false;

      proc.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        let acceptedText = '';
        if (stdout.length + text.length > STDIO_CAP) {
          if (!stdoutTruncated) {
            stdoutTruncated = true;
            const remaining = Math.max(0, STDIO_CAP - stdout.length);
            acceptedText = text.substring(0, remaining);
            stdout += acceptedText;
            stdout += `\n… (output capped at ${STDIO_CAP} bytes; further chunks dropped)\n`;
            logWarn(`ozCliService stdout exceeded ${STDIO_CAP} bytes; further chunks dropped`);
          }
        } else {
          acceptedText = text;
          stdout += text;
        }
        if (onLine && acceptedText.length > 0) {
          lineBuffer += acceptedText;
          // Drain complete lines, keep the trailing partial in the buffer.
          let nl: number;
          while ((nl = lineBuffer.indexOf('\n')) !== -1) {
            const line = lineBuffer.slice(0, nl).replace(/\r$/, '');
            lineBuffer = lineBuffer.slice(nl + 1);
            if (line.length > 0) {
              try { onLine(line); } catch (cbErr) { logWarn('ozCliService onLine callback threw', getErrorMessage(cbErr)); }
            }
          }
          // Also cap the line buffer to avoid unbounded growth when the
          // CLI never emits a newline. Drop the head; preserve the tail
          // so the next newline still flushes a usable line.
          if (lineBuffer.length > STDIO_CAP) {
            lineBuffer = lineBuffer.slice(lineBuffer.length - STDIO_CAP);
          }
        }

        // Workaround (Warp run-list hang): some Warp CLI builds print the full
        // JSON result for read-only query commands (`run list`, `run get`, …)
        // but the spawned process then never exits. Without this, exec() would
        // wait for a `close` event that never fires until the idle timer
        // mis-reports the call as STALLED ("OzBridge: unavailable", dashboard
        // "no output for 90s"). As soon as the buffered stdout is a single
        // complete JSON value we already hold the entire payload — resolve and
        // reap the lingering child. Scoped to read-only queries: write
        // commands (`agent run` / `run-cloud`) exit normally and may carry an
        // authoritative run-id banner on stderr that must not be pre-empted.
        // Streaming (ndjson/onLine) and raw-output (outputFormat: null) calls
        // are exempt, and the cheap first/last-char guard avoids JSON.parse on
        // every partial chunk.
        if (readOnly && !settled && !onLine && outputFormat === 'json' && !stdoutTruncated) {
          const trimmed = stdout.trim();
          const first = trimmed[0];
          const last = trimmed[trimmed.length - 1];
          if ((first === '{' && last === '}') || (first === '[' && last === ']')) {
            try {
              JSON.parse(trimmed);
              settled = true;
              cleanup();
              try { proc.kill('SIGTERM'); } catch { /* already exited */ }
              if (process.platform === 'win32' && needsShell && proc.pid !== undefined) {
                try {
                  spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
                    windowsHide: true,
                    stdio: 'ignore',
                  });
                } catch { /* best-effort */ }
              }
              resolve({ stdout, stderr, exitCode: 0, durationMs: Date.now() - startTime });
              return;
            } catch { /* not a complete JSON value yet — keep buffering */ }
          }
        }
        armIdleTimer();
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (stderr.length + text.length > STDIO_CAP) {
          if (!stderrTruncated) {
            stderrTruncated = true;
            const remaining = Math.max(0, STDIO_CAP - stderr.length);
            stderr += text.substring(0, remaining);
            stderr += `\n… (stderr capped at ${STDIO_CAP} bytes; further chunks dropped)\n`;
            logWarn(`ozCliService stderr exceeded ${STDIO_CAP} bytes; further chunks dropped`);
          }
        } else {
          stderr += text;
        }
        armIdleTimer();
      });

      // Idle timer starts immediately so a CLI that never emits anything
      // is detected as stalled within `idleMs` instead of waiting for the
      // global `timeoutMs`.
      armIdleTimer();

      // Timeout
      const timeoutHandle = setTimeout(() => {
        terminateProcess();
      }, this.config.timeoutMs);

      // CancellationToken
      const cancelListener = cancellation?.onCancellationRequested(() => {
        terminateProcess();
      });
      // Extension-lifetime cancellation: fires on `deactivate()`.
      const extensionCancelListener = this.extensionToken?.onCancellationRequested(() => {
        terminateProcess();
      });

      proc.on('error', (err) => {
        try { cleanup(); } catch { /* prevent cleanup errors from masking the process error */ }
        if (settled) { return; }
        settled = true;

        // `err` is typed as `Error` by Node, but be defensive in case the
        // runtime hands us something else (e.g. a thrown string from a mock).
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('ENOENT') || msg.includes('not found')) {
          reject(new OzCliError(OzCliErrorKind.NOT_FOUND, `Oz CLI not found at '${ozPath}'`));
        } else {
          reject(new OzCliError(OzCliErrorKind.CLI_ERROR, msg));
        }
      });

      proc.on('close', (code) => {
        try { cleanup(); } catch { /* prevent cleanup errors from blocking close handler */ }
        if (settled) { return; }
        settled = true;

        // Flush any trailing partial line so callers don't lose the
        // last event when the CLI exits without a final newline.
        if (onLine && lineBuffer.length > 0) {
          try { onLine(lineBuffer); } catch (cbErr) { logWarn('ozCliService onLine callback (flush) threw', getErrorMessage(cbErr)); }
          lineBuffer = '';
        }

        const durationMs = Date.now() - startTime;
        const exitCode = code ?? 1;

        if (killed) {
          if (cancellation?.isCancellationRequested) {
            reject(new OzCliError(OzCliErrorKind.CANCELLED, 'Operation cancelled by user'));
          } else if (stalled) {
            // IMPL: idle-timeout fail-fast. A stalled process must NOT be
            // reclassified as INSUFFICIENT_CREDITS unless stderr/stdout
            // contains an *explicit* documented Warp credit signal — see
            // https://docs.warp.dev/reference/api-and-sdk/troubleshooting/errors/insufficient-credits
            // (HTTP 403 + the canonical "add-on credits" / "insufficient
            // credits" / "out of credits" / "purchase more credits"
            // strings). Network rate limits, transient 429s, and other
            // generic quota-style signals are NOT credits exhaustion and
            // MUST surface as STALLED so the user does not get pushed
            // to the billing page on a timeout false positive.
            // Additionally, read-only commands (list/get) can never
            // consume credits, so they always surface as STALLED.
            const combined = (stderr + stdout).toLowerCase();
            if (!readOnly && hasExplicitInsufficientCreditsSignal(combined)) {
              reject(new OzCliError(
                OzCliErrorKind.INSUFFICIENT_CREDITS,
                'Warp account is out of credits or has hit its quota',
                exitCode,
                stderr,
              ));
            } else {
              reject(new OzCliError(
                OzCliErrorKind.STALLED,
                `Oz CLI produced no output for ${idleMs / 1000}s and was terminated`,
                exitCode,
                stderr,
              ));
            }
          } else {
            reject(new OzCliError(OzCliErrorKind.TIMEOUT, `Operation timed out after ${this.config.timeoutMs}ms`));
          }
          return;
        }

        if (exitCode !== 0) {
          // IMPL: riconosce errori di autenticazione nello stderr
          const combined = (stderr + stdout).toLowerCase();
          if (combined.includes('not logged in') || combined.includes('unauthorized') || combined.includes('please log in') || combined.includes('must log in')) {
            reject(new OzCliError(OzCliErrorKind.NOT_AUTHENTICATED, 'Oz CLI: not authenticated', exitCode, stderr));
            return;
          }
          // IMPL: riconosce esaurimento crediti / quota Warp.
          // Per https://docs.warp.dev/reference/api-and-sdk/troubleshooting/errors/insufficient-credits
          // insufficient_credits è HTTP 403 emesso solo dagli endpoint
          // di start agent (agent run / agent run-cloud / task). I
          // comandi read-only (list/get) NON possono mai consumare
          // crediti, quindi non vengono mai classificati come
          // INSUFFICIENT_CREDITS — questo evita di indirizzare l'utente
          // alla pagina di billing per un fallimento di rete o di auth
          // su una list operation.
          if (
            !readOnly &&
            isInsufficientCreditsError(combined, exitCode)
          ) {
            reject(new OzCliError(
              OzCliErrorKind.INSUFFICIENT_CREDITS,
              'Warp account is out of credits or has hit its quota',
              exitCode,
              stderr,
            ));
            return;
          }
          reject(new OzCliError(OzCliErrorKind.CLI_ERROR, stderr || stdout || `Exit code ${exitCode}`, exitCode, stderr));
          return;
        }

        resolve({ stdout, stderr, exitCode, durationMs });
      });
    });
  }

  // IMPL: converte ExecResult in OzRunResult con JsonParser robusto (D2)
  // Handles both single-JSON responses and NDJSON streams from `oz agent run`.
  private toRunResult(result: ExecResult): OzRunResult {
    const stdout = result.stdout;

    // ── Try NDJSON first (oz agent run emits one JSON object per line) ──
    const ndjsonResult = this.tryParseNdjson(stdout);
    if (ndjsonResult) {
      return {
        ...ndjsonResult,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      };
    }

    // ── Single JSON object (e.g. cloud run, run get) ──
    const { parsed, rawText } = parse<Record<string, unknown>>(stdout);

    if (parsed && typeof parsed === 'object') {
      return {
        runId: typeof parsed['id'] === 'string' ? parsed['id']
             : typeof parsed['run_id'] === 'string' ? parsed['run_id']
             : null,
        status: this.parseStatus(parsed['status']),
        output: typeof parsed['output'] === 'string' ? parsed['output'] : rawText,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        raw: parsed,
      };
    }

    // Fallback: output testuale puro (agent locale non strutturato)
    return {
      runId: null,
      status: result.exitCode === 0 ? 'SUCCEEDED' : 'FAILED',
      output: rawText,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      raw: null,
    };
  }

  /**
   * Attempts to parse NDJSON (newline-delimited JSON) output from `oz agent run`.
   *
   * The CLI emits events as individual JSON lines:
   * - `{"type":"system","event_type":"conversation_started","conversation_id":"..."}`
   * - `{"type":"agent","text":"..."}`
   * - `{"type":"tool_call","tool":"...","command":"..."}`
   * - `{"type":"tool_result","tool":"...","status":"...","output":"..."}`
   *
   * Returns null if the output isn't NDJSON.
   */
  private tryParseNdjson(stdout: string): Omit<OzRunResult, 'exitCode' | 'durationMs'> | null {
    return OzCliService.parseNdjson(stdout);
  }

  /**
   * MED-5: NDJSON parser exposed as a static for direct unit testing of
   * edge cases (partial frames, embedded newlines in pretty-printed JSON,
   * non-JSON noise on stdout, mixed `\r\n` and `\n` line endings).
   *
   * @internal
   */
  static parseNdjson(stdout: string): Omit<OzRunResult, 'exitCode' | 'durationMs'> | null {
    // Spec: Oz CLI emits compact NDJSON (one JSON object per line, no
    // embedded newlines). If the format ever switches to pretty-printed
    // JSON the parser below would mis-tokenise the stream — callers should
    // treat a `null` return as "not NDJSON" and fall back to plain output.
    const lines = stdout.trim().split(/\r?\n/);
    if (lines.length < 2) { return null; }

    const events: Record<string, unknown>[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { continue; }
      try {
        const obj = JSON.parse(trimmed);
        if (obj && typeof obj === 'object' && typeof obj.type === 'string') {
          events.push(obj as Record<string, unknown>);
        }
      } catch {
        // Not JSON — skip non-JSON lines
      }
    }

    // Must have parsed at least 2 events to be considered NDJSON
    if (events.length < 2) { return null; }

    // Extract conversation ID from the system event
    const systemEvent = events.find(e => e.type === 'system' && e.event_type === 'conversation_started');
    const conversationId = systemEvent && typeof systemEvent.conversation_id === 'string'
      ? systemEvent.conversation_id
      : null;

    // Collect agent text messages as the primary output
    const agentTexts = events
      .filter(e => e.type === 'agent' && typeof e.text === 'string')
      .map(e => (e.text as string).trim())
      .filter(Boolean);

    // Bridge-input audit (v1.2): also surface tool_result.output payloads
    // so diagnostic information emitted by oz tool calls (errors, partial
    // logs) is not silently discarded when the agent produces no final
    // text. Captured both into `raw.toolOutputs` for downstream consumers
    // and folded into `output` as a last-resort fallback.
    const toolOutputs = events
      .filter(e => e.type === 'tool_result' && typeof e.output === 'string')
      .map(e => (e.output as string).trim())
      .filter(Boolean);

    const output = agentTexts.length > 0
      ? agentTexts.join('\n\n')
      : (toolOutputs.length > 0 ? toolOutputs.join('\n') : stdout);

    // Determine status: if there are agent messages, the run completed
    const hasError = events.some(e =>
      e.type === 'tool_result' && (e.status === 'error' || e.status === 'failed'),
    );

    return {
      runId: conversationId,
      status: hasError ? 'FAILED' : 'SUCCEEDED',
      output,
      raw: { events, toolOutputs },
    };
  }

  /**
   * Resolves the oz CLI path for the current platform.
   *
   * On Windows the default `'oz'` resolves to `oz.cmd`, a batch wrapper
   * that delegates to `warp.exe`.  Spawning `.cmd` files via
   * `child_process.spawn` requires `shell: true` which can cause subtle
   * stdout-capture issues.  This method attempts to resolve the underlying
   * `warp.exe` directly so we can use `shell: false` for reliability.
   */
  private resolveOzPath(): string {
    const configured = this.config.ozPath;

    // Invalidate cache when the user changes `ozBridge.ozPath` (A-L11): the
    // previous resolution was tied to the prior configured value, so a
    // settings update must trigger a fresh `where.exe` lookup.
    if (this._resolvedFor !== configured) {
      this._resolvedOzPath = undefined;
      this._resolvedFor = configured;
    }

    // If user set an explicit absolute path, respect it
    if (configured !== 'oz') {
      return configured;
    }

    if (process.platform !== 'win32') {
      return configured;
    }

    // Try to resolve oz.cmd → warp.exe via `where.exe`
    if (!this._resolvedOzPath) {
      try {
        const wherePath = execFileSync('where.exe', ['oz'], { encoding: 'utf-8', timeout: 5000 }).trim().split(/\r?\n/)[0];
        if (wherePath && /\.cmd$/i.test(wherePath)) {
          // oz.cmd is at e.g. C:\Users\user\AppData\Local\Programs\Warp\bin\oz.cmd
          // warp.exe is at           ...\Warp\warp.exe
          const binDir = join(wherePath, '..');
          const warpDir = join(binDir, '..');
          const warpExe = join(warpDir, 'warp.exe');
          if (existsSync(warpExe)) {
            this._resolvedOzPath = warpExe;
          } else {
            this._resolvedOzPath = wherePath; // fallback to .cmd
          }
        } else if (wherePath) {
          this._resolvedOzPath = wherePath;
        } else {
          this._resolvedOzPath = configured;
        }
      } catch {
        this._resolvedOzPath = configured;
      }
    }

    return this._resolvedOzPath;
  }

  private _resolvedOzPath: string | undefined;
  private _resolvedFor: string | undefined;

  // IMPL: converte ExecResult in lista generica con fallback a rawText (R1).
  //
  // Bug-fix (dashboard 90s timeout): the Warp CLI returns paginated list
  // endpoints wrapped in an envelope object such as
  // `{ "page_info": {...}, "runs": [...] }`. Without unwrapping, callers
  // would iterate over a single envelope object whose `id` field is
  // `undefined`, then forward `undefined` to commands like `oz run get`,
  // which hangs until the per-call idle timeout fires (90s). We now
  // detect a small set of well-known envelope keys and surface the
  // inner array directly. Falls back to wrapping the object as a single
  // item only when no envelope key is found, preserving the previous
  // behaviour for non-paginated single-record responses.
  private toListResult<T>(result: ExecResult): OzListResult<T> {
    const { parsed, rawText } = parse<T[]>(result.stdout);

    if (Array.isArray(parsed)) {
      return { items: parsed };
    }

    if (parsed && typeof parsed === 'object') {
      const envelope = parsed as Record<string, unknown>;
      const ENVELOPE_KEYS = [
        'runs',
        'items',
        'data',
        'results',
        'schedules',
        'models',
        'mcp_servers',
        'mcpServers',
        'profiles',
        'environments',
        'integrations',
        'secrets',
      ];
      for (const key of ENVELOPE_KEYS) {
        const inner = envelope[key];
        if (Array.isArray(inner)) {
          return { items: inner as T[] };
        }
      }
      // Single-record response (e.g., schedule create): wrap as one item.
      return { items: [parsed as T] };
    }

    // Fallback: nessun JSON valido (es. "No runs found.")
    return { items: [], rawText: rawText || undefined };
  }

  private parseStatus(value: unknown): OzRunStatus {
    if (typeof value !== 'string') {
      return 'UNKNOWN';
    }
    const upper = value.toUpperCase();
    if (!isValidOzRunStatus(upper)) {
      // Bridge-input audit (v1.2): when the upstream CLI introduces a new
      // status value the bridge has not been taught about, surface it
      // through the output channel so support can request a parser update
      // instead of silently coercing to UNKNOWN.
      logWarn(`parseStatus: unknown status value "${upper.slice(0, 64)}" coerced to UNKNOWN.`);
      return 'UNKNOWN';
    }
    return upper;
  }

  /**
   * Builds the env passed to the spawned `oz` child. Inherits the
   * parent env (so the CLI can resolve TLS / DNS / Win32 APIs), strips
   * a small allowlist of well-known secret keys (matching
   * `npm exec` / `pnpm exec`), and — when `outputFormat` is non-null
   * — sets `WARP_OUTPUT_FORMAT` so the global `--output-format` flag
   * does not have to be repeated on every CLI invocation.
   *
   * @internal Exported on the class for unit testing.
   */
  static buildChildEnv(
    outputFormat: 'json' | 'ndjson' | null,
    parentEnv: NodeJS.ProcessEnv = process.env,
  ): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(parentEnv)) {
      if (SENSITIVE_ENV_KEYS.has(key)) { continue; }
      if (SENSITIVE_ENV_PREFIXES.some((p) => key.startsWith(p))) { continue; }
      env[key] = value;
    }
    if (outputFormat) {
      env.WARP_OUTPUT_FORMAT = outputFormat;
    }
    return env;
  }

  /** Valida che un ID utente contenga solo caratteri sicuri (protezione injection) */
  private sanitizeId(id: string, paramName: string): void {
    // Defensive: reject non-strings, empty values, and stringified `undefined`/`null`
    // that could slip through if a caller forwards a missing field. Without this
    // guard, the value would be sent to the Oz CLI which then fails with an
    // opaque "Invalid task ID: failed to parse a UUID".
    if (typeof id !== 'string' || id.length === 0 || id === 'undefined' || id === 'null') {
      throw new OzCliError(
        OzCliErrorKind.CLI_ERROR,
        `Invalid ${paramName}: missing or empty identifier`,
      );
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new OzCliError(
        OzCliErrorKind.CLI_ERROR,
        `Invalid ${paramName}: must contain only alphanumeric characters, hyphens, and underscores`,
      );
    }
  }

  /**
   * Validates a CLI argument value against shell metacharacter injection.
   * Allows alphanumeric, hyphens, underscores, dots, spaces, slashes,
   * colons, and common cron characters (*, /, comma).
   */
  private validateCliArg(value: string, paramName: string): void {
    if (!/^[a-zA-Z0-9_.\- /:,*]+$/.test(value)) {
      throw new OzCliError(
        OzCliErrorKind.CLI_ERROR,
        `Invalid ${paramName}: contains disallowed characters`,
      );
    }
  }
}

/**
 * Returns `true` when the (already lower-cased) combined stderr+stdout
 * carries an explicit Warp "insufficient credits" signal as documented
 * at
 * https://docs.warp.dev/reference/api-and-sdk/troubleshooting/errors/insufficient-credits
 *
 * Per the Warp documentation `insufficient_credits` is HTTP **403**
 * with a canonical body that mentions "add-on credits" / "out of
 * add-on credits" / "purchase more credits". Generic 4xx signals such
 * as 402 Payment Required or 429 Too Many Requests are explicitly
 * NOT this error class — they may be transient rate limits, billing
 * misconfigurations, or upstream throttling, and the user must not be
 * told their Warp account is out of credits when it isn't.
 *
 * The matcher therefore looks **only** for the strings the Warp
 * service is documented to emit, plus the closely related localized
 * variants ("out of credits" / "insufficient credits" / "no credits
 * remaining"/"left"). All ambiguous quota-style phrases ("rate
 * limit", "usage limit", "quota limit", "plan limit", …) are removed
 * — they generate too many false positives on transient network or
 * routing errors.
 *
 * Exported for unit testing.
 */
export function hasExplicitInsufficientCreditsSignal(
  combinedLowercase: string,
): boolean {
  const needles = [
    'out of credits',
    'out of add-on credits',
    'out of add on credits',
    'insufficient credits',
    'insufficient_credits',
    'no credits remaining',
    'no credits left',
    'no add-on credits',
    'purchase more credits',
    'purchase more add-on credits',
    'purchase additional add-on credits',
    'run out of add-on credits',
    'run out of add on credits',
    'run out of credits',
  ];
  return needles.some((n) => combinedLowercase.includes(n));
}

/**
 * Returns `true` when the CLI invocation should be classified as a
 * Warp `insufficient_credits` failure.
 *
 * The Oz CLI exits with code 1 and prints the error message to stderr
 * regardless of the underlying HTTP 403 status, so the string signal is
 * the practical discriminator. The `exitCode` parameter is retained for
 * call-site documentation and future gating if the CLI behaviour changes.
 *
 * Exported for unit testing.
 */
export function isInsufficientCreditsError(
  combinedLowercase: string,
  exitCode: number,
): boolean {
  void exitCode;
  return hasExplicitInsufficientCreditsSignal(combinedLowercase);
}
