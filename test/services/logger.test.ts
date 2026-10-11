/**
 * In-depth tests for the logger — initLogger, logInfo, logWarn, logError, pre-init buffer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The logger uses module state (let _channel, const _buffer). To test it
// in isolation we must re-import it as a fresh module for each test suite.
// Vitest supports vi.resetModules + dynamic import.

async function freshLogger() {
  vi.resetModules();
  return import('../../src/services/logger.js');
}

describe('Logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // initLogger
  // --------------------------------------------------------------------------
  describe('initLogger()', () => {
    it('accepts an OutputChannel without errors', async () => {
      const logger = await freshLogger();
      const channel = { appendLine: vi.fn(), dispose: vi.fn() };
      expect(() => logger.initLogger(channel as any)).not.toThrow();
    });

    it('flushes the pre-init buffer to the channel', async () => {
      const logger = await freshLogger();
      // Log before init — goes into the buffer
      logger.logInfo('before init');
      const channel = { appendLine: vi.fn(), dispose: vi.fn() };
      logger.initLogger(channel as any);
      // The buffer must have been written to the channel
      expect(channel.appendLine).toHaveBeenCalled();
      const flushed = channel.appendLine.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(flushed.some((line) => line.includes('before init'))).toBe(true);
    });

    it('empties the buffer after the flush', async () => {
      const logger = await freshLogger();
      logger.logInfo('buffered');
      const channel = { appendLine: vi.fn(), dispose: vi.fn() };
      logger.initLogger(channel as any);
      const callCount = channel.appendLine.mock.calls.length;
      // Second init — must not re-flush the old messages
      const channel2 = { appendLine: vi.fn(), dispose: vi.fn() };
      logger.initLogger(channel2 as any);
      expect(channel2.appendLine.mock.calls.length).toBeLessThan(callCount);
    });
  });

  // --------------------------------------------------------------------------
  // logInfo
  // --------------------------------------------------------------------------
  describe('logInfo()', () => {
    it('writes to the channel with the [ozbridge] prefix', async () => {
      const logger = await freshLogger();
      const channel = { appendLine: vi.fn(), dispose: vi.fn() };
      logger.initLogger(channel as any, '[ozbridge]');
      logger.logInfo('hello');
      const lastCall = channel.appendLine.mock.calls.at(-1)?.[0] as string;
      expect(lastCall).toContain('[ozbridge]');
      expect(lastCall).toContain('hello');
    });

    it('also logs to console.log', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = await freshLogger();
      const channel = { appendLine: vi.fn(), dispose: vi.fn() };
      logger.initLogger(channel as any);
      logger.logInfo('console test');
      expect(spy).toHaveBeenCalled();
      const arg = spy.mock.calls.at(-1)?.[0] as string;
      expect(arg).toContain('console test');
      spy.mockRestore();
    });

    it('buffers when the channel is not initialized', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = await freshLogger();
      // initLogger is not called — the message goes into the buffer
      logger.logInfo('buffered message');
      expect(spy).toHaveBeenCalled();
      // Now init
      const channel = { appendLine: vi.fn(), dispose: vi.fn() };
      logger.initLogger(channel as any);
      const allAppended = channel.appendLine.mock.calls.map((c: unknown[]) => c[0]).join('\n');
      expect(allAppended).toContain('buffered message');
      spy.mockRestore();
    });
  });

  // --------------------------------------------------------------------------
  // logWarn
  // --------------------------------------------------------------------------
  describe('logWarn()', () => {
    it('writes to the channel with the WARN prefix', async () => {
      const logger = await freshLogger();
      const channel = { appendLine: vi.fn(), dispose: vi.fn() };
      logger.initLogger(channel as any);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      logger.logWarn('caution');
      const lastCall = channel.appendLine.mock.calls.at(-1)?.[0] as string;
      expect(lastCall).toContain('WARN');
      expect(lastCall).toContain('caution');
    });

    it('logs to console.warn', async () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logger = await freshLogger();
      const channel = { appendLine: vi.fn(), dispose: vi.fn() };
      logger.initLogger(channel as any);
      logger.logWarn('warn test');
      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls.at(-1)?.[0]).toContain('warn test');
      spy.mockRestore();
    });

    it('passes extra arguments to console.warn', async () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logger = await freshLogger();
      const channel = { appendLine: vi.fn(), dispose: vi.fn() };
      logger.initLogger(channel as any);
      logger.logWarn('with args', { detail: 42 });
      expect(spy.mock.calls.at(-1)?.length).toBeGreaterThan(1);
      spy.mockRestore();
    });
  });

  // --------------------------------------------------------------------------
  // logError
  // --------------------------------------------------------------------------
  describe('logError()', () => {
    it('writes to the channel with the ERROR prefix', async () => {
      const logger = await freshLogger();
      const channel = { appendLine: vi.fn(), dispose: vi.fn() };
      logger.initLogger(channel as any);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.logError('failure');
      const lastCall = channel.appendLine.mock.calls.at(-1)?.[0] as string;
      expect(lastCall).toContain('ERROR');
      expect(lastCall).toContain('failure');
    });

    it('logs to console.error', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logger = await freshLogger();
      const channel = { appendLine: vi.fn(), dispose: vi.fn() };
      logger.initLogger(channel as any);
      logger.logError('error test');
      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls.at(-1)?.[0]).toContain('error test');
      spy.mockRestore();
    });

    it('passes extra arguments to console.error', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logger = await freshLogger();
      const channel = { appendLine: vi.fn(), dispose: vi.fn() };
      logger.initLogger(channel as any);
      logger.logError('with args', new Error('boom'));
      expect(spy.mock.calls.at(-1)?.length).toBeGreaterThan(1);
      spy.mockRestore();
    });
  });

  // --------------------------------------------------------------------------
  // Pre-init buffer with multiple messages
  // --------------------------------------------------------------------------
  describe('Buffer pre-init', () => {
    it('buffers multiple messages and flushes them in order', async () => {
      const logger = await freshLogger();
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.logInfo('msg1');
      logger.logWarn('msg2');
      logger.logError('msg3');
      const channel = { appendLine: vi.fn(), dispose: vi.fn() };
      logger.initLogger(channel as any);
      const lines = channel.appendLine.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(lines[0]).toContain('msg1');
      expect(lines[1]).toContain('msg2');
      expect(lines[2]).toContain('msg3');
    });
  });
});
