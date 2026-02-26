import { describe, it, expect } from 'vitest';
import { parse, parseOrThrow } from '../../src/parsers/jsonParser.js';
import { OzCliError, OzCliErrorKind, AGENT_SKILL_MAP, DEFAULT_CONFIG } from '../../src/types/index.js';

// ==========================================================================
// parse<T>()
// ==========================================================================
describe('parse()', () => {
  // --- Happy path ---
  it('dovrebbe parsare un oggetto JSON valido', () => {
    const input = '{"id":"run-1","status":"SUCCEEDED"}';
    const result = parse<{ id: string; status: string }>(input);
    expect(result.parsed).toEqual({ id: 'run-1', status: 'SUCCEEDED' });
    expect(result.rawText).toBe(input);
  });

  it('dovrebbe parsare un array JSON valido', () => {
    const input = '[{"id":"a"},{"id":"b"}]';
    const result = parse<Array<{ id: string }>>(input);
    expect(result.parsed).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('dovrebbe parsare JSON con whitespace', () => {
    const input = '  \n  {"key": "value"}  \n  ';
    const result = parse<{ key: string }>(input);
    expect(result.parsed).toEqual({ key: 'value' });
  });

  // --- Boundary values ---
  it('dovrebbe tornare null per stringa vuota', () => {
    const result = parse<unknown>('');
    expect(result.parsed).toBeNull();
    expect(result.rawText).toBe('');
  });

  it('dovrebbe tornare null per solo whitespace', () => {
    const result = parse<unknown>('   \n  \t  ');
    expect(result.parsed).toBeNull();
    expect(result.rawText).toBe('');
  });

  it('dovrebbe gestire JSON numerico primitivo', () => {
    const result = parse<number>('42');
    expect(result.parsed).toBe(42);
  });

  it('dovrebbe gestire stringa JSON', () => {
    const result = parse<string>('"hello"');
    expect(result.parsed).toBe('hello');
  });

  it('dovrebbe gestire null JSON', () => {
    const result = parse<null>('null');
    expect(result.parsed).toBeNull();
  });

  it('dovrebbe gestire boolean JSON', () => {
    expect(parse<boolean>('true').parsed).toBe(true);
    expect(parse<boolean>('false').parsed).toBe(false);
  });

  // --- Caso 3: JSON nella riga singola (embedded in testo) ---
  it('dovrebbe trovare JSON in output multi-riga (riga singola)', () => {
    const input = 'Some log output\n{"id":"run-2","status":"FAILED"}\nMore text';
    const result = parse<{ id: string; status: string }>(input);
    expect(result.parsed).toEqual({ id: 'run-2', status: 'FAILED' });
    expect(result.rawText).toBe(input);
  });

  it('dovrebbe trovare array JSON in output multi-riga', () => {
    const input = 'Header\n[{"id":"a"}]\nFooter';
    const result = parse<Array<{ id: string }>>(input);
    expect(result.parsed).toEqual([{ id: 'a' }]);
  });

  // --- Caso 4: blocco JSON multi-riga (non su singola riga) ---
  it('dovrebbe trovare blocco JSON multi-riga', () => {
    const input = 'Prefix line\n{\n  "key": "value",\n  "num": 42\n}\nSuffix line';
    const result = parse<{ key: string; num: number }>(input);
    expect(result.parsed).toEqual({ key: 'value', num: 42 });
  });

  it('dovrebbe trovare blocco array JSON multi-riga', () => {
    const input = 'Log start\n[\n  {"id": 1},\n  {"id": 2}\n]\nDone';
    const result = parse<Array<{ id: number }>>(input);
    expect(result.parsed).toEqual([{ id: 1 }, { id: 2 }]);
  });

  // --- Caso 5: non è JSON ---
  it('dovrebbe tornare null per testo puro', () => {
    const input = 'No runs found.';
    const result = parse<unknown>(input);
    expect(result.parsed).toBeNull();
    expect(result.rawText).toBe(input);
  });

  it('dovrebbe tornare null per testo con parentesi non-JSON', () => {
    const input = 'function foo() { return bar; }';
    const result = parse<unknown>(input);
    // Il parser prova a parsare { return bar; } ma fallisce → null
    expect(result.parsed).toBeNull();
    expect(result.rawText).toBe(input);
  });

  // --- Fallback: caso 3 (multi-riga) fallisce → caso 4 (singola riga) riesce ---
  it('dovrebbe fallback a case 4 (riga singola) se case 3 (blocco multi-riga) fallisce', () => {
    // Il blocco multi-riga dalla prima { all'ultima } non è JSON valido,
    // ma una riga singola interna contiene JSON valido
    const input = 'prefix { invalid json }\n{"valid":true}\nextra { garbage }';
    const result = parse<{ valid: boolean }>(input);
    expect(result.parsed).toEqual({ valid: true });
  });

  // --- Edge cases ---
  it('dovrebbe gestire oggetto JSON annidato profondamente', () => {
    const nested = { a: { b: { c: { d: 'deep' } } } };
    const result = parse<typeof nested>(JSON.stringify(nested));
    expect(result.parsed).toEqual(nested);
  });

  it('dovrebbe gestire array vuoto', () => {
    const result = parse<unknown[]>('[]');
    expect(result.parsed).toEqual([]);
  });

  it('dovrebbe gestire oggetto vuoto', () => {
    const result = parse<Record<string, never>>('{}');
    expect(result.parsed).toEqual({});
  });

  it('dovrebbe preservare rawText come stringa originale trimmata', () => {
    const input = '  hello world  ';
    const result = parse<unknown>(input);
    expect(result.rawText).toBe('hello world');
  });
});

// ==========================================================================
// parseOrThrow<T>()
// ==========================================================================
describe('parseOrThrow()', () => {
  it('dovrebbe ritornare il valore parsato per JSON valido', () => {
    const result = parseOrThrow<{ id: string }>('{"id":"x"}', 'test context');
    expect(result).toEqual({ id: 'x' });
  });

  it('dovrebbe lanciare OzCliError per input non-JSON', () => {
    expect(() => parseOrThrow<unknown>('Not JSON', 'test'))
      .toThrow(OzCliError);
  });

  it('dovrebbe lanciare con kind PARSE_ERROR', () => {
    try {
      parseOrThrow<unknown>('bad', 'my context');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(OzCliError);
      expect((err as OzCliError).kind).toBe(OzCliErrorKind.PARSE_ERROR);
    }
  });

  it('dovrebbe includere il contesto nel messaggio di errore', () => {
    try {
      parseOrThrow<unknown>('not json', 'modelList');
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as OzCliError).message).toContain('modelList');
    }
  });

  it('dovrebbe troncare rawText nel messaggio se molto lungo', () => {
    const longText = 'a'.repeat(500);
    try {
      parseOrThrow<unknown>(longText, 'ctx');
      expect.fail('should have thrown');
    } catch (err) {
      // Il messaggio mostra solo i primi 200 caratteri di rawText
      expect((err as OzCliError).message.length).toBeLessThan(longText.length);
    }
  });

  it('dovrebbe lanciare per stringa vuota', () => {
    expect(() => parseOrThrow<unknown>('', 'ctx')).toThrow(OzCliError);
  });
});

