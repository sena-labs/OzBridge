/**
 * Idle-timeout regression test — verifies that the Oz CLI subprocess
 * is killed and a STALLED error is raised when no stdout/stderr is
 * received within `idleTimeoutMs`. Guards against the v1.0.0 hang
 * where users had to wait the full 300s `timeoutMs` even when the CLI
 * was clearly unresponsive (e.g. account out of credits with no
 * fail-fast signal).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import * as childProcess from 'node:child_process';
import { OzCliService } from '../../src/services/ozCliService';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';
import { createMockConfigManager } from '../helpers';

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof childProcess>('node:child_process');
  return { ...actual, spawn: vi.fn(), execFileSync: vi.fn() };
});

const mockSpawn = vi.mocked(childProcess.spawn);

function createSilentProcess() {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
    pid: 12345,
  });
  mockSpawn.mockReturnValue(proc as never);
  return proc;
}

describe('OzCliService — idle timeout (STALLED)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws STALLED when no output is received within idleTimeoutMs', async () => {
    const cli = new OzCliService(createMockConfigManager({
      idleTimeoutMs: 1_000,
      timeoutMs: 60_000,
    }));
    const proc = createSilentProcess();

    const promise = cli.agentRun({ prompt: 'hello' }).catch((e) => e);

    // Advance past the idle window but well before the global timeout.
    await vi.advanceTimersByTimeAsync(1_500);

    // The service should have killed the process; emit close to settle the
    // promise just like a real OS would after SIGTERM.
    expect(proc.kill).toHaveBeenCalled();
    proc.emit('close', null);

    const err = (await promise) as OzCliError;
    expect(err).toBeInstanceOf(OzCliError);
    expect(err.kind).toBe(OzCliErrorKind.STALLED);
    expect(err.message).toMatch(/no output for 1s/i);
  });

  it('reclassifies as INSUFFICIENT_CREDITS when stalled stderr carries the documented Warp message', async () => {
    const cli = new OzCliService(createMockConfigManager({
      idleTimeoutMs: 1_000,
      timeoutMs: 60_000,
    }));
    const proc = createSilentProcess();

    const promise = cli.agentRun({ prompt: 'hello' }).catch((e) => e);

    // Emit the documented Warp credits stderr signal then go silent.
    proc.stderr.emit(
      'data',
      Buffer.from('warning: account is out of credits\n'),
    );

    await vi.advanceTimersByTimeAsync(1_500);
    proc.emit('close', null);

    const err = (await promise) as OzCliError;
    expect(err.kind).toBe(OzCliErrorKind.INSUFFICIENT_CREDITS);
  });

  it('keeps STALLED when stalled stderr only carries an ambiguous "rate limit" message', async () => {
    // Regression: a transient network rate-limit hit must NOT be
    // surfaced to the user as "Out of Warp credits" — the issue is
    // documented at
    // https://docs.warp.dev/reference/api-and-sdk/troubleshooting/errors/insufficient-credits
    // and is HTTP 403 with explicit "add-on credits" wording, not 429.
    const cli = new OzCliService(createMockConfigManager({
      idleTimeoutMs: 1_000,
      timeoutMs: 60_000,
    }));
    const proc = createSilentProcess();

    const promise = cli.agentRun({ prompt: 'hello' }).catch((e) => e);

    proc.stderr.emit('data', Buffer.from('rate limit exceeded\n'));

    await vi.advanceTimersByTimeAsync(1_500);
    proc.emit('close', null);

    const err = (await promise) as OzCliError;
    expect(err.kind).toBe(OzCliErrorKind.STALLED);
  });

  it('keeps STALLED when stalled stderr is empty (true timeout, credit available)', async () => {
    // Regression for the false-positive that prompted this change:
    // a silent CLI hang must surface as STALLED so the user sees an
    // accurate diagnostic instead of being pushed to billing.
    const cli = new OzCliService(createMockConfigManager({
      idleTimeoutMs: 1_000,
      timeoutMs: 60_000,
    }));
    const proc = createSilentProcess();

    const promise = cli.agentRun({ prompt: 'hello' }).catch((e) => e);

    await vi.advanceTimersByTimeAsync(1_500);
    proc.emit('close', null);

    const err = (await promise) as OzCliError;
    expect(err.kind).toBe(OzCliErrorKind.STALLED);
  });

  it('does NOT fire when streaming output keeps resetting the idle timer', async () => {
    const cli = new OzCliService(createMockConfigManager({
      idleTimeoutMs: 500,
      timeoutMs: 60_000,
    }));
    const proc = createSilentProcess();

    const promise = cli.agentRun({ prompt: 'hello' }).catch((e) => e);

    // Stream a chunk every 200 ms for 2 s — well past the idle window
    // but the timer should keep resetting.
    for (let i = 0; i < 10; i++) {
      proc.stdout.emit('data', Buffer.from(`{"chunk":${i}}\n`));
      await vi.advanceTimersByTimeAsync(200);
    }

    expect(proc.kill).not.toHaveBeenCalled();

    proc.emit('close', 0);
    await promise; // resolves cleanly
  });

  it('disables idle detection when idleTimeoutMs is 0', async () => {
    const cli = new OzCliService(createMockConfigManager({
      idleTimeoutMs: 0,
      timeoutMs: 5_000,
    }));
    const proc = createSilentProcess();

    const promise = cli.agentRun({ prompt: 'hello' }).catch((e) => e);

    // Advance way past where the idle timer would normally fire.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(proc.kill).not.toHaveBeenCalled();

    // Eventually hit the global timeout.
    await vi.advanceTimersByTimeAsync(2_500);
    proc.emit('close', null);

    const err = (await promise) as OzCliError;
    expect(err.kind).toBe(OzCliErrorKind.TIMEOUT);
  });
});
