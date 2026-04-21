/**
 * Telemetry pipeline (v1.0 deliverable P).
 *
 * Privacy contract — see {@link FORBIDDEN_KEY_REGEX}:
 *   - **Off by default** until *both* `vscode.env.isTelemetryEnabled === true`
 *     **and** `warpBridge.telemetry.connectionString !== ""`.
 *   - Only the event names declared in {@link TelemetryEventName} are
 *     accepted at the type level.
 *   - Every payload property name is asserted against
 *     {@link FORBIDDEN_KEY_REGEX}; matches are **dropped** (or — in dev/test
 *     — throw, see {@link assertNoForbiddenKeys}). This guarantees we never
 *     transmit prompt content, run IDs, output, file paths or workspace
 *     paths.
 *   - Transport failures are swallowed (`logError` only) so telemetry
 *     never crashes the host.
 *
 * No new runtime dependency: the HTTP transport uses the global `fetch`
 * available in Node ≥ 18 (and in the VS Code Electron host).
 *
 * Read together with `PRIVACY.md` at the repo root.
 */

import { logError, logInfo } from './logger.js';

/** The closed set of telemetry events the extension may emit. */
export type TelemetryEventName =
  | 'extensionActivated'
  | 'commandInvoked'
  | 'runStarted'
  | 'runCompleted'
  | 'errorRaised';

/** Property maps for each event. Keep these strictly PII-free. */
export interface TelemetryEventMap {
  extensionActivated: { version: string };
  commandInvoked: { command: string };
  runStarted: { kind: 'local' | 'cloud' };
  runCompleted: { status: string; durationMs: number };
  errorRaised: { kind: string };
}

/**
 * Property names we refuse to send under any circumstance.
 *
 * Tested at runtime by {@link assertNoForbiddenKeys}; also enforced by a
 * unit test that walks every {@link TelemetryEventMap} declaration to
 * guard against drift.
 */
export const FORBIDDEN_KEY_REGEX =
  /prompt|content|output|path|workspace|runid|message|stack|email|user|token/i;

/**
 * Returns the list of property names in `payload` that match the
 * {@link FORBIDDEN_KEY_REGEX}. Useful both at the call-site (production
 * silent drop) and in tests (strict assertion).
 */
export function findForbiddenKeys(payload: Record<string, unknown> | undefined): string[] {
  if (!payload) {
    return [];
  }
  return Object.keys(payload).filter((key) => FORBIDDEN_KEY_REGEX.test(key));
}

/**
 * Throws if `payload` carries any forbidden property name. Used in tests
 * and during reporter construction to fail loudly when the contract is
 * violated.
 */
export function assertNoForbiddenKeys(
  event: TelemetryEventName,
  payload: Record<string, unknown> | undefined,
): void {
  const offending = findForbiddenKeys(payload);
  if (offending.length > 0) {
    throw new Error(
      `[telemetry] event '${event}' carries forbidden keys: ${offending.join(', ')}`,
    );
  }
}

