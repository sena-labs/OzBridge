import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OutputFormatter } from '../../src/parsers/outputFormatter.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';
import { createMockStream, createMockConfigManager, makeRunResult, makeListResult } from '../helpers.js';
import { initI18n, _resetI18n } from '../../src/core/i18n.js';

let formatter: OutputFormatter;
let mock: ReturnType<typeof createMockStream>;

beforeEach(() => {
  vi.clearAllMocks();
  initI18n('it');
  formatter = new OutputFormatter(createMockConfigManager());
  mock = createMockStream();
});

afterEach(() => {
  _resetI18n();
});

// ==========================================================================
// formatRunResult()
// ==========================================================================
describe('formatRunResult()', () => {
  it('dovrebbe mostrare icona ✅ per run SUCCEEDED', () => {
    formatter.formatRunResult(makeRunResult({ status: 'SUCCEEDED' }), mock.stream as any);
    expect(mock.getFullOutput()).toContain('✅');
    expect(mock.getFullOutput()).toContain('SUCCEEDED');
  });

  it('dovrebbe mostrare icona ❌ per run FAILED', () => {
    formatter.formatRunResult(makeRunResult({ status: 'FAILED' }), mock.stream as any);
    expect(mock.getFullOutput()).toContain('❌');
    expect(mock.getFullOutput()).toContain('FAILED');
  });

  it('dovrebbe mostrare Run ID se presente', () => {
    formatter.formatRunResult(makeRunResult({ runId: 'abc-123' }), mock.stream as any);
    expect(mock.getFullOutput()).toContain('abc-123');
  });

  it('dovrebbe omettere Run ID se null', () => {
    formatter.formatRunResult(makeRunResult({ runId: null }), mock.stream as any);
    expect(mock.getFullOutput()).not.toContain('Run ID');
  });

  it('dovrebbe mostrare durata in secondi', () => {
    formatter.formatRunResult(makeRunResult({ durationMs: 3500 }), mock.stream as any);
    expect(mock.getFullOutput()).toContain('3.5s');
  });

  it('dovrebbe non mostrare durata se 0', () => {
    formatter.formatRunResult(makeRunResult({ durationMs: 0 }), mock.stream as any);
    expect(mock.getFullOutput()).not.toContain('⏱️');
  });

  it('dovrebbe mostrare output agente', () => {
    formatter.formatRunResult(makeRunResult({ output: 'Agent result text' }), mock.stream as any);
    expect(mock.getFullOutput()).toContain('Agent result text');
  });

  it('dovrebbe aggiungere button web se runId presente (senza autoOpened)', () => {
    formatter.formatRunResult(makeRunResult({ runId: 'xyz' }), mock.stream as any);
    expect(mock.buttons).toHaveLength(1);
    expect(mock.buttons[0].title).toContain('browser');
    // URL di fallback usa /session/ con runId
    expect(mock.buttons[0].arguments![0].toString()).toContain('/session/xyz');
  });

  it('dovrebbe non mostrare bottoni se autoOpened è true (Warp aperto via --open)', () => {
    formatter.formatRunResult(makeRunResult({ runId: 'conv-123' }), mock.stream as any, { autoOpened: true });
    expect(mock.buttons).toHaveLength(0);
  });

  it('dovrebbe non mostrare bottoni se local è true (run locale)', () => {
    formatter.formatRunResult(makeRunResult({ runId: 'local-conv-id' }), mock.stream as any, { local: true });
    expect(mock.buttons).toHaveLength(0);
  });

  it('dovrebbe estrarre session URL dall\' output se presente', () => {
    const result = makeRunResult({
      runId: 'abc',
      output: 'Spawned agent\nView agent session: https://app.warp.dev/session/e84b70c3-b2fa-4c8e-8d51-afc319898bb1',
    });
    formatter.formatRunResult(result, mock.stream as any);
    expect(mock.buttons).toHaveLength(1);
    expect(mock.buttons[0].arguments![0].toString()).toContain('/session/e84b70c3-b2fa-4c8e-8d51-afc319898bb1');
  });

  it('dovrebbe non aggiungere button se runId null', () => {
    formatter.formatRunResult(makeRunResult({ runId: null }), mock.stream as any);
    expect(mock.buttons).toHaveLength(0);
  });

  // Gap: output vuoto (stringa falsy) → blocco output saltato
  it('dovrebbe non mostrare blocco output se output è stringa vuota', () => {
    formatter.formatRunResult(makeRunResult({ output: '' }), mock.stream as any);
    const output = mock.getFullOutput();
    // Non deve contenere il separatore ---\n che precede l'output
    expect(output).not.toContain('---');
  });

  // --- Truncation ---
  it('dovrebbe troncare output che supera maxOutputChars', () => {
    const longOutput = 'x'.repeat(10_000);
    formatter.formatRunResult(makeRunResult({ output: longOutput }), mock.stream as any);
    const full = mock.getFullOutput();
    expect(full).toContain('troncato');
    // Output totale deve essere significativamente più corto dell'input
    expect(full.length).toBeLessThan(longOutput.length);
  });

  it('dovrebbe non troncare output entro il limite', () => {
    const shortOutput = 'x'.repeat(100);
    formatter.formatRunResult(makeRunResult({ output: shortOutput }), mock.stream as any);
    expect(mock.getFullOutput()).not.toContain('troncato');
  });
});

