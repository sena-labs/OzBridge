/**
 * Test approfonditi per il logger — initLogger, logInfo, logWarn, logError, buffer pre-init.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Il logger usa stato di modulo (let _channel, const _buffer). Per poterlo testare
// in isolamento dobbiamo reimportarlo con un modulo fresco ad ogni test-suite.
// Vitest supporta vi.resetModules + import dinamico.

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
    it('dovrebbe accettare un OutputChannel senza errori', async () => {
      const logger = await freshLogger();
      const channel = { appendLine: vi.fn(), dispose: vi.fn() };
      expect(() => logger.initLogger(channel as any)).not.toThrow();
    });

    it('dovrebbe flushare il buffer pre-init al channel', async () => {
      const logger = await freshLogger();
      // Log prima dell'init — va nel buffer
      logger.logInfo('before init');
      const channel = { appendLine: vi.fn(), dispose: vi.fn() };
      logger.initLogger(channel as any);
      // Il buffer deve essere stato scritto nel channel
      expect(channel.appendLine).toHaveBeenCalled();
      const flushed = channel.appendLine.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(flushed.some((line) => line.includes('before init'))).toBe(true);
    });

    it('dovrebbe svuotare il buffer dopo il flush', async () => {
      const logger = await freshLogger();
      logger.logInfo('buffered');
      const channel = { appendLine: vi.fn(), dispose: vi.fn() };
      logger.initLogger(channel as any);
      const callCount = channel.appendLine.mock.calls.length;
      // Seconda init — non deve ri-flushare i vecchi messaggi
      const channel2 = { appendLine: vi.fn(), dispose: vi.fn() };
      logger.initLogger(channel2 as any);
      expect(channel2.appendLine.mock.calls.length).toBeLessThan(callCount);
    });
  });

  // --------------------------------------------------------------------------
  // logInfo
  // --------------------------------------------------------------------------
  describe('logInfo()', () => {
    it('dovrebbe scrivere nel channel con prefisso [ozbridge]', async () => {
      const logger = await freshLogger();
      const channel = { appendLine: vi.fn(), dispose: vi.fn() };
      logger.initLogger(channel as any, '[ozbridge]');
      logger.logInfo('hello');
      const lastCall = channel.appendLine.mock.calls.at(-1)?.[0] as string;
      expect(lastCall).toContain('[ozbridge]');
      expect(lastCall).toContain('hello');
    });

    it('dovrebbe loggare anche su console.log', async () => {
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

    it('dovrebbe bufferare se channel non inizializzato', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = await freshLogger();
      // Non chiamo initLogger — il messaggio va nel buffer
      logger.logInfo('buffered message');
      expect(spy).toHaveBeenCalled();
      // Ora init
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
    it('dovrebbe scrivere nel channel con prefisso WARN', async () => {
      const logger = await freshLogger();
      const channel = { appendLine: vi.fn(), dispose: vi.fn() };
      logger.initLogger(channel as any);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      logger.logWarn('attenzione');
      const lastCall = channel.appendLine.mock.calls.at(-1)?.[0] as string;
      expect(lastCall).toContain('WARN');
      expect(lastCall).toContain('attenzione');
    });

    it('dovrebbe loggare su console.warn', async () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logger = await freshLogger();
      const channel = { appendLine: vi.fn(), dispose: vi.fn() };
      logger.initLogger(channel as any);
      logger.logWarn('warn test');
      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls.at(-1)?.[0]).toContain('warn test');
      spy.mockRestore();
    });

    it('dovrebbe passare argomenti extra a console.warn', async () => {
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
    it('dovrebbe scrivere nel channel con prefisso ERROR', async () => {
      const logger = await freshLogger();
      const channel = { appendLine: vi.fn(), dispose: vi.fn() };
      logger.initLogger(channel as any);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.logError('errore');
      const lastCall = channel.appendLine.mock.calls.at(-1)?.[0] as string;
      expect(lastCall).toContain('ERROR');
      expect(lastCall).toContain('errore');
    });

    it('dovrebbe loggare su console.error', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logger = await freshLogger();
      const channel = { appendLine: vi.fn(), dispose: vi.fn() };
      logger.initLogger(channel as any);
      logger.logError('error test');
      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls.at(-1)?.[0]).toContain('error test');
      spy.mockRestore();
    });

    it('dovrebbe passare argomenti extra a console.error', async () => {
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
  // Buffer pre-init multiplo
  // --------------------------------------------------------------------------
  describe('Buffer pre-init', () => {
    it('dovrebbe bufferare messaggi multipli e flusharli in ordine', async () => {
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
