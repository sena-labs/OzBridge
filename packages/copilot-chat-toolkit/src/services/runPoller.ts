import * as vscode from 'vscode';
import { IRunPoller, IRunStatusProvider, RunStatus, RunResult, CliError, CliErrorKind, PollingConfig } from '../types.js';

/**
 * Asynchronous poller with exponential back-off for long-running operations.
 *
 * Starts at the configured polling interval, scales by ×1.5 up to a 30 s cap,
 * and aborts after the configured total timeout. Integrates with VS Code's
 * {@link vscode.CancellationToken} and an internal {@link AbortController} set.
 */
export class BaseRunPoller implements IRunPoller {
  private readonly activePollers = new Set<AbortController>();
  private disposing = false;

  /**
   * @param provider - Service that can fetch the current run status.
   * @param getPollingConfig - Getter returning current polling intervals/timeouts.
   */
  constructor(
    private readonly provider: IRunStatusProvider,
    private readonly getPollingConfig: () => PollingConfig,
  ) {}

  async poll(
    runId: string,
    onProgress: (status: RunStatus) => void,
    cancellation?: vscode.CancellationToken,
  ): Promise<RunResult> {
    if (this.disposing) {
      throw new CliError(CliErrorKind.CANCELLED, `Poller is disposing; cannot start new poll for ${runId}`);
    }
    const abort = new AbortController();
    this.activePollers.add(abort);

    const cancelListener = cancellation?.onCancellationRequested(() => {
      abort.abort();
    });

    try {
      return await this.doPoll(runId, onProgress, abort.signal);
    } finally {
      cancelListener?.dispose();
      this.activePollers.delete(abort);
    }
  }

  disposeAll(): void {
    this.disposing = true;
    // Snapshot to avoid iterator invalidation if abort handlers schedule
    // anything that mutates the set synchronously.
    const pending = Array.from(this.activePollers);
    this.activePollers.clear();
    for (const controller of pending) {
      controller.abort();
    }
  }

  private async doPoll(
    runId: string,
    onProgress: (status: RunStatus) => void,
    signal: AbortSignal,
  ): Promise<RunResult> {
    const config = this.getPollingConfig();
    const startTime = Date.now();
    let interval = config.intervalMs;
    const maxInterval = 30_000;
    const backoffFactor = 1.5;

    while (!signal.aborted) {
      // Clamp the sleep to the time remaining before the global timeout so
      // we never overshoot the deadline by up to a full backoff interval.
      const remaining = config.timeoutMs - (Date.now() - startTime);
      if (remaining <= 0) {
        throw new CliError(
          CliErrorKind.TIMEOUT,
          `Polling timeout after ${config.timeoutMs / 1000}s for run ${runId}`,
        );
      }
      await this.sleep(Math.min(interval, remaining), signal);
      if (signal.aborted) {
        break;
      }

      if (Date.now() - startTime > config.timeoutMs) {
        throw new CliError(
          CliErrorKind.TIMEOUT,
          `Polling timeout after ${config.timeoutMs / 1000}s for run ${runId}`,
        );
      }

      const result = await this.provider.runGet(runId);
      onProgress(result.status);

      if (result.status === 'SUCCEEDED' || result.status === 'FAILED') {
        return result;
      }

      interval = Math.min(interval * backoffFactor, maxInterval);
    }

    throw new CliError(CliErrorKind.CANCELLED, `Polling cancelled for run ${runId}`);
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) { resolve(); return; }
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }
}
