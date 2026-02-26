
/**
 * Test ad alta densità per jsonParser — edge case avanzati su tutti e 5 i livelli
 * di strategia di parsing, parseOrThrow, e robustezza su input reali.
 */
import { describe, it, expect } from 'vitest';
import { parse, parseOrThrow } from '../../src/parsers/jsonParser.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';

// ============================================================================
// parse() — Caso 1: input vuoto
// ============================================================================
describe('parse() — input vuoto', () => {
  it('stringa vuota → parsed null, rawText vuoto', () => {
    const r = parse('');
    expect(r.parsed).toBeNull();
    expect(r.rawText).toBe('');
  });

  it('solo spazi → parsed null, rawText vuoto', () => {
    const r = parse('   ');
    expect(r.parsed).toBeNull();
    expect(r.rawText).toBe('');
  });

  it('solo newline → parsed null', () => {
    const r = parse('\n\n\n');
    expect(r.parsed).toBeNull();
    expect(r.rawText).toBe('');
  });

  it('solo tab e \\r\\n → parsed null', () => {
    const r = parse('\t\r\n\t\r\n');
    expect(r.parsed).toBeNull();
    expect(r.rawText).toBe('');
  });
});

// ============================================================================
// parse() — Caso 2: JSON diretto
// ============================================================================
describe('parse() — JSON diretto', () => {
  it('object semplice', () => {
    const r = parse<{ a: number }>('{"a":1}');
    expect(r.parsed).not.toBeNull();
    expect(r.parsed!.a).toBe(1);
    expect(r.rawText).toBe('{"a":1}');
  });

  it('array semplice', () => {
    const r = parse<number[]>('[1,2,3]');
    expect(r.parsed).not.toBeNull();
    expect(r.parsed).toEqual([1, 2, 3]);
    expect(r.parsed!.length).toBe(3);
  });

  it('stringa JSON (literal)', () => {
    const r = parse<string>('"hello"');
    expect(r.parsed).toBe('hello');
  });

  it('numero JSON', () => {
    const r = parse<number>('42');
    expect(r.parsed).toBe(42);
  });

  it('boolean true', () => {
    const r = parse<boolean>('true');
    expect(r.parsed).toBe(true);
  });

  it('null JSON', () => {
    const r = parse<null>('null');
    expect(r.parsed).toBeNull();
  });

  it('JSON con spazi attorno', () => {
    const r = parse<{ x: string }>('  {"x":"y"}  ');
    expect(r.parsed).not.toBeNull();
    expect(r.parsed!.x).toBe('y');
  });

  it('oggetto annidato profondo', () => {
    const input = '{"a":{"b":{"c":{"d":42}}}}';
    const r = parse<any>(input);
    expect(r.parsed).not.toBeNull();
    expect(r.parsed.a.b.c.d).toBe(42);
  });

  it('array di oggetti', () => {
    const input = '[{"id":1},{"id":2}]';
    const r = parse<Array<{ id: number }>>(input);
    expect(r.parsed).not.toBeNull();
    expect(r.parsed!.length).toBe(2);
    expect(r.parsed![0].id).toBe(1);
    expect(r.parsed![1].id).toBe(2);
  });
});

// ============================================================================
// parse() — Caso 3: blocco JSON multi-riga con prefisso testuale
// ============================================================================
describe('parse() — blocco JSON multi-riga', () => {
  it('testo + oggetto su più righe', () => {
    const input = 'Info: loading\n{\n  "status": "ok"\n}';
    const r = parse<{ status: string }>(input);
    expect(r.parsed).not.toBeNull();
    expect(r.parsed!.status).toBe('ok');
  });

  it('testo + array su più righe', () => {
    const input = 'List:\n[\n  1,\n  2\n]';
    const r = parse<number[]>(input);
    expect(r.parsed).not.toBeNull();
    expect(r.parsed).toEqual([1, 2]);
  });

  it('prefisso e suffisso non-JSON', () => {
    const input = 'Prefix\n{"key":"val"}\nSuffix';
    const r = parse<{ key: string }>(input);
    expect(r.parsed).not.toBeNull();
    expect(r.parsed!.key).toBe('val');
  });

  it('output multilinea con warning prima del JSON', () => {
    const input = 'WARNING: deprecated flag --old\n\n{"results":[{"name":"a"}]}';
    const r = parse<{ results: Array<{ name: string }> }>(input);
    expect(r.parsed).not.toBeNull();
    expect(r.parsed!.results).toHaveLength(1);
    expect(r.parsed!.results[0].name).toBe('a');
  });
});

