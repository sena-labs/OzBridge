import {
  IOzCliService,
  IRunSteerer,
  SteerCapabilities,
  SteerRunOptions,
  SteerRunResult,
  OzCliError,
  OzCliErrorKind,
} from '../types/index.js';

/**
 * Default {@link IRunSteerer} with a documented progressive fallback.
 *
 * On the first call (`steer` or `capabilities`) it probes
 * `oz agent run --help` once and caches whether the `--continue` flag
 * is exposed. Subsequent calls reuse the cached capability without
 * re-spawning the CLI.
 *
 * - **Native path** (`nativeContinue === true`): delegates to
 *   {@link IOzCliService.agentContinue}.
 * - **Fallback path**: delegates to {@link IOzCliService.agentRunCloud}
 *   with the prompt prefixed by `[CONTINUING <runId>] ` so the cloud
 *   agent can pick up the context.
 *
 * Errors are propagated unchanged so callers can render a typed
 * {@link OzCliError} without losing the kind.
 */
export class ProgressiveRunSteerer implements IRunSteerer {
  // IMPL: capability probe lazy + cached per istanza; nessuna invalidation
  // automatica: se l'utente aggiorna l'Oz CLI, basta riattivare l'estensione.
  private capabilityPromise: Promise<SteerCapabilities> | null = null;

  constructor(private readonly cli: IOzCliService) {}

  async capabilities(): Promise<SteerCapabilities> {
    if (!this.capabilityPromise) {
      this.capabilityPromise = this.probe();
    }
    return this.capabilityPromise;
  }

  async steer(opts: SteerRunOptions): Promise<SteerRunResult> {
    if (!opts.prompt?.trim()) {
      throw new OzCliError(OzCliErrorKind.CLI_ERROR, 'Prompt cannot be empty');
    }
    if (!opts.runId?.trim()) {
      throw new OzCliError(OzCliErrorKind.CLI_ERROR, 'runId cannot be empty');
    }

    const caps = await this.capabilities();

    if (caps.nativeContinue) {
      const raw = await this.cli.agentContinue({
        runId: opts.runId,
        prompt: opts.prompt,
        cancellation: opts.cancellation,
      });
      return { runId: raw.runId, strategy: 'native-continue', raw };
    }

    // Fallback: inline runId into the prompt so the cloud agent can
    // recover the conversational context.
    const inlined = `[CONTINUING ${opts.runId}] ${opts.prompt}`;
    const raw = await this.cli.agentRunCloud({
      prompt: inlined,
      cancellation: opts.cancellation,
    });
    return { runId: raw.runId, strategy: 'inlined-fallback', raw };
  }

  // IMPL: la probe è "soft" — qualunque errore dell'help (CLI assente,
  // non autenticato, parse) viene tradotto in `nativeContinue: false`
  // così il fallback resta utilizzabile senza richiedere una seconda
  // chiamata espressa.
  private async probe(): Promise<SteerCapabilities> {
    try {
      const help = await this.cli.helpAgentRun();
      return {
        nativeContinue: hasContinueFlag(help),
        detectedAt: Date.now(),
      };
    } catch {
      return { nativeContinue: false, detectedAt: Date.now() };
    }
  }
}

/**
 * Detects whether the `--continue` flag is documented in the help text
 * of `oz agent run`.
 *
 * Exported for unit tests; the heuristic accepts the literal token
 * `--continue` followed by whitespace, an `=`, or end-of-string. This
 * matches typical help layouts (`  --continue ID`, `--continue=ID`,
 * synopsis brackets `[--continue ID]`) while still rejecting unrelated
 * tokens like `--continue-on-error` (the trailing `-` falls outside
 * the allowed suffix set).
 */
export function hasContinueFlag(helpText: string): boolean {
  if (!helpText) {
    return false;
  }
  return /--continue(?:\s|=|$)/m.test(helpText);
}
