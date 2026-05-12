import * as vscode from 'vscode';
import { logError, logInfo } from './logger.js';

export type StartupState = 'cold' | 'initializing' | 'ready' | 'degraded';
export type StartupGateResult = 'ready' | 'degraded' | 'timeout';

type StartupTask = {
  label: string;
  run: () => Promise<void>;
};

/**
 * Coordinates extension startup in a fail-open manner.
 *
 * Goals:
 * - single-flight initialization (`start` / `ensureReady` never run the queue twice)
 * - soft-gated callers (`ensureReady` can timeout without throwing)
 * - resilient deferred tasks (one failure degrades startup but does not crash activation)
 */
export class StartupCoordinator implements vscode.Disposable {
  private readonly queue: StartupTask[] = [];
  private state: StartupState = 'cold';
  private disposed = false;
  private failedTasks = 0;
  private flight: Promise<void> | null = null;

  constructor(private readonly defaultSoftTimeoutMs = 1500) {}

  get currentState(): StartupState {
    return this.state;
  }

  enqueue(label: string, task: () => Promise<void>): void {
    if (this.disposed) {
      return;
    }
    if (typeof label !== 'string' || label.trim().length === 0) {
      throw new Error('Startup task label cannot be empty.');
    }
    const wrapped: StartupTask = { label: label.trim(), run: task };
    if (this.state === 'cold') {
      this.queue.push(wrapped);
      return;
    }
    // Startup already started/completed: run late task best-effort without
    // mutating the queue order of the original batch.
    void this.safeRun(wrapped);
  }

  start(): void {
    if (this.disposed) {
      return;
    }
    if (this.flight) {
      return;
    }
    this.flight = this.runQueue();
  }

  async ensureReady(opts: { softTimeoutMs?: number } = {}): Promise<StartupGateResult> {
    if (this.disposed) {
      return 'degraded';
    }
    this.start();
    if (!this.flight) {
      return this.state === 'degraded' ? 'degraded' : 'ready';
    }

    const softTimeoutMs = opts.softTimeoutMs ?? this.defaultSoftTimeoutMs;
    if (!Number.isFinite(softTimeoutMs) || softTimeoutMs <= 0) {
      await this.flight;
      return this.state === 'degraded' ? 'degraded' : 'ready';
    }

    const timeoutTag = Symbol('startup-timeout');
    const result = await Promise.race<symbol | void>([
      this.flight,
      new Promise<symbol>((resolve) => {
        const handle = setTimeout(() => resolve(timeoutTag), softTimeoutMs);
        handle.unref?.();
      }),
    ]);

    if (result === timeoutTag) {
      return 'timeout';
    }
    return this.state === 'degraded' ? 'degraded' : 'ready';
  }

  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
  }

  private async runQueue(): Promise<void> {
    if (this.disposed) {
      this.state = 'degraded';
      return;
    }
    this.state = 'initializing';
    logInfo(`[startup] begin deferred initialization (${this.queue.length} task(s)).`);

    while (this.queue.length > 0 && !this.disposed) {
      const task = this.queue.shift();
      if (!task) {
        break;
      }
      await this.safeRun(task);
    }

    if (this.disposed || this.failedTasks > 0) {
      this.state = 'degraded';
      logInfo(`[startup] completed in degraded mode (failed tasks: ${this.failedTasks}).`);
    } else {
      this.state = 'ready';
      logInfo('[startup] completed: ready.');
    }
  }

  private async safeRun(task: StartupTask): Promise<void> {
    const startedAt = Date.now();
    try {
      logInfo(`[startup] task:start ${task.label}`);
      await task.run();
      logInfo(`[startup] task:ok ${task.label} (${Date.now() - startedAt}ms)`);
    } catch (err) {
      this.failedTasks += 1;
      logError(`[startup] task:fail ${task.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
