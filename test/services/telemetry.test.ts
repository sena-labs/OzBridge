import { describe, it, expect, vi } from 'vitest';
import {
  ITelemetryReporter,
  TelemetryEventName,
  TelemetryEventMap,
  NoopReporter,
  HttpAppInsightsReporter,
  createTelemetryReporter,
  parseConnectionString,
  findForbiddenKeys,
  assertNoForbiddenKeys,
  FORBIDDEN_KEY_REGEX,
} from '../../src/services/telemetry.js';

describe('telemetry deny-list', () => {
  it('matches every banned property name across casings', () => {
    for (const key of [
      'prompt',
      'PROMPT',
      'content',
      'output',
      'path',
      'workspacePath',
      'runId',
      'runid',
      'message',
      'stack',
      'email',
      'userToken',
      'token',
    ]) {
      expect(FORBIDDEN_KEY_REGEX.test(key)).toBe(true);
    }
  });

  it('passes harmless property names through', () => {
    for (const key of ['kind', 'status', 'durationMs', 'command', 'version']) {
      expect(FORBIDDEN_KEY_REGEX.test(key)).toBe(false);
    }
  });

  it('findForbiddenKeys returns the offending names', () => {
    expect(findForbiddenKeys({ kind: 'x', prompt: 'leak' })).toEqual(['prompt']);
    expect(findForbiddenKeys({ status: 'ok', durationMs: 12 })).toEqual([]);
  });

  it('assertNoForbiddenKeys throws on a forbidden payload', () => {
    expect(() =>
      assertNoForbiddenKeys('runStarted', { kind: 'cloud', runId: 'leak' } as Record<string, unknown>),
    ).toThrow(/runId/);
  });

  it('every declared TelemetryEventMap field has a clean name', () => {
    const declared = {
      extensionActivated: { version: '1.0.0' },
      commandInvoked: { command: '/run' },
      runStarted: { kind: 'local' as const },
      runCompleted: { status: 'SUCCEEDED', durationMs: 42 },
      errorRaised: { kind: 'availabilityCheck' },
    } satisfies TelemetryEventMap;

    for (const [event, payload] of Object.entries(declared)) {
      const offending = findForbiddenKeys(payload as Record<string, unknown>);
      expect(offending, `event ${event} declares forbidden field(s)`).toEqual([]);
    }
  });
});

describe('createTelemetryReporter', () => {
  it('returns NoopReporter when isTelemetryEnabled is false', () => {
    const reporter = createTelemetryReporter({
      env: { isTelemetryEnabled: false },
      connectionString: 'InstrumentationKey=abc;IngestionEndpoint=https://example.invalid/',
      version: '1.0.0',
    });
    expect(reporter).toBeInstanceOf(NoopReporter);
  });

  it('returns NoopReporter when connectionString is empty', () => {
    const reporter = createTelemetryReporter({
      env: { isTelemetryEnabled: true },
      connectionString: '',
      version: '1.0.0',
    });
    expect(reporter).toBeInstanceOf(NoopReporter);
  });

  it('returns HttpAppInsightsReporter when both gates open', () => {
    const reporter = createTelemetryReporter({
      env: { isTelemetryEnabled: true },
      connectionString: 'InstrumentationKey=abc;IngestionEndpoint=https://example.invalid/',
      version: '1.0.0',
      flushIntervalMs: 0,
      fetchImpl: vi.fn(),
    });
    expect(reporter).toBeInstanceOf(HttpAppInsightsReporter);
    void reporter.dispose();
  });

  it('falls back to NoopReporter when connection string is malformed', () => {
    const reporter = createTelemetryReporter({
      env: { isTelemetryEnabled: true },
      connectionString: 'this-is-not-valid',
      version: '1.0.0',
    });
    expect(reporter).toBeInstanceOf(NoopReporter);
  });
});