// ==========================================================================
// OzCliError (types)
// ==========================================================================
describe('OzCliError', () => {
  it('dovrebbe avere name "CliError"', () => {
    const err = new OzCliError(OzCliErrorKind.CLI_ERROR, 'test');
    expect(err.name).toBe('CliError');
  });

  it('dovrebbe preservare kind, message, exitCode, stderr', () => {
    const err = new OzCliError(OzCliErrorKind.NOT_FOUND, 'not found', 127, 'stderr output');
    expect(err.kind).toBe(OzCliErrorKind.NOT_FOUND);
    expect(err.message).toBe('not found');
    expect(err.exitCode).toBe(127);
    expect(err.stderr).toBe('stderr output');
  });

  it('dovrebbe estendere Error', () => {
    const err = new OzCliError(OzCliErrorKind.TIMEOUT, 'timeout');
    expect(err).toBeInstanceOf(Error);
  });

  it('dovrebbe avere exitCode opzionale undefined', () => {
    const err = new OzCliError(OzCliErrorKind.CANCELLED, 'cancelled');
    expect(err.exitCode).toBeUndefined();
    expect(err.stderr).toBeUndefined();
  });
});

// ==========================================================================
// AGENT_SKILL_MAP (types)
// ==========================================================================
describe('AGENT_SKILL_MAP', () => {
  it('dovrebbe contenere 7 agent skill', () => {
    expect(Object.keys(AGENT_SKILL_MAP)).toHaveLength(7);
  });

  it('dovrebbe mappare spec → 1-spec-agent', () => {
    expect(AGENT_SKILL_MAP['spec']).toBe('1-spec-agent');
  });

  it('dovrebbe mappare tutti i numeri da 1 a 7', () => {
    const values = Object.values(AGENT_SKILL_MAP);
    for (let i = 1; i <= 7; i++) {
      expect(values.some(v => v.startsWith(`${i}-`))).toBe(true);
    }
  });

  it('dovrebbe mappare ogni chiave al corretto skill', () => {
    expect(AGENT_SKILL_MAP['design']).toBe('2-design-agent');
    expect(AGENT_SKILL_MAP['implement']).toBe('3-implement-agent');
    expect(AGENT_SKILL_MAP['review']).toBe('4-review-agent');
    expect(AGENT_SKILL_MAP['test']).toBe('5-test-agent');
    expect(AGENT_SKILL_MAP['deploy']).toBe('6-deploy-agent');
    expect(AGENT_SKILL_MAP['maintenance']).toBe('7-maintenance-agent');
  });
});

// ==========================================================================
// DEFAULT_CONFIG — valori di default
// ==========================================================================
describe('DEFAULT_CONFIG', () => {
  it('dovrebbe avere tutti i campi con i valori corretti', () => {
    expect(DEFAULT_CONFIG.ozPath).toBe('oz');
    expect(DEFAULT_CONFIG.defaultModel).toBe('auto');
    expect(DEFAULT_CONFIG.defaultProfile).toBe('Default');
    expect(DEFAULT_CONFIG.defaultEnvironment).toBe('');
    expect(DEFAULT_CONFIG.cloudPollingIntervalMs).toBe(5_000);
    expect(DEFAULT_CONFIG.cloudPollingTimeoutMs).toBe(1_800_000);
    expect(DEFAULT_CONFIG.timeoutMs).toBe(300_000);
    expect(DEFAULT_CONFIG.maxOutputChars).toBe(5_000);
  });
});
