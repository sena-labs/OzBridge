/**
 * Coverage gap tests for ozCliService.ts exec() internals.
 *
 * Covers:
 * - Lines 232-236: Synchronous spawn throw → OzCliError(NOT_FOUND)
 * - Lines 253-255: Timeout handler → killed=true, proc.kill('SIGTERM')
 * - Lines 260-261: CancellationToken handler → killed=true, proc.kill('SIGTERM')
 * - Line 273: proc.on('error') non-ENOENT → OzCliError(CLI_ERROR)
 * - Lines 287-292: proc.on('close') with killed=true → CANCELLED vs TIMEOUT
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { OzCliService } from '../../src/services/ozCliService.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';
import { createMockConfigManager } from '../helpers.js';
import { CancellationTokenSource } from '../mocks/vscode.js';

// ---------------------------------------------------------------------------
// Mock child_process.spawn
// ---------------------------------------------------------------------------
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';

const mockSpawn = vi.mocked(spawn);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createMockProcess(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: Error;
} = {}) {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
    pid: 9999,
  });

  mockSpawn.mockReturnValue(proc as any);

  process.nextTick(() => {
    if (opts.error) {
      proc.emit('error', opts.error);
      return;
    }
    if (opts.stdout) proc.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.stderr) proc.stderr.emit('data', Buffer.from(opts.stderr));
    proc.emit('close', opts.exitCode ?? 0);
  });

  return proc;
}

/**
 * Creates a controllable mock process where events are NOT auto-emitted.
 * The caller manually emits events to control timing.
 */
function createControllableProcess() {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
    pid: 8888,
  });

  mockSpawn.mockReturnValue(proc as any);
  return proc;
}

// ---------------------------------------------------------------------------
let cli: OzCliService;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  cli = new OzCliService(createMockConfigManager({ timeoutMs: 200 }));
});

describe('OzCliService exec() — coverage gaps', () => {
  // =========================================================================
  // Lines 232-236: Synchronous spawn throw
  // =========================================================================
  describe('sync spawn throw', () => {
    it('dovrebbe rigettare con NOT_FOUND se spawn lancia sincronamente', async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error('EPERM: operation not permitted');
      });

      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OzCliError);
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.NOT_FOUND);
        expect((err as OzCliError).message).toContain('Failed to spawn');
        expect((err as OzCliError).message).toContain('EPERM');
      }
    });

    it('dovrebbe includere il percorso oz nel messaggio di errore sync', async () => {
      mockSpawn.mockImplementation(() => {
        throw new TypeError('Cannot execute');
      });

      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as OzCliError).message).toContain('oz');
        expect((err as OzCliError).message).toContain('Cannot execute');
      }
    });
  });

  // =========================================================================
  // Line 273: proc.on('error') non-ENOENT → CLI_ERROR
  // =========================================================================
  describe('non-ENOENT spawn error', () => {
    it('dovrebbe rigettare con CLI_ERROR per errore generico (non ENOENT)', async () => {
      createMockProcess({ error: new Error('EACCES: permission denied') });

      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OzCliError);
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.CLI_ERROR);
        expect((err as OzCliError).message).toContain('EACCES');
      }
    });

    it('dovrebbe rigettare con CLI_ERROR per errore EPIPE', async () => {
      createMockProcess({ error: new Error('EPIPE: broken pipe') });

      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.CLI_ERROR);
        expect((err as OzCliError).message).toContain('EPIPE');
      }
    });
  });

  // =========================================================================
  // Lines 253-255 + 287-292: Timeout → killed=true → TIMEOUT on close
  // =========================================================================
  describe('timeout handling', () => {
    it('dovrebbe rigettare con TIMEOUT quando il processo non termina in tempo', async () => {
      vi.useFakeTimers();

      const proc = createControllableProcess();

      const promise = cli.agentRun({ prompt: 'slow operation' });

      // Avanza il timer oltre il timeout (200ms configurato)
      await vi.advanceTimersByTimeAsync(250);

      // Il timeout handler ha settato killed=true e chiamato proc.kill
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

      // Ora il processo mock emette 'close' (come farebbe dopo SIGTERM)
      proc.emit('close', null);

      await expect(promise).rejects.toThrow(OzCliError);

      try {
        await promise;
      } catch (err) {
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.TIMEOUT);
        expect((err as OzCliError).message).toContain('timed out');
      }

      vi.useRealTimers();
    });
  });

  // =========================================================================
  // Lines 260-261 + 287-292: Cancellation → killed=true → CANCELLED on close
  // =========================================================================
  describe('cancellation handling', () => {
    it('dovrebbe rigettare con CANCELLED quando il token viene cancellato', async () => {
      const proc = createControllableProcess();

      const cts = new CancellationTokenSource();
      // agentRun passes cancellation token to exec()
      const promise = cli.agentRun({ prompt: 'cancel me', cancellation: cts.token as any });

      // Simula la cancellazione dell'utente
      cts.cancel();

      // Il cancel handler ha settato killed=true e chiamato proc.kill
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

      // Il processo chiude dopo il kill
      proc.emit('close', null);

      await expect(promise).rejects.toThrow(OzCliError);

      try {
        await promise;
      } catch (err) {
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.CANCELLED);
        expect((err as OzCliError).message).toContain('cancelled');
      }
    });
  });

  // =========================================================================
  // Line 234: spawn throw non-Error → String(err) branch
  // =========================================================================
  describe('sync spawn throw non-Error', () => {
    it('dovrebbe gestire throw di stringa con String() nel messaggio', async () => {
      mockSpawn.mockImplementation(() => {
        // eslint-disable-next-line no-throw-literal
        throw 'raw string error';
      });

      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(OzCliError);
        expect((err as OzCliError).message).toContain('raw string error');
      }
    });
  });

  // =========================================================================
  // Lines 267, 280: settled guards — double event race
  // =========================================================================
  describe('settled guards (double event)', () => {
    it('dovrebbe ignorare evento error se già settled da close (L267)', async () => {
      const proc = createControllableProcess();
      const promise = cli.agentRun({ prompt: 'double-settle' });

      // stdout con dati validi poi close → settled = true
      proc.stdout.emit('data', Buffer.from('{"status":"SUCCEEDED"}'));
      proc.emit('close', 0);

      // Error tardivo → deve essere ignorato dal settled guard
      proc.emit('error', new Error('late error'));

      const result = await promise;
      expect(result.status).toBe('SUCCEEDED');
    });

    it('dovrebbe ignorare evento close se già settled da error (L280)', async () => {
      const proc = createControllableProcess();
      const promise = cli.agentRun({ prompt: 'err-then-close' });

      // Error fires first → settled = true
      proc.emit('error', new Error('ENOENT: not found'));

      // Close tardivo → deve essere ignorato dal settled guard
      proc.emit('close', 1);

      await expect(promise).rejects.toThrow(OzCliError);
    });
  });

  // =========================================================================
  // Line 302: CLI_ERROR with empty stderr + stdout → "Exit code N" fallback
  // =========================================================================
  describe('CLI_ERROR empty output fallback', () => {
    it('dovrebbe usare "Exit code N" come messaggio se stderr e stdout sono vuoti', async () => {
      const proc = createControllableProcess();
      const promise = cli.agentRun({ prompt: 'empty-fail' });

      // Close con exit code non-zero senza emettere stdout/stderr
      proc.emit('close', 42);

      try {
        await promise;
        expect.fail('should throw');
      } catch (err) {
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.CLI_ERROR);
        expect((err as OzCliError).message).toContain('Exit code 42');
      }
    });
  });
});
