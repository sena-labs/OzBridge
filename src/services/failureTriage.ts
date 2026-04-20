import { IOzCliService, OzRunResult } from '../types/index.js';

/** Captured snippet pointing at the most likely root cause inside a failed run. */
export interface ExtractedStackFrame {
  /** Best-effort source-file reference (e.g. `src/foo.ts:42`). */
  location: string | null;
  /** Original line that matched. */
  line: string;
  /** Surrounding lines (max 3 before / 3 after, truncated to file bounds). */
  context: string[];
}

/** Structured payload sent to the language-model client. */
export interface TriagePrompt {
  runId: string;
  /** Final status of the run (always `FAILED` for callers of this service). */
  status: string;
  /** Run duration in ms (helps the model gauge cost). */
  durationMs: number;
  /** Tail of the run output (≤ `maxOutputChars`). */
  outputTail: string;
  /** Stack frames extracted by {@link extractStackFrames}. */
  frames: ExtractedStackFrame[];
}

/** Suggestion produced by the triage flow. */
export interface TriageSuggestion {
  /** Short, single-paragraph diagnosis. */
  summary: string;
  /** Up to 3 actionable next steps. */
  actions: string[];
  /** Raw text returned by the model (preserved for debugging). */
  raw: string;
}

/**
 * Minimal abstraction over `vscode.lm` so the service can be unit-tested
 * without spinning up the language-model host. The extension wires the
 * concrete adapter (`createVsCodeLanguageModelClient`) at activation.
 */
export interface ILanguageModelClient {
  /**
   * Sends a single user-role message to the model and returns the
   * concatenated response. Implementations MUST honour the cancellation
   * token and surface `vscode.lm` errors verbatim.
   */
  sendRequest(prompt: string, cancellation?: { isCancellationRequested: boolean }): Promise<string>;
}

/** Public contract for the failure-triage flow. */
export interface IFailureTriageService {
  /**
   * Loads the run, validates that it actually failed, builds a
   * structured prompt and returns the parsed model suggestion.
   */
  triage(runId: string, cancellation?: { isCancellationRequested: boolean }): Promise<TriageSuggestion>;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Tail-only slice that respects char budget AND line boundaries. Avoids
 * cutting in the middle of a stack frame.
 */
export function tailLines(text: string, maxChars: number): string {
  if (maxChars <= 0 || text.length === 0) {
    return '';
  }
  if (text.length <= maxChars) {
    return text;
  }
  const sliced = text.slice(text.length - maxChars);
  const firstNl = sliced.indexOf('\n');
  return firstNl >= 0 ? sliced.slice(firstNl + 1) : sliced;
}

const STACK_PATTERNS: ReadonlyArray<RegExp> = [
  // Node / V8: "    at fn (path/file.ts:12:5)" or "    at path/file.ts:12:5"
  /\bat\s+(?:[^\s()]+\s+\()?([^\s()]+:\d+(?::\d+)?)\)?/,
  // Python: 'File "path/file.py", line 42'
  /File\s+"([^"]+)",\s+line\s+(\d+)/,
  // Generic "path/file.ext:line[:col]" (Go, TS compiler, GCC, ESLint…)
  /([\w./\\-]+\.[a-zA-Z]{1,5}):(\d+)(?::\d+)?/,
];

/**
 * Returns up to `limit` stack frames extracted from `output`. Each
 * frame includes ±3 lines of context. Pure function — no I/O.
 */
export function extractStackFrames(output: string, limit = 3): ExtractedStackFrame[] {
  if (!output) {
    return [];
  }
  const lines = output.split(/\r?\n/);
  const frames: ExtractedStackFrame[] = [];

  for (let i = 0; i < lines.length && frames.length < limit; i++) {
    const line = lines[i];
    let location: string | null = null;
    for (const re of STACK_PATTERNS) {
      const m = re.exec(line);
      if (m) {
        location = m[2] ? `${m[1]}:${m[2]}` : m[1];
        break;
      }
    }
    if (!location) {
      continue;
    }
    // Deduplicate consecutive frames pointing at the same location.
    if (frames.length > 0 && frames[frames.length - 1].location === location) {
      continue;
    }
    const start = Math.max(0, i - 3);
    const end = Math.min(lines.length, i + 4);
    frames.push({ location, line, context: lines.slice(start, end) });
  }

  return frames;
}