// ============================================================================
// parse() — Caso 4: JSON su una singola riga in mezzo a testo
// ============================================================================
describe('parse() — single-line JSON embeddato', () => {
  it('riga JSON in mezzo a testo non-JSON', () => {
    const input = 'line 1\n{"x":99}\nline 3';
    const r = parse<{ x: number }>(input);
    expect(r.parsed).not.toBeNull();
    expect(r.parsed!.x).toBe(99);
  });

  it('più righe JSON — prende la prima valida via caso 3 (multi-riga)', () => {
    const input = '{"a":1}\n{"b":2}';
    // Caso 2 (parse diretto) fallisce su stringa multi-oggetto (JSON invalido).
    // Caso 3 cerca da prima { a ultima } → cattura tutto "{"a":1}\n{"b":2}"
    // che NON è JSON valido. Poi caso 4: prima riga singola {"a":1} → parse OK.
    const r = parse<{ a?: number; b?: number }>(input);
    expect(r.parsed).not.toBeNull();
    // Il risultato è {"a":1} perché caso 4 trova la prima riga JSON valida
    expect(r.parsed!.a).toBe(1);
  });

  // Gap: riga che sembra JSON (inizia con { e finisce con }) ma non è parsabile
  it('riga pseudo-JSON che fallisce il parse → continue al prossimo tentativo', () => {
    // La prima riga matcha la condizione startsWith('{') && endsWith('}') ma
    // JSON.parse fallirà → il catch esegue continue → poi prova la seconda riga
    const input = '{not valid json}\n{"valid":true}';
    const r = parse<{ valid: boolean }>(input);
    expect(r.parsed).not.toBeNull();
    expect(r.parsed!.valid).toBe(true);
  });

  it('array pseudo-JSON che fallisce il parse → continue al prossimo', () => {
    const input = '[not an array]\n[1,2,3]';
    const r = parse<number[]>(input);
    expect(r.parsed).not.toBeNull();
    expect(r.parsed).toEqual([1, 2, 3]);
  });
});

// ============================================================================
// parse() — Caso 5: testo non-JSON
// ============================================================================
describe('parse() — testo non-JSON', () => {
  it('testo semplice → rawText', () => {
    const r = parse('No runs found.');
    expect(r.parsed).toBeNull();
    expect(r.rawText).toBe('No runs found.');
  });

  it('HTML → rawText', () => {
    const r = parse('<html><body>Error</body></html>');
    expect(r.parsed).toBeNull();
    expect(r.rawText).toContain('Error');
  });

  it('messaggio errore con { ma non JSON', () => {
    const r = parse('Error: missing } in block');
    expect(r.parsed).toBeNull();
    expect(r.rawText).toContain('Error');
  });

  it('JSON tronco → rawText', () => {
    const r = parse('{"incomplete":');
    expect(r.parsed).toBeNull();
    expect(r.rawText).toContain('incomplete');
  });

  it('array JSON tronco → rawText', () => {
    const r = parse('[1,2,');
    expect(r.parsed).toBeNull();
    expect(r.rawText).toBe('[1,2,');
  });
});

// ============================================================================
// parseOrThrow()
// ============================================================================
describe('parseOrThrow()', () => {
  it('JSON valido → ritorna il valore parsed', () => {
    const val = parseOrThrow<{ ok: boolean }>('{"ok":true}', 'test');
    expect(val).toEqual({ ok: true });
    expect(val.ok).toBe(true);
  });

  it('array valido → ritorna array', () => {
    const val = parseOrThrow<number[]>('[10,20]', 'arr');
    expect(val).toHaveLength(2);
    expect(val[0]).toBe(10);
    expect(val[1]).toBe(20);
  });

  it('testo non-JSON → lancia OzCliError PARSE_ERROR', () => {
    expect(() => parseOrThrow('not json', 'ctx'))
      .toThrowError();
  });

  it('errore lanciato è OzCliError con kind PARSE_ERROR', () => {
    try {
      parseOrThrow('bad output', 'myCmd');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(OzCliError);
      expect((e as OzCliError).kind).toBe(OzCliErrorKind.PARSE_ERROR);
      expect((e as OzCliError).message).toContain('myCmd');
      expect((e as OzCliError).message).toContain('bad output');
    }
  });

  it('stringa vuota → lancia OzCliError', () => {
    expect(() => parseOrThrow('', 'empty')).toThrowError();
  });

  it('messaggio errore include i primi 200 char del rawText', () => {
    const longText = 'A'.repeat(300);
    try {
      parseOrThrow(longText, 'long');
      expect.unreachable('should have thrown');
    } catch (e) {
      const msg = (e as OzCliError).message;
      expect(msg.length).toBeLessThan(longText.length);
      expect(msg).toContain('long');
    }
  });
});

// ============================================================================
// parse() — rawText è sempre la stringa originale trimmed
// ============================================================================
describe('parse() — rawText consistency', () => {
  it('rawText è sempre trimmed per JSON valido', () => {
    const r = parse('  {"a":1}  ');
    expect(r.rawText).toBe('{"a":1}');
  });

  it('rawText è sempre trimmed per testo non-JSON', () => {
    const r = parse('  hello  ');
    expect(r.rawText).toBe('hello');
  });

  it('rawText preserva newline interne', () => {
    const r = parse('line1\nline2');
    expect(r.rawText).toContain('\n');
    expect(r.rawText).toBe('line1\nline2');
  });
});
