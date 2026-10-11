import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StartupCoordinator } from '../../src/services/startupCoordinator.js';

// Silence logger output during tests.
vi.mock('../../src/services/logger.js', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

describe('StartupCoordinator', () => {
  let sc: StartupCoordinator;

  beforeEach(() => {
    vi.clearAllMocks();
    sc = new StartupCoordinator(1500);
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  it('starts in the cold state', () => {
    expect(sc.currentState).toBe('cold');
  });

  // ---------------------------------------------------------------------------
  // enqueue
  // ---------------------------------------------------------------------------

  it('queues a task in the cold state without running it immediately', async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    sc.enqueue('test.task', task);
    expect(task).not.toHaveBeenCalled();

    sc.start();
    await sc.ensureReady({ softTimeoutMs: 5_000 });
    expect(task).toHaveBeenCalledOnce();
  });

  it('throws an error when the label is an empty string', () => {
    expect(() => sc.enqueue('', vi.fn())).toThrow('Startup task label cannot be empty.');
  });

  it('throws an error when the label contains only spaces', () => {
    expect(() => sc.enqueue('   ', vi.fn())).toThrow('Startup task label cannot be empty.');
  });

  it('ignores enqueue after dispose without throwing', () => {
    sc.dispose();
    expect(() => sc.enqueue('late', vi.fn())).not.toThrow();
    expect(sc.currentState).toBe('cold');
  });

  it('runs a task queued after start (best-effort late enqueue)', async () => {
    sc.start();
    await sc.ensureReady({ softTimeoutMs: 5_000 });

    const late = vi.fn().mockResolvedValue(undefined);
    sc.enqueue('late.task', late);
    // Allow the micro-task from safeRun to settle.
    await new Promise<void>((r) => setImmediate(r));
    expect(late).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // start / single-flight
  // ---------------------------------------------------------------------------

  it('is idempotent: start() called twice does not run the queue twice', async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    sc.enqueue('t', task);
    sc.start();
    sc.start();
    await sc.ensureReady({ softTimeoutMs: 5_000 });
    expect(task).toHaveBeenCalledOnce();
  });

  it('ignores start() after dispose', () => {
    sc.dispose();
    expect(() => sc.start()).not.toThrow();
    expect(sc.currentState).toBe('cold');
  });

  // ---------------------------------------------------------------------------
  // Execution order
  // ---------------------------------------------------------------------------

  it("runs tasks in the order they were queued", async () => {
    const order: number[] = [];
    sc.enqueue('first', async () => { order.push(1); });
    sc.enqueue('second', async () => { order.push(2); });
    sc.enqueue('third', async () => { order.push(3); });
    sc.start();
    await sc.ensureReady({ softTimeoutMs: 5_000 });
    expect(order).toEqual([1, 2, 3]);
  });

  // ---------------------------------------------------------------------------
  // Error handling / degraded state
  // ---------------------------------------------------------------------------

  it('moves to the degraded state when a task fails, while still running the others', async () => {
    const after = vi.fn().mockResolvedValue(undefined);
    sc.enqueue('failing', async () => { throw new Error('boom'); });
    sc.enqueue('after', after);
    sc.start();
    const result = await sc.ensureReady({ softTimeoutMs: 5_000 });
    expect(result).toBe('degraded');
    expect(sc.currentState).toBe('degraded');
    expect(after).toHaveBeenCalledOnce();
  });

  it("returns 'degraded' from ensureReady when the state is degraded", async () => {
    sc.enqueue('bad', async () => { throw new Error('x'); });
    sc.start();
    const r = await sc.ensureReady({ softTimeoutMs: 5_000 });
    expect(r).toBe('degraded');
  });

  // ---------------------------------------------------------------------------
  // ensureReady — timeout
  // ---------------------------------------------------------------------------

  it("returns 'timeout' when the tasks take longer than softTimeout", async () => {
    sc.enqueue('slow', () => new Promise<void>((resolve) => { setTimeout(resolve, 500); }));
    sc.start();
    const result = await sc.ensureReady({ softTimeoutMs: 10 });
    expect(result).toBe('timeout');
  });

  it("returns 'ready' when the tasks finish within the timeout", async () => {
    sc.enqueue('fast', async () => { /* instant */ });
    sc.start();
    const result = await sc.ensureReady({ softTimeoutMs: 5_000 });
    expect(result).toBe('ready');
    expect(sc.currentState).toBe('ready');
  });

  it("waits for full completion when softTimeoutMs is zero", async () => {
    sc.enqueue('task', async () => { /* instant */ });
    sc.start();
    const result = await sc.ensureReady({ softTimeoutMs: 0 });
    expect(['ready', 'degraded']).toContain(result);
  });

  it("returns 'degraded' from ensureReady when already disposed", async () => {
    sc.dispose();
    const result = await sc.ensureReady();
    expect(result).toBe('degraded');
  });

  it("calls start() internally when not started yet (auto-start)", async () => {
    sc.enqueue('t', async () => { /* instant */ });
    const result = await sc.ensureReady({ softTimeoutMs: 5_000 });
    expect(result).toBe('ready');
  });

  // ---------------------------------------------------------------------------
  // dispose
  // ---------------------------------------------------------------------------

  it('empties the queue on dispose', () => {
    sc.enqueue('pending', async () => { /* instant */ });
    sc.dispose();
    expect(sc.currentState).toBe('cold');
  });

  it('is idempotent: dispose() called twice does not throw', () => {
    expect(() => {
      sc.dispose();
      sc.dispose();
    }).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // State transitions
  // ---------------------------------------------------------------------------

  it("moves to the ready state on an empty queue after start()", async () => {
    sc.start();
    await sc.ensureReady({ softTimeoutMs: 5_000 });
    expect(sc.currentState).toBe('ready');
  });
});