/**
 * Builds the deterministic textual prompt fed to the language model.
 * Keeping it deterministic makes prompt-engineering tweaks reviewable
 * via test snapshots.
 */
export function buildTriagePrompt(payload: TriagePrompt): string {
  const framesBlock = payload.frames.length === 0
    ? '(no stack frames detected)'
    : payload.frames
        .map((f, i) => `Frame ${i + 1}${f.location ? ` (${f.location})` : ''}:\n${f.context.join('\n')}`)
        .join('\n\n');

  return [
    'You are a senior engineer triaging a failed Warp Oz agent run.',
    `Run id: ${payload.runId}`,
    `Status: ${payload.status}`,
    `Duration: ${payload.durationMs}ms`,
    '',
    'Output tail:',
    '```',
    payload.outputTail || '(empty)',
    '```',
    '',
    'Stack frames:',
    framesBlock,
    '',
    'Respond in the following format:',
    'SUMMARY: <one sentence diagnosis>',
    'ACTIONS:',
    '- <action 1>',
    '- <action 2>',
    '- <action 3 optional>',
  ].join('\n');
}

/**
 * Parses the model response into a {@link TriageSuggestion}. Tolerant
 * of missing sections — falls back to the raw text as `summary`.
 */
export function parseTriageResponse(raw: string): TriageSuggestion {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return { summary: '(empty model response)', actions: [], raw: '' };
  }

  const summaryMatch = /^SUMMARY:\s*(.+?)\s*(?:\n|$)/im.exec(trimmed);
  const actionsBlock = /ACTIONS:\s*([\s\S]+)$/im.exec(trimmed);

  const summary = summaryMatch ? summaryMatch[1].trim() : trimmed.split(/\n/, 1)[0];
  const actions: string[] = [];
  if (actionsBlock) {
    for (const line of actionsBlock[1].split(/\r?\n/)) {
      const m = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
      if (m) {
        actions.push(m[1]);
      }
      if (actions.length >= 3) {
        break;
      }
    }
  }
  return { summary, actions, raw: trimmed };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const DEFAULT_OUTPUT_TAIL_CHARS = 4000;

/** Default {@link IFailureTriageService}. */
export class FailureTriageService implements IFailureTriageService {
  constructor(
    private readonly cli: IOzCliService,
    private readonly client: ILanguageModelClient,
    private readonly maxOutputChars: number = DEFAULT_OUTPUT_TAIL_CHARS,
  ) {}

  async triage(runId: string, cancellation?: { isCancellationRequested: boolean }): Promise<TriageSuggestion> {
    if (!runId || typeof runId !== 'string') {
      throw new Error('runId is required');
    }
    const detail = await this.cli.runGet(runId);
    if (detail.status !== 'FAILED') {
      throw new Error(`Run ${runId} is not in FAILED state (current: ${detail.status})`);
    }
    if (cancellation?.isCancellationRequested) {
      throw new Error('triage cancelled');
    }

    const prompt = buildTriagePrompt(this.buildPayload(runId, detail));
    const raw = await this.client.sendRequest(prompt, cancellation);
    return parseTriageResponse(raw);
  }

  private buildPayload(runId: string, detail: OzRunResult): TriagePrompt {
    const outputTail = tailLines(detail.output ?? '', this.maxOutputChars);
    return {
      runId,
      status: detail.status,
      durationMs: Number.isFinite(detail.durationMs) ? detail.durationMs : 0,
      outputTail,
      frames: extractStackFrames(detail.output ?? ''),
    };
  }
}
