import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RunPoller } from '../../src/services/runPoller.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';
import { createMockCli, createMockConfigManager, makeRunResult } from '../helpers.js';

let poller: RunPoller;
let cli: ReturnType<typeof createMockCli>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  cli = createMockCli();
  poller = new RunPoller(cli, createMockConfigManager({
    cloudPollingIntervalMs: 100,     // Veloce per test
    cloudPollingTimeoutMs: 10_000,
  }));
});

afterEach(() => {
  try {
    poller?.disposeAll();
  } finally {
    vi.useRealTimers();
  }
});

describe('RunPoller', () => {
  // =========================================================================
  // poll() - happy path
  // =========================================================================
  describe('poll() success', () => {
    it('dovrebbe ritornare immediatamente se lo stato è terminale al primo poll', async () => {
      cli.runGet.mockResolvedValue(makeRunResult({ status: 'SUCCEEDED' }));

      const onProgress = vi.fn();
      const pollPromise = poller.poll('run-1', onProgress);

      // Avanziamo il timer per il primo intervallo
      await vi.advanceTimersByTimeAsync(100);

      const result = await pollPromise;
      expect(result.status).toBe('SUCCEEDED');
      expect(onProgress).toHaveBeenCalledWith('SUCCEEDED');
      expect(cli.runGet).toHaveBeenCalledWith('run-1');
    });

    it('dovrebbe pollare più volte prima del risultato finale', async () => {
      let callCount = 0;
      cli.runGet.mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          return makeRunResult({ status: 'INPROGRESS' });
        }
        return makeRunResult({ status: 'SUCCEEDED' });
      });

      const onProgress = vi.fn();
      const pollPromise = poller.poll('run-2', onProgress);

      // Poll 1: INPROGRESS
      await vi.advanceTimersByTimeAsync(100);
      // Poll 2: INPROGRESS
      await vi.advanceTimersByTimeAsync(150); // backoff: 100 * 1.5
      // Poll 3: SUCCEEDED
      await vi.advanceTimersByTimeAsync(225); // backoff: 150 * 1.5

      const result = await pollPromise;
      expect(result.status).toBe('SUCCEEDED');
      expect(onProgress).toHaveBeenCalledWith('INPROGRESS');
      expect(onProgress).toHaveBeenCalledWith('SUCCEEDED');
    });

    it('dovrebbe gestire stato FAILED come terminale', async () => {
      cli.runGet.mockResolvedValue(makeRunResult({ status: 'FAILED' }));
      const pollPromise = poller.poll('run-3', vi.fn());
      await vi.advanceTimersByTimeAsync(100);
      const result = await pollPromise;
      expect(result.status).toBe('FAILED');
    });
  });

  // =========================================================================
  // poll() - timeout
  // =========================================================================
  describe('poll() timeout', () => {
    it('dovrebbe lanciare TIMEOUT se supera cloudPollingTimeoutMs', async () => {
      // Usa un poller con timeout BASSO per evitare timeout del test
      const fastPoller = new RunPoller(cli, createMockConfigManager({
        cloudPollingIntervalMs: 50,
        cloudPollingTimeoutMs: 300,
      }));

      cli.runGet.mockResolvedValue(makeRunResult({ status: 'INPROGRESS' }));

      const pollPromise = fastPoller.poll('run-timeout', vi.fn());
      // Attacca catch per prevenire Unhandled Rejection
      const settled = pollPromise.catch((e: unknown) => e);

      // Avanziamo in piccoli step per permettere la creazione dei timer
      for (let i = 0; i < 20; i++) {
        await vi.advanceTimersByTimeAsync(50);
      }

      const err = await settled;
      expect(err).toBeInstanceOf(OzCliError);
      expect((err as OzCliError).kind).toBe(OzCliErrorKind.TIMEOUT);

      fastPoller.disposeAll();
    });
  });

  // =========================================================================
  // poll() - cancellation
  // =========================================================================
  describe('poll() cancellation', () => {
    it('dovrebbe lanciare CANCELLED se il token viene cancellato', async () => {
      cli.runGet.mockResolvedValue(makeRunResult({ status: 'INPROGRESS' }));

      // Crea mock CancellationToken
      const listeners: Array<() => void> = [];
      const mockToken = {
        isCancellationRequested: false,
        onCancellationRequested: (cb: () => void) => {
          listeners.push(cb);
          return { dispose: vi.fn() };
        },
      };

      const pollPromise = poller.poll('run-cancel', vi.fn(), mockToken as any);
      // Attacca catch per prevenire Unhandled Rejection
      const settled = pollPromise.catch((e: unknown) => e);

      // Let one poll cycle run
      await vi.advanceTimersByTimeAsync(100);

      // Cancel
      mockToken.isCancellationRequested = true;
      listeners.forEach(l => l());

      await vi.advanceTimersByTimeAsync(100);

      const err = await settled;
      expect(err).toBeInstanceOf(OzCliError);
      expect((err as OzCliError).kind).toBe(OzCliErrorKind.CANCELLED);
    });
  });

  // =========================================================================
  // disposeAll()
  // =========================================================================
  describe('disposeAll()', () => {
    it('dovrebbe abortire tutti i poller attivi', async () => {
      cli.runGet.mockResolvedValue(makeRunResult({ status: 'INPROGRESS' }));

      const p1 = poller.poll('r1', vi.fn());
      const p2 = poller.poll('r2', vi.fn());

      // Attacca catch PRIMA di disposeAll per evitare Unhandled Rejection
      const p1Settled = p1.catch((e: unknown) => e);
      const p2Settled = p2.catch((e: unknown) => e);

      poller.disposeAll();

      await vi.advanceTimersByTimeAsync(200);

      const r1 = await p1Settled;
      const r2 = await p2Settled;
      expect(r1).toBeInstanceOf(OzCliError);
      expect(r2).toBeInstanceOf(OzCliError);
      expect((r1 as OzCliError).kind).toBe(OzCliErrorKind.CANCELLED);
      expect((r2 as OzCliError).kind).toBe(OzCliErrorKind.CANCELLED);
    });

    it('dovrebbe essere idempotente', () => {
      expect(() => {
        poller.disposeAll();
        poller.disposeAll();
      }).not.toThrow();
    });
  });

  // =========================================================================
  // sleep() short-circuit con signal pre-aborted
  // =========================================================================
  describe('sleep() con signal già abortito', () => {
    it('dovrebbe lanciare CANCELLED se il signal è già abortito prima del poll', async () => {
      cli.runGet.mockResolvedValue(makeRunResult({ status: 'INPROGRESS' }));

      // Abort immediatamente prima di poll
      const abort = new AbortController();
      abort.abort();

      // Usiamo CancellationToken pre-cancelled
      const mockToken = {
        isCancellationRequested: true,
        onCancellationRequested: (cb: () => void) => {
          // Invoca subito poiché già cancelled
          cb();
          return { dispose: vi.fn() };
        },
      };

      const pollPromise = poller.poll('run-preabort', vi.fn(), mockToken as any);
      const settled = pollPromise.catch((e: unknown) => e);

      await vi.advanceTimersByTimeAsync(200);

      const err = await settled;
      expect(err).toBeInstanceOf(OzCliError);
      expect((err as OzCliError).kind).toBe(OzCliErrorKind.CANCELLED);
    });
  });

  // =========================================================================
  // poll() - runGet failure during polling
  // =========================================================================
  describe('poll() con runGet che fallisce', () => {
    it('dovrebbe propagare errore se runGet lancia OzCliError', async () => {
      cli.runGet.mockRejectedValue(new OzCliError(OzCliErrorKind.CLI_ERROR, 'service unavailable', 1));

      const pollPromise = poller.poll('run-err', vi.fn());
      const settled = pollPromise.catch((e: unknown) => e);

      await vi.advanceTimersByTimeAsync(100);

      const err = await settled;
      expect(err).toBeInstanceOf(OzCliError);
      expect((err as OzCliError).kind).toBe(OzCliErrorKind.CLI_ERROR);
    });

    it('dovrebbe propagare errore generico se runGet lancia Error', async () => {
      cli.runGet.mockRejectedValue(new Error('ECONNREFUSED'));

      const pollPromise = poller.poll('run-net-err', vi.fn());
      const settled = pollPromise.catch((e: unknown) => e);

      await vi.advanceTimersByTimeAsync(100);

      const err = await settled;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('ECONNREFUSED');
    });
  });

  // =========================================================================
  // Backoff behavior
  // =========================================================================
  describe('backoff esponenziale', () => {
    it('dovrebbe aumentare l\'intervallo fino a maxInterval (30s)', async () => {
      // Create a poller with a longer timeout for this backoff test
      const backoffPoller = new RunPoller(cli, createMockConfigManager({
        cloudPollingIntervalMs: 100,
        cloudPollingTimeoutMs: 100_000, // 100 seconds to allow full backoff test
      }));

      let callCount = 0;
      cli.runGet.mockImplementation(async () => {
        callCount++;
        if (callCount === 10) return makeRunResult({ status: 'SUCCEEDED' });
        return makeRunResult({ status: 'INPROGRESS' });
      });

      const pollPromise = backoffPoller.poll('run-backoff', vi.fn());

      // Avanziamo abbastanza per completare 10 cicli con backoff
      for (let i = 0; i < 15; i++) {
        await vi.advanceTimersByTimeAsync(5000);
      }

      const result = await pollPromise;
      expect(result.status).toBe('SUCCEEDED');
      expect(callCount).toBe(10);

      backoffPoller.disposeAll();
    });
  });
});
