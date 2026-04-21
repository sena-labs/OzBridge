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
    for (const controller of this.activePollers) {
      controller.abort();
    }
    this.activePollers.clear();
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
      await this.sleep(interval, signal);
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