// ==========================================================================
// formatList()
// ==========================================================================
describe('formatList()', () => {
  it('dovrebbe mostrare messaggio per lista vuota', () => {
    formatter.formatList(makeListResult([]), ['id'], mock.stream as any);
    expect(mock.getFullOutput()).toContain('Nessun elemento');
  });

  it('dovrebbe mostrare rawText per lista vuota con rawText', () => {
    formatter.formatList(makeListResult([], 'No runs found.'), ['id'], mock.stream as any);
    expect(mock.getFullOutput()).toContain('No runs found.');
  });

  it('dovrebbe renderizzare una tabella markdown con header e righe', () => {
    const items = [
      { id: 'run-1', status: 'SUCCEEDED' },
      { id: 'run-2', status: 'FAILED' },
    ];
    formatter.formatList(makeListResult(items), ['id', 'status'], mock.stream as any);
    const output = mock.getFullOutput();
    expect(output).toContain('| id | status |');
    expect(output).toContain('| --- | --- |');
    expect(output).toContain('run-1');
    expect(output).toContain('run-2');
    expect(output).toContain('SUCCEEDED');
  });

  it('dovrebbe gestire colonne mancanti con stringa vuota', () => {
    const items = [{ id: 'x' }];
    formatter.formatList(makeListResult(items), ['id', 'name' as any], mock.stream as any);
    const output = mock.getFullOutput();
    expect(output).toContain('| x |');
  });
});

// ==========================================================================
// formatError()
// ==========================================================================
describe('formatError()', () => {
  it('dovrebbe mostrare messaggio NOT_FOUND con button install', () => {
    const err = new OzCliError(OzCliErrorKind.NOT_FOUND, 'not found');
    formatter.formatError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('non trovato');
    expect(mock.buttons.length).toBeGreaterThanOrEqual(1);
    expect(mock.buttons[0].title).toContain('Installa');
  });

  it('dovrebbe mostrare messaggio NOT_AUTHENTICATED con button login', () => {
    const err = new OzCliError(OzCliErrorKind.NOT_AUTHENTICATED, 'not logged in');
    formatter.formatError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('autenticato');
    expect(mock.buttons.length).toBeGreaterThanOrEqual(1);
    expect(mock.buttons[0].title).toContain('Login');
  });

  it('dovrebbe mostrare messaggio TIMEOUT con suggerimento settings', () => {
    const err = new OzCliError(OzCliErrorKind.TIMEOUT, 'timed out');
    formatter.formatError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('Timeout');
  });

  it('dovrebbe mostrare messaggio CANCELLED', () => {
    const err = new OzCliError(OzCliErrorKind.CANCELLED, 'cancelled');
    formatter.formatError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('annullata');
  });

  it('dovrebbe mostrare messaggio PARSE_ERROR con dettaglio', () => {
    const err = new OzCliError(OzCliErrorKind.PARSE_ERROR, 'bad json', 0, 'stderr data');
    formatter.formatError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('parsing');
    expect(mock.getFullOutput()).toContain('stderr data');
  });

  // Gap: PARSE_ERROR senza stderr → fallback a error.message
  it('dovrebbe fallback a message se PARSE_ERROR senza stderr', () => {
    const err = new OzCliError(OzCliErrorKind.PARSE_ERROR, 'unexpected token at col 5');
    formatter.formatError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('parsing');
    expect(mock.getFullOutput()).toContain('unexpected token at col 5');
  });

  it('dovrebbe mostrare messaggio CLI_ERROR generico con exit code', () => {
    const err = new OzCliError(OzCliErrorKind.CLI_ERROR, 'something failed', 1, 'err output');
    formatter.formatError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('Errore CLI');
    expect(mock.getFullOutput()).toContain('1');
  });

  it('dovrebbe gestire CLI_ERROR senza stderr', () => {
    const err = new OzCliError(OzCliErrorKind.CLI_ERROR, 'fail');
    formatter.formatError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('fail');
  });
});

// ==========================================================================
// handleError()
// ==========================================================================
describe('handleError()', () => {
  it('dovrebbe delegare OzCliError a formatError', () => {
    const err = new OzCliError(OzCliErrorKind.NOT_FOUND, 'not found');
    formatter.handleError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('non trovato');
    expect(mock.buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('dovrebbe formattare Error generico con messaggio', () => {
    formatter.handleError(new Error('something broke'), mock.stream as any);
    expect(mock.getFullOutput()).toContain('something broke');
  });

  it('dovrebbe formattare stringa plain come errore', () => {
    formatter.handleError('raw string error', mock.stream as any);
    expect(mock.getFullOutput()).toContain('raw string error');
  });

  // Edge case: null / undefined / numerico
  it('dovrebbe gestire null senza crash', () => {
    expect(() => formatter.handleError(null, mock.stream as any)).not.toThrow();
    expect(mock.getFullOutput()).toContain('null');
  });

  it('dovrebbe gestire undefined senza crash', () => {
    expect(() => formatter.handleError(undefined, mock.stream as any)).not.toThrow();
    expect(mock.getFullOutput()).toContain('undefined');
  });

  it('dovrebbe gestire errore numerico (throw 42)', () => {
    formatter.handleError(42, mock.stream as any);
    expect(mock.getFullOutput()).toContain('42');
  });

  it('dovrebbe delegare OzCliError TIMEOUT a formatError', () => {
    const err = new OzCliError(OzCliErrorKind.TIMEOUT, 'timed out');
    formatter.handleError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('Timeout');
  });
});