describe('parseConnectionString', () => {
  it('parses key + endpoint', () => {
    const parsed = parseConnectionString(
      'InstrumentationKey=abc-123;IngestionEndpoint=https://eu.in.applicationinsights.azure.com/',
    );
    expect(parsed).toEqual({
      instrumentationKey: 'abc-123',
      ingestionEndpoint: 'https://eu.in.applicationinsights.azure.com',
    });
  });

  it('defaults the endpoint when only the key is present', () => {
    const parsed = parseConnectionString('InstrumentationKey=abc');
    expect(parsed?.ingestionEndpoint).toBe('https://dc.services.visualstudio.com');
  });

  it('returns null without an instrumentation key', () => {
    expect(parseConnectionString('IngestionEndpoint=https://x/')).toBeNull();
    expect(parseConnectionString('')).toBeNull();
  });
});

describe('NoopReporter', () => {
  it('drops every event without throwing', async () => {
    const reporter: ITelemetryReporter = new NoopReporter();
    reporter.track('extensionActivated', { version: '1.0.0' });
    reporter.track('runStarted', { kind: 'cloud' });
    await reporter.flush();
    await reporter.dispose();
    expect(true).toBe(true);
  });
});

describe('HttpAppInsightsReporter', () => {
  function build(fetchImpl: typeof fetch): HttpAppInsightsReporter {
    return new HttpAppInsightsReporter({
      connectionString: 'InstrumentationKey=abc;IngestionEndpoint=https://example.invalid/',
      version: '1.0.0',
      fetchImpl,
      maxBufferSize: 2,
      flushIntervalMs: 0,
    });
  }

  it('POSTs a batch when the buffer fills', async () => {
    const fetchImpl = vi.fn(async () =>
      ({ ok: true } as unknown as Response),
    );
    const reporter = build(fetchImpl as unknown as typeof fetch);
    reporter.track('extensionActivated', { version: '1.0.0' });
    reporter.track('runStarted', { kind: 'local' });
    // Allow the microtask scheduled by `void this.flush()` to run.
    await new Promise((resolve) => setImmediate(resolve));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://example.invalid/v2/track');
    const body = JSON.parse((init as RequestInit).body as string) as Array<{
      name: string;
      iKey: string;
      data: { baseData: { name: TelemetryEventName; properties: Record<string, unknown> } };
    }>;
    expect(body).toHaveLength(2);
    expect(body[0].name).toBe('Microsoft.ApplicationInsights.Event');
    expect(body[0].iKey).toBe('abc');
    expect(body[0].data.baseData.name).toBe('extensionActivated');
    expect(body[0].data.baseData.properties).toEqual({ version: '1.0.0' });
    await reporter.dispose();
  });

  it('drops events with forbidden keys instead of sending them', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true } as unknown as Response));
    const reporter = build(fetchImpl as unknown as typeof fetch);
    // Bypass typing to simulate an accidental leak from a future call site.
    (reporter as unknown as ITelemetryReporter).track(
      'errorRaised',
      { kind: 'x', prompt: 'super secret' } as unknown as TelemetryEventMap['errorRaised'],
    );
    await reporter.flush();
    expect(fetchImpl).not.toHaveBeenCalled();
    await reporter.dispose();
  });

  it('swallows transport failures', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const reporter = build(fetchImpl as unknown as typeof fetch);
    reporter.track('extensionActivated', { version: '1.0.0' });
    reporter.track('runStarted', { kind: 'cloud' });
    await new Promise((resolve) => setImmediate(resolve));
    // Should not throw — the reporter swallows transport errors.
    await reporter.dispose();
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('dispose() flushes pending events and clears the timer', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true } as unknown as Response));
    const reporter = new HttpAppInsightsReporter({
      connectionString: 'InstrumentationKey=abc;IngestionEndpoint=https://example.invalid/',
      version: '1.0.0',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxBufferSize: 100,
      flushIntervalMs: 0,
    });
    reporter.track('extensionActivated', { version: '1.0.0' });
    await reporter.dispose();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // After dispose, additional tracks are ignored.
    reporter.track('runStarted', { kind: 'cloud' });
    await reporter.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