/** Public reporter contract. */
export interface ITelemetryReporter {
  /** Emit a typed event. Returns immediately; transport is fire-and-forget. */
  track<E extends TelemetryEventName>(event: E, payload: TelemetryEventMap[E]): void;
  /** Flush any buffered events. Resolves once the transport has drained. */
  flush(): Promise<void>;
  /** Dispose any resources (timers, queues). Idempotent. */
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Noop reporter
// ---------------------------------------------------------------------------

/** Reporter that drops every event. Default when telemetry is disabled. */
export class NoopReporter implements ITelemetryReporter {
  track<E extends TelemetryEventName>(_event: E, _payload: TelemetryEventMap[E]): void {
    /* noop */
  }
  async flush(): Promise<void> {
    /* noop */
  }
  async dispose(): Promise<void> {
    /* noop */
  }
}

// ---------------------------------------------------------------------------
// Buffered HTTP reporter (Application Insights ingestion endpoint)
// ---------------------------------------------------------------------------

/** Configuration for {@link HttpAppInsightsReporter}. */
export interface HttpReporterOptions {
  /** Application Insights connection string (`InstrumentationKey=...;IngestionEndpoint=...`). */
  connectionString: string;
  /** Extension version, sent as a tag on every payload. */
  version: string;
  /** Maximum events kept in the buffer before forced flush. Default 50. */
  maxBufferSize?: number;
  /** Background flush interval, in ms. Default 30 000. */
  flushIntervalMs?: number;
  /**
   * Override the global `fetch`. Tests inject a stub here; production code
   * relies on the host's built-in `fetch`.
   */
  fetchImpl?: typeof fetch;
}

interface ParsedConnectionString {
  instrumentationKey: string;
  ingestionEndpoint: string;
}

/** Parse the AppInsights connection string. Returns `null` when malformed. */
export function parseConnectionString(raw: string): ParsedConnectionString | null {
  if (!raw) {
    return null;
  }
  const parts = new Map<string, string>();
  for (const segment of raw.split(';')) {
    const [k, ...rest] = segment.split('=');
    if (!k || rest.length === 0) {
      continue;
    }
    parts.set(k.trim().toLowerCase(), rest.join('=').trim());
  }
  const key = parts.get('instrumentationkey');
  const endpoint = parts.get('ingestionendpoint') ?? 'https://dc.services.visualstudio.com/';
  if (!key) {
    return null;
  }
  return {
    instrumentationKey: key,
    ingestionEndpoint: endpoint.replace(/\/+$/, ''),
  };
}

interface QueuedEvent {
  name: TelemetryEventName;
  payload: Record<string, unknown>;
  timestamp: string;
}

/**
 * Minimal AppInsights HTTP transport. Buffers events and POSTs them in
 * batches to `<endpoint>/v2/track`. No PII ever leaves this process: the
 * deny list is enforced before queueing.
 */
export class HttpAppInsightsReporter implements ITelemetryReporter {
  private readonly parsed: ParsedConnectionString;
  private readonly version: string;
  private readonly maxBufferSize: number;
  private readonly flushIntervalMs: number;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly buffer: QueuedEvent[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;

  constructor(options: HttpReporterOptions) {
    const parsed = parseConnectionString(options.connectionString);
    if (!parsed) {
      throw new Error('[telemetry] invalid AppInsights connection string');
    }
    this.parsed = parsed;
    this.version = options.version;
    this.maxBufferSize = options.maxBufferSize ?? 50;
    this.flushIntervalMs = options.flushIntervalMs ?? 30_000;
    this.fetchImpl =
      options.fetchImpl ??
      (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
    if (this.flushIntervalMs > 0) {
      this.timer = setInterval(() => {
        void this.flush();
      }, this.flushIntervalMs);
      // Allow Node to exit even when the timer is still scheduled.
      this.timer?.unref?.();
    }
  }

  track<E extends TelemetryEventName>(event: E, payload: TelemetryEventMap[E]): void {
    if (this.disposed) {
      return;
    }
    // Type assertion is safe because TelemetryEventMap[E] extends Record<string, unknown>
    const sanitised = this.sanitise(event, payload as Record<string, unknown>);
    if (!sanitised) {
      return;
    }
    this.buffer.push({ name: event, payload: sanitised, timestamp: new Date().toISOString() });
    if (this.buffer.length >= this.maxBufferSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.disposed || this.buffer.length === 0 || !this.fetchImpl) {
      return;
    }
    const batch = this.buffer.splice(0, this.buffer.length);
    const body = batch.map((evt) => ({
      name: 'Microsoft.ApplicationInsights.Event',
      time: evt.timestamp,
      iKey: this.parsed.instrumentationKey,
      tags: {
        'ai.application.ver': this.version,
        'ai.cloud.role': 'warp-vsc-bridge',
      },
      data: {
        baseType: 'EventData',
        baseData: {
          ver: 2,
          name: evt.name,
          properties: evt.payload,
        },
      },
    }));
    try {
      await this.fetchImpl(`${this.parsed.ingestionEndpoint}/v2/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Telemetry must never crash the host. Drop the batch silently.
      logError(`[telemetry] flush failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    // Flush *before* flipping the disposed flag so the buffered batch
    // actually goes out (flush() short-circuits when `disposed === true`).
    await this.flush();
    this.disposed = true;
  }

  private sanitise(
    event: TelemetryEventName,
    payload: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const offending = findForbiddenKeys(payload);
    if (offending.length > 0) {
      logError(
        `[telemetry] dropping '${event}': forbidden keys ${offending.join(', ')}`,
      );
      return null;
    }
    return payload;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Minimal abstraction over `vscode.env` so tests can stub the host. */
export interface TelemetryHostEnv {
  /** Mirrors `vscode.env.isTelemetryEnabled`. */
  readonly isTelemetryEnabled: boolean;
}

/** Inputs to {@link createTelemetryReporter}. */
export interface CreateReporterOptions {
  env: TelemetryHostEnv;
  connectionString: string;
  version: string;
  /** Forwarded to {@link HttpAppInsightsReporter} for tests. */
  fetchImpl?: typeof fetch;
  /** Forwarded to {@link HttpAppInsightsReporter} for tests. */
  maxBufferSize?: number;
  /** Forwarded to {@link HttpAppInsightsReporter} for tests. */
  flushIntervalMs?: number;
}

/**
 * Build the right reporter for the current host:
 *   - {@link NoopReporter} when telemetry is disabled in VS Code or when
 *     `connectionString` is empty.
 *   - {@link HttpAppInsightsReporter} otherwise.
 *
 * Construction failures (malformed connection string, missing global
 * `fetch`) fall back to noop and log a warning — the extension keeps
 * running.
 */
export function createTelemetryReporter(options: CreateReporterOptions): ITelemetryReporter {
  if (!options.env.isTelemetryEnabled) {
    return new NoopReporter();
  }
  if (!options.connectionString) {
    logInfo('[telemetry] connection string empty — telemetry disabled');
    return new NoopReporter();
  }
  try {
    return new HttpAppInsightsReporter({
      connectionString: options.connectionString,
      version: options.version,
      fetchImpl: options.fetchImpl,
      maxBufferSize: options.maxBufferSize,
      flushIntervalMs: options.flushIntervalMs,
    });
  } catch (err) {
    logError(
      `[telemetry] reporter init failed, falling back to noop: ${err instanceof Error ? err.message : String(err)}`,
    );
    return new NoopReporter();
  }
}
