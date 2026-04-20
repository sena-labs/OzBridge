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
      await this.exec(['--help']);
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
    return this.toRunResult(result);
  }

  // =========================================================================
  // Run management
  // =========================================================================

  async runList(): Promise<OzListResult<{ id: string; status: OzRunStatus }>> {
    const result = await this.exec(['run', 'list', '--output-format', 'json']);
    return this.toListResult(result);
  }

  async runGet(runId: string): Promise<OzRunResult> {
    this.sanitizeId(runId, 'runId');
    const result = await this.exec(['run', 'get', '--id', runId, '--output-format', 'json']);
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
    const result = await this.exec(['schedule', 'list', '--output-format', 'json']);
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
    const result = await this.exec(['model', 'list', '--output-format', 'json']);
    return this.toListResult(result);
  }

  async mcpList(): Promise<OzListResult<OzMcpServer>> {
    const result = await this.exec(['mcp', 'list', '--output-format', 'json']);
    return this.toListResult(result);
  }

  async profileList(): Promise<OzListResult<OzProfile>> {
    const result = await this.exec(['agent', 'profile', 'list', '--output-format', 'json']);
    return this.toListResult(result);
  }

  async environmentList(): Promise<OzListResult<OzEnvironment>> {
    const result = await this.exec(['environment', 'list', '--output-format', 'json']);
    return this.toListResult(result);
  }

  async integrationList(): Promise<OzListResult<OzIntegration>> {
    const result = await this.exec(['integration', 'list', '--output-format', 'json']);
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
    const result = await this.exec(['drive', 'list', category, '--output-format', 'json']);
    const { parsed, rawText } = parse<unknown>(result.stdout);
    return parsed ?? rawText;
  }

  async driveGet(id: string): Promise<string> {
    this.sanitizeId(id, 'drive id');
    const result = await this.exec(['drive', 'get', '--id', id]);
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
  ): Promise<ExecResult> {
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
        proc = spawn(ozPath, args, {
          cwd: spawnCwd,
          shell: needsShell,
          windowsHide: true,
          env: { ...process.env },
        });
      } catch (err) {
        reject(new OzCliError(
          OzCliErrorKind.NOT_FOUND,
          `Failed to spawn '${ozPath}': ${err instanceof Error ? err.message : String(err)}`,
        ));
        return;
      }

      let stdout = '';
      let stderr = '';
      let killed = false;
      let settled = false;
      let forceKillHandle: NodeJS.Timeout | undefined;

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
        cancelListener?.dispose();
      };

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

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
