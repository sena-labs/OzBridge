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
  // Stato iniziale
  // ---------------------------------------------------------------------------

  it('dovrebbe iniziare in stato cold', () => {
    expect(sc.currentState).toBe('cold');
  });

  // ---------------------------------------------------------------------------
  // enqueue
  // ---------------------------------------------------------------------------

  it('dovrebbe accodare task in stato cold senza eseguirlo subito', async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    sc.enqueue('test.task', task);
    expect(task).not.toHaveBeenCalled();

    sc.start();
    await sc.ensureReady({ softTimeoutMs: 5_000 });
    expect(task).toHaveBeenCalledOnce();
  });

  it('dovrebbe lanciare un errore se il label è una stringa vuota', () => {
    expect(() => sc.enqueue('', vi.fn())).toThrow('Startup task label cannot be empty.');
  });

  it('dovrebbe lanciare un errore se il label contiene solo spazi', () => {
    expect(() => sc.enqueue('   ', vi.fn())).toThrow('Startup task label cannot be empty.');
  });

  it('dovrebbe ignorare enqueue dopo dispose senza lanciare', () => {
    sc.dispose();
    expect(() => sc.enqueue('late', vi.fn())).not.toThrow();
    expect(sc.currentState).toBe('cold');
  });

  it('dovrebbe eseguire task accodata dopo start (late enqueue best-effort)', async () => {
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

  it('dovrebbe essere idempotente: start() chiamato due volte non esegue la coda due volte', async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    sc.enqueue('t', task);
    sc.start();
    sc.start();
    await sc.ensureReady({ softTimeoutMs: 5_000 });
    expect(task).toHaveBeenCalledOnce();
  });

  it('dovrebbe ignorare start() dopo dispose', () => {
    sc.dispose();
    expect(() => sc.start()).not.toThrow();
    expect(sc.currentState).toBe('cold');
  });

  // ---------------------------------------------------------------------------
  // Ordine di esecuzione
  // ---------------------------------------------------------------------------

  it("dovrebbe eseguire task nell'ordine di accodamento", async () => {
    const order: number[] = [];
    sc.enqueue('first', async () => { order.push(1); });
    sc.enqueue('second', async () => { order.push(2); });
    sc.enqueue('third', async () => { order.push(3); });
    sc.start();
    await sc.ensureReady({ softTimeoutMs: 5_000 });
    expect(order).toEqual([1, 2, 3]);
  });

  // ---------------------------------------------------------------------------
  // Gestione degli errori / stato degraded
  // ---------------------------------------------------------------------------

  it('dovrebbe passare a stato degraded se un task fallisce continuando gli altri', async () => {
    const after = vi.fn().mockResolvedValue(undefined);
    sc.enqueue('failing', async () => { throw new Error('boom'); });
    sc.enqueue('after', after);
    sc.start();
    const result = await sc.ensureReady({ softTimeoutMs: 5_000 });
    expect(result).toBe('degraded');
    expect(sc.currentState).toBe('degraded');
    expect(after).toHaveBeenCalledOnce();
  });

  it("dovrebbe restituire 'degraded' da ensureReady quando lo stato è degraded", async () => {
    sc.enqueue('bad', async () => { throw new Error('x'); });
    sc.start();
    const r = await sc.ensureReady({ softTimeoutMs: 5_000 });
    expect(r).toBe('degraded');
  });

  // ---------------------------------------------------------------------------
  // ensureReady — timeout
  // ---------------------------------------------------------------------------

  it("dovrebbe restituire 'timeout' quando i task impiegano più del softTimeout", async () => {
    sc.enqueue('slow', () => new Promise<void>((resolve) => { setTimeout(resolve, 500); }));
    sc.start();
    const result = await sc.ensureReady({ softTimeoutMs: 10 });
    expect(result).toBe('timeout');
  });

  it("dovrebbe restituire 'ready' al termine dei task entro il timeout", async () => {
    sc.enqueue('fast', async () => { /* instant */ });
    sc.start();
    const result = await sc.ensureReady({ softTimeoutMs: 5_000 });
    expect(result).toBe('ready');
    expect(sc.currentState).toBe('ready');
  });

  it("dovrebbe attendere il completamento completo quando softTimeoutMs è zero", async () => {
    sc.enqueue('task', async () => { /* instant */ });
    sc.start();
    const result = await sc.ensureReady({ softTimeoutMs: 0 });
    expect(['ready', 'degraded']).toContain(result);
  });

  it("dovrebbe restituire 'degraded' da ensureReady se già disposed", async () => {
    sc.dispose();
    const result = await sc.ensureReady();
    expect(result).toBe('degraded');
  });

  it("dovrebbe chiamare start() internamente se non ancora avviato (auto-start)", async () => {
    sc.enqueue('t', async () => { /* instant */ });
    const result = await sc.ensureReady({ softTimeoutMs: 5_000 });
    expect(result).toBe('ready');
  });

  // ---------------------------------------------------------------------------
  // dispose
  // ---------------------------------------------------------------------------

  it('dovrebbe svuotare la coda su dispose', () => {
    sc.enqueue('pending', async () => { /* instant */ });
    sc.dispose();
    expect(sc.currentState).toBe('cold');
  });

  it('dovrebbe essere idempotente: dispose() chiamato due volte non lancia', () => {
    expect(() => {
      sc.dispose();
      sc.dispose();
    }).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Transizioni di stato
  // ---------------------------------------------------------------------------

  it("dovrebbe passare a stato ready su coda vuota dopo start()", async () => {
    sc.start();
    await sc.ensureReady({ softTimeoutMs: 5_000 });
    expect(sc.currentState).toBe('ready');
  });
});
