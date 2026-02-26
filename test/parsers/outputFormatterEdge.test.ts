/**
 * Test approfonditi per OutputFormatter — edge case e copertura completa di formatError,
 * formatRunResult, formatList, truncate.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OutputFormatter } from '../../src/parsers/outputFormatter.js';
import { OzCliError, OzCliErrorKind, OzRunResult } from '../../src/types/index.js';
import { createMockStream, createMockConfigManager, makeRunResult, makeListResult } from '../helpers.js';
import { initI18n, _resetI18n } from '../../src/core/i18n.js';

let formatter: OutputFormatter;
let mock: ReturnType<typeof createMockStream>;

beforeEach(() => {
  mock = createMockStream();
  initI18n('it');
  formatter = new OutputFormatter(createMockConfigManager());
});

afterEach(() => {
  _resetI18n();
});

// ============================================================================
// formatRunResult — edge case aggiuntivi
// ============================================================================
describe('formatRunResult() — edge case', () => {
  it('dovrebbe mostrare sia header che runId e durata insieme', () => {
    const result = makeRunResult({ runId: 'run-abc', durationMs: 12345 });
    formatter.formatRunResult(result, mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('✅');
    expect(out).toContain('run-abc');
    expect(out).toContain('12.3');
    expect(mock.buttons.length).toBe(1);
    expect(mock.buttons[0].title).toContain('browser');
  });

  it('dovrebbe mostrare run FAILED senza runId e senza durata', () => {
    const result = makeRunResult({ status: 'FAILED', runId: null, durationMs: 0, output: '' });
    formatter.formatRunResult(result, mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('❌');
    expect(out).toContain('FAILED');
    expect(out).not.toContain('Run ID');
    expect(out).not.toContain('Durata');
    expect(mock.buttons).toHaveLength(0);
  });

  it('dovrebbe gestire status QUEUED', () => {
    const result = makeRunResult({ status: 'QUEUED' });
    formatter.formatRunResult(result, mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('QUEUED');
  });

  it('dovrebbe gestire status INPROGRESS', () => {
    const result = makeRunResult({ status: 'INPROGRESS' });
    formatter.formatRunResult(result, mock.stream as any);
    expect(mock.getFullOutput()).toContain('INPROGRESS');
  });

  it('dovrebbe gestire status UNKNOWN', () => {
    const result = makeRunResult({ status: 'UNKNOWN' });
    formatter.formatRunResult(result, mock.stream as any);
    expect(mock.getFullOutput()).toContain('UNKNOWN');
  });

  it('dovrebbe troncare output lungo e mostrare indicatore', () => {
    const longOutput = 'x'.repeat(6000);
    const cfgMgr = createMockConfigManager({ maxOutputChars: 100 });
    const fmt = new OutputFormatter(cfgMgr);
    const result = makeRunResult({ output: longOutput });
    fmt.formatRunResult(result, mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('troncato');
    expect(out).toContain('rimanenti');
    expect(out.length).toBeLessThan(longOutput.length);
  });

  it('dovrebbe non troncare output corto', () => {
    const cfgMgr = createMockConfigManager({ maxOutputChars: 10000 });
    const fmt = new OutputFormatter(cfgMgr);
    const result = makeRunResult({ output: 'short output' });
    fmt.formatRunResult(result, mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('short output');
    expect(out).not.toContain('troncato');
  });

  it('dovrebbe non renderizzare output se è undefined/stringa vuota', () => {
    const result = makeRunResult({ output: '' });
    formatter.formatRunResult(result, mock.stream as any);
    expect(mock.getFullOutput()).not.toContain('---');
  });

  it('dovrebbe mostrare durata con precisione 1 decimale', () => {
    const result = makeRunResult({ durationMs: 1550 });
    formatter.formatRunResult(result, mock.stream as any);
    expect(mock.getFullOutput()).toContain('1.6');
  });
});

// ============================================================================
// formatList — edge case aggiuntivi
// ============================================================================
describe('formatList() — edge case', () => {
  it('dovrebbe gestire un singolo elemento', () => {
    const list = makeListResult([{ name: 'alpha', status: 'active' }]);
    formatter.formatList(list, ['name', 'status'], mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('name');
    expect(out).toContain('status');
    expect(out).toContain('alpha');
    expect(out).toContain('active');
  });

  it('dovrebbe gestire molti elementi', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `id-${i}`, val: `v${i}` }));
    const list = makeListResult(items);
    formatter.formatList(list, ['id', 'val'], mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('id-0');
    expect(out).toContain('id-19');
    expect((out.match(/\|/g) ?? []).length).toBeGreaterThan(40);
  });

  it('dovrebbe gestire colonne con valori undefined usando stringa vuota', () => {
    const list = makeListResult([{ a: 1 } as any]);
    formatter.formatList(list, ['a', 'missing' as any], mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('1');
    expect(out).toContain('|  |'); // colonna missing = vuota (spazio padding)
  });

  it('dovrebbe mostrare rawText se lista vuota con rawText', () => {
    const list = makeListResult([], 'No items available.');
    formatter.formatList(list, ['id'], mock.stream as any);
    expect(mock.getFullOutput()).toContain('No items available.');
  });

  it('dovrebbe mostrare placeholder generico se lista vuota senza rawText', () => {
    const list = makeListResult([]);
    formatter.formatList(list, ['id'], mock.stream as any);
    expect(mock.getFullOutput()).toContain('Nessun elemento');
  });
});

// ============================================================================
// formatError — copertura aggiuntiva
// ============================================================================
describe('formatError() — copertura aggiuntiva', () => {
  it('NOT_FOUND: button dovrebbe aprire URL warp.dev', () => {
    const err = new OzCliError(OzCliErrorKind.NOT_FOUND, 'not found');
    formatter.formatError(err, mock.stream as any);
    expect(mock.buttons.length).toBe(1);
    const btnUrl = String(mock.buttons[0].arguments?.[0] ?? '');
    expect(btnUrl).toContain('warp.dev');
  });

  it('NOT_AUTHENTICATED: button dovrebbe aprire app.warp.dev', () => {
    const err = new OzCliError(OzCliErrorKind.NOT_AUTHENTICATED, 'unauthorized');
    formatter.formatError(err, mock.stream as any);
    expect(mock.buttons.length).toBe(1);
    const btnUrl = String(mock.buttons[0].arguments?.[0] ?? '');
    expect(btnUrl).toContain('app.warp.dev');
  });

  it('TIMEOUT: dovrebbe menzionare il timeout configurato in secondi', () => {
    const cfgMgr = createMockConfigManager({ timeoutMs: 60000 });
    const fmt = new OutputFormatter(cfgMgr);
    const err = new OzCliError(OzCliErrorKind.TIMEOUT, 'timeout');
    fmt.formatError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('60');
  });

  it('CLI_ERROR senza stderr: dovrebbe mostrare solo message', () => {
    const err = new OzCliError(OzCliErrorKind.CLI_ERROR, 'generic error', 2);
    formatter.formatError(err, mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('generic error');
    expect(out).toContain('2');
    expect(out).not.toContain('stderr');
  });

  it('CLI_ERROR con stderr lungo: dovrebbe troncare stderr a 500 chars', () => {
    const longStderr = 'E'.repeat(1000);
    const err = new OzCliError(OzCliErrorKind.CLI_ERROR, 'fail', 1, longStderr);
    formatter.formatError(err, mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('stderr');
    // La stringa stderr nel markdown non dovrebbe contenere l'intero stdout
    expect(out.length).toBeLessThan(longStderr.length + 500);
  });

  it('CLI_ERROR senza exitCode: dovrebbe mostrare "?"', () => {
    const err = new OzCliError(OzCliErrorKind.CLI_ERROR, 'bad');
    formatter.formatError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('?');
  });

  it('CANCELLED: dovrebbe non mostrare button', () => {
    const err = new OzCliError(OzCliErrorKind.CANCELLED, 'user cancel');
    formatter.formatError(err, mock.stream as any);
    expect(mock.buttons).toHaveLength(0);
  });

  it('PARSE_ERROR con stderr: dovrebbe mostrare stderr nel blocco di codice', () => {
    const err = new OzCliError(OzCliErrorKind.PARSE_ERROR, 'bad json', 0, 'unexpected < at 0');
    formatter.formatError(err, mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('unexpected < at 0');
    expect(out).toContain('```');
  });
});
