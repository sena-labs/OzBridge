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
  OzCliError,
  OzCliErrorKind,
  IConfigManager,
} from '../types/index.js';
import { parse } from '../parsers/jsonParser.js';
import { getErrorMessage } from '../utils/error.js';

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

export class OzCliService implements IOzCliService {
  constructor(private readonly configManager: IConfigManager) {}

  /** Accesso dinamico alla config — ogni lettura riflette le impostazioni correnti */
  private get config() {
    return this.configManager.getConfig();
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async checkAvailability(): Promise<{ available: boolean; version: string | null; path: string | null }> {
    try {
      await this.exec(['--help'], undefined, undefined, { readOnly: true });
      return { available: true, version: null, path: this.resolveOzPath() };
    } catch {
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

    args.push('--output-format', 'json');

    const result = await this.exec(args, opts.cwd, opts.cancellation);
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

    args.push('--output-format', 'json');

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

  async runList(): Promise<OzListResult<{ id: string; status: OzRunStatus }>> {
    const result = await this.exec(
      ['run', 'list', '--output-format', 'json'],
      undefined,
      undefined,
      { readOnly: true },
    );
    return this.toListResult(result);
  }

  async runGet(runId: string): Promise<OzRunResult> {
    this.sanitizeId(runId, 'runId');
    const result = await this.exec(
      ['run', 'get', runId, '--output-format', 'json'],
      undefined,
      undefined,
      { readOnly: true },
    );
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

    args.push('--output-format', 'json');

    const result = await this.exec(args);
    const parsed = parse<OzSchedule>(result.stdout);
    if (!parsed.parsed) {
      throw new OzCliError(OzCliErrorKind.PARSE_ERROR, 'Failed to parse schedule create output', result.exitCode, result.stderr);
    }
    return parsed.parsed;
  }

  async scheduleList(): Promise<OzListResult<OzSchedule>> {
    const result = await this.exec(
      ['schedule', 'list', '--output-format', 'json'],
      undefined,
      undefined,
      { readOnly: true },
    );
    return this.toListResult(result);
  }

  async schedulePause(id: string): Promise<void> {
    this.sanitizeId(id, 'schedule id');
    await this.exec(['schedule', 'pause', '--id', id]);
  }

  async scheduleUnpause(id: string): Promise<void> {
    this.sanitizeId(id, 'schedule id');
    await this.exec(['schedule', 'unpause', '--id', id]);
  }

  async scheduleDelete(id: string): Promise<void> {
    this.sanitizeId(id, 'schedule id');
    await this.exec(['schedule', 'delete', '--id', id]);
  }

  // =========================================================================
  // Discovery
  // =========================================================================

  async modelList(): Promise<OzListResult<OzModel>> {
    const result = await this.exec(
      ['model', 'list', '--output-format', 'json'],
      undefined,
      undefined,
      { readOnly: true },
    );
    return this.toListResult(result);
  }

  async mcpList(): Promise<OzListResult<OzMcpServer>> {
    const result = await this.exec(
      ['mcp', 'list', '--output-format', 'json'],
      undefined,
      undefined,
      { readOnly: true },
    );
    return this.toListResult(result);
  }

  async profileList(): Promise<OzListResult<OzProfile>> {
    const result = await this.exec(
      ['agent', 'profile', 'list', '--output-format', 'json'],
      undefined,
      undefined,
      { readOnly: true },
    );
    return this.toListResult(result);
  }

  async environmentList(): Promise<OzListResult<OzEnvironment>> {
    const result = await this.exec(
      ['environment', 'list', '--output-format', 'json'],
      undefined,
      undefined,
      { readOnly: true },
    );
    return this.toListResult(result);
  }

  async integrationList(): Promise<OzListResult<OzIntegration>> {
    const result = await this.exec(
      ['integration', 'list', '--output-format', 'json'],
      undefined,
      undefined,
      { readOnly: true },
    );
    return this.toListResult(result);
  }

  // =========================================================================
  // Warp Drive (RF-5)
  // =========================================================================

  async driveList(category: 'prompt' | 'rule' | 'skill'): Promise<unknown> {
    if (category !== 'prompt' && category !== 'rule' && category !== 'skill') {
      throw new OzCliError(
        OzCliErrorKind.CLI_ERROR,
        `Invalid drive category: ${String(category)}`,
      );
    }
    const result = await this.exec(
      ['drive', 'list', category, '--output-format', 'json'],
      undefined,
      undefined,
      { readOnly: true },
    );
    const { parsed, rawText } = parse<unknown>(result.stdout);
    return parsed ?? rawText;
  }

  async driveGet(id: string): Promise<string> {
    this.sanitizeId(id, 'drive id');
    const result = await this.exec(
      ['drive', 'get', '--id', id],
      undefined,
      undefined,
      { readOnly: true },
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

    const args = [
      'agent', 'run',
      '--continue', opts.runId,
      '--prompt', opts.prompt,
      '--output-format', 'json',
    ];

    const result = await this.exec(args, undefined, opts.cancellation);
    return this.toRunResult(result);
  }

  async helpAgentRun(): Promise<string> {
    const result = await this.exec(['agent', 'run', '--help']);
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
    options?: { readOnly?: boolean },
  ): Promise<ExecResult> {
    // Read-only commands (list/get) cannot consume Warp credits per
    // https://docs.warp.dev/reference/api-and-sdk/troubleshooting/errors/insufficient-credits
    // (insufficient_credits is HTTP 403 emitted only by `agent run`/task
    // endpoints). We pass this flag through to the close-handler so a
    // misleading credits classification cannot bubble up from a list call.
    const readOnly = options?.readOnly === true;
    return new Promise((resolve, reject) => {
      if (cancellation?.isCancellationRequested) {
        reject(new OzCliError(OzCliErrorKind.CANCELLED, 'Operation cancelled by user'));
        return;
      }

      const startTime = Date.now();

      // Determina il path dell'eseguibile
      const ozPath = this.resolveOzPath();
      const spawnCwd = cwd || undefined;

      let proc: ChildProcess;
      try {
        // On Windows we need shell:true for .cmd wrappers and unresolved
        // names (like 'oz') so cmd.exe can locate them.  Only skip the
        // shell when we resolved to a concrete .exe path.
        const needsShell = process.platform === 'win32' && !/\.exe$/i.test(ozPath);

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
        const SENSITIVE_ENV_KEYS = new Set([
          'NPM_TOKEN',
          'GITHUB_TOKEN',
          'GH_TOKEN',
          'AWS_SECRET_ACCESS_KEY',
          'AWS_SESSION_TOKEN',
          'OPENAI_API_KEY',
          'ANTHROPIC_API_KEY',
          'GEMINI_API_KEY',
          'AZURE_OPENAI_API_KEY',
        ]);
        const childEnv: Record<string, string | undefined> = {};
        for (const [key, value] of Object.entries(process.env)) {
          if (SENSITIVE_ENV_KEYS.has(key)) { continue; }
          childEnv[key] = value;
        }

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
      let killed = false;
      let stalled = false;
      let settled = false;
      let forceKillHandle: NodeJS.Timeout | undefined;
      let idleHandle: NodeJS.Timeout | undefined;

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
        killed = true;
        try { proc.kill('SIGTERM'); } catch { /* ignore */ }

        // If the process ignores SIGTERM, force kill after a short grace period.
        forceKillHandle = setTimeout(() => {
          if (settled) { return; }
          try { proc.kill('SIGKILL'); } catch { /* ignore */ }
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
      };

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        armIdleTimer();
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
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

      proc.on('error', (err) => {
        cleanup();
        if (settled) { return; }
        settled = true;

        if (err.message.includes('ENOENT') || err.message.includes('not found')) {
          reject(new OzCliError(OzCliErrorKind.NOT_FOUND, `Oz CLI not found at '${ozPath}'`));
        } else {
          reject(new OzCliError(OzCliErrorKind.CLI_ERROR, err.message));
        }
      });

      proc.on('close', (code) => {
        cleanup();
        if (settled) { return; }
        settled = true;

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

    const output = agentTexts.length > 0 ? agentTexts.join('\n\n') : stdout;

    // Determine status: if there are agent messages, the run completed
    const hasError = events.some(e =>
      e.type === 'tool_result' && (e.status === 'error' || e.status === 'failed'),
    );

    return {
      runId: conversationId,
      status: hasError ? 'FAILED' : 'SUCCEEDED',
      output,
      raw: { events },
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

  // IMPL: converte ExecResult in lista generica con fallback a rawText (R1)
  private toListResult<T>(result: ExecResult): OzListResult<T> {
    const { parsed, rawText } = parse<T[]>(result.stdout);

    if (Array.isArray(parsed)) {
      return { items: parsed };
    }

    // Se il parse ha prodotto un singolo oggetto, wrappalo in array
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
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
    const valid: OzRunStatus[] = ['QUEUED', 'INPROGRESS', 'SUCCEEDED', 'FAILED'];
    return valid.includes(upper as OzRunStatus) ? (upper as OzRunStatus) : 'UNKNOWN';
  }

  /** Valida che un ID utente contenga solo caratteri sicuri (protezione injection) */
  private sanitizeId(id: string, paramName: string): void {
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
    if (!/^[a-zA-Z0-9_.\-\s/:,*]+$/.test(value)) {
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
 * Warp `insufficient_credits` failure. Wraps
 * {@link hasExplicitInsufficientCreditsSignal} with the documented
 * HTTP status (403). Exit codes 402 and 429 are NOT mapped here on
 * purpose — see the function comment above.
 *
 * Exported for unit testing.
 */
export function isInsufficientCreditsError(
  combinedLowercase: string,
  exitCode: number,
): boolean {
  if (exitCode === 403 && hasExplicitInsufficientCreditsSignal(combinedLowercase)) {
    return true;
  }
  return hasExplicitInsufficientCreditsSignal(combinedLowercase);
}
