
/**
 * High-density tests for jsonParser — advanced edge cases across all 5 levels
 * of the parsing strategy, parseOrThrow, and robustness on real inputs.
 */
import { describe, it, expect } from 'vitest';
import { parse, parseOrThrow } from '../../src/parsers/jsonParser.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';

// ============================================================================
// parse() — Case 1: empty input
// ============================================================================
describe('parse() — empty input', () => {
  it('empty string → parsed null, empty rawText', () => {
    const r = parse('');
    expect(r.parsed).toBeNull();
    expect(r.rawText).toBe('');
  });

  it('spaces only → parsed null, empty rawText', () => {
    const r = parse('   ');
    expect(r.parsed).toBeNull();
    expect(r.rawText).toBe('');
  });

  it('newlines only → parsed null', () => {
    const r = parse('\n\n\n');
    expect(r.parsed).toBeNull();
    expect(r.rawText).toBe('');
  });

  it('tabs and \\r\\n only → parsed null', () => {
    const r = parse('\t\r\n\t\r\n');
    expect(r.parsed).toBeNull();
    expect(r.rawText).toBe('');
  });
});

// ============================================================================
// parse() — Case 2: direct JSON
// ============================================================================
describe('parse() — direct JSON', () => {
  it('simple object', () => {
    const r = parse<{ a: number }>('{"a":1}');
    expect(r.parsed).not.toBeNull();
    expect(r.parsed!.a).toBe(1);
    expect(r.rawText).toBe('{"a":1}');
  });

  it('simple array', () => {
    const r = parse<number[]>('[1,2,3]');
    expect(r.parsed).not.toBeNull();
    expect(r.parsed).toEqual([1, 2, 3]);
    expect(r.parsed!.length).toBe(3);
  });

  it('JSON string (literal)', () => {
    const r = parse<string>('"hello"');
    expect(r.parsed).toBe('hello');
  });

  it('JSON number', () => {
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

  it('JSON surrounded by spaces', () => {
    const r = parse<{ x: string }>('  {"x":"y"}  ');
    expect(r.parsed).not.toBeNull();
    expect(r.parsed!.x).toBe('y');
  });

  it('deeply nested object', () => {
    const input = '{"a":{"b":{"c":{"d":42}}}}';
    const r = parse<any>(input);
    expect(r.parsed).not.toBeNull();
    expect(r.parsed.a.b.c.d).toBe(42);
  });

  it('array of objects', () => {
    const input = '[{"id":1},{"id":2}]';
    const r = parse<Array<{ id: number }>>(input);
    expect(r.parsed).not.toBeNull();
    expect(r.parsed!.length).toBe(2);
    expect(r.parsed![0].id).toBe(1);
    expect(r.parsed![1].id).toBe(2);
  });
});

// ============================================================================
// parse() — Case 3: multi-line JSON block with a text prefix
// ============================================================================
describe('parse() — multi-line JSON block', () => {
  it('text + object over multiple lines', () => {
    const input = 'Info: loading\n{\n  "status": "ok"\n}';
    const r = parse<{ status: string }>(input);
    expect(r.parsed).not.toBeNull();
    expect(r.parsed!.status).toBe('ok');
  });

  it('text + array over multiple lines', () => {
    const input = 'List:\n[\n  1,\n  2\n]';
    const r = parse<number[]>(input);
    expect(r.parsed).not.toBeNull();
    expect(r.parsed).toEqual([1, 2]);
  });

  it('non-JSON prefix and suffix', () => {
    const input = 'Prefix\n{"key":"val"}\nSuffix';
    const r = parse<{ key: string }>(input);
    expect(r.parsed).not.toBeNull();
    expect(r.parsed!.key).toBe('val');
  });

  it('multi-line output with a warning before the JSON', () => {
    const input = 'WARNING: deprecated flag --old\n\n{"results":[{"name":"a"}]}';
    const r = parse<{ results: Array<{ name: string }> }>(input);
    expect(r.parsed).not.toBeNull();
    expect(r.parsed!.results).toHaveLength(1);
    expect(r.parsed!.results[0].name).toBe('a');
  });
});

// ============================================================================
// parse() — Case 4: JSON on a single line in the middle of text
// ============================================================================
describe('parse() — embedded single-line JSON', () => {
  it('JSON line in the middle of non-JSON text', () => {
    const input = 'line 1\n{"x":99}\nline 3';
    const r = parse<{ x: number }>(input);
    expect(r.parsed).not.toBeNull();
    expect(r.parsed!.x).toBe(99);
  });

  it('multiple JSON lines — takes the first valid one via case 3 (multi-line)', () => {
    const input = '{"a":1}\n{"b":2}';
    // Case 2 (direct parse) fails on a multi-object string (invalid JSON).
    // Case 3 searches from the first { to the last } → captures all of "{"a":1}\n{"b":2}"
    // which is NOT valid JSON. Then case 4: first single line {"a":1} → parse OK.
    const r = parse<{ a?: number; b?: number }>(input);
    expect(r.parsed).not.toBeNull();
    // The result is {"a":1} because case 4 finds the first valid JSON line
    expect(r.parsed!.a).toBe(1);
  });

  // Gap: a line that looks like JSON (starts with { and ends with }) but cannot be parsed
  it('pseudo-JSON line that fails to parse → continue to the next attempt', () => {
    // The first line matches the condition startsWith('{') && endsWith('}') but
    // JSON.parse will fail → the catch runs continue → then it tries the second line
    const input = '{not valid json}\n{"valid":true}';
    const r = parse<{ valid: boolean }>(input);
    expect(r.parsed).not.toBeNull();
    expect(r.parsed!.valid).toBe(true);
  });

  it('pseudo-JSON array that fails to parse → continue to the next one', () => {
    const input = '[not an array]\n[1,2,3]';
    const r = parse<number[]>(input);
    expect(r.parsed).not.toBeNull();
    expect(r.parsed).toEqual([1, 2, 3]);
  });
});

// ============================================================================
// parse() — Case 5: non-JSON text
// ============================================================================
describe('parse() — non-JSON text', () => {
  it('plain text → rawText', () => {
    const r = parse('No runs found.');
    expect(r.parsed).toBeNull();
    expect(r.rawText).toBe('No runs found.');
  });

  it('HTML → rawText', () => {
    const r = parse('<html><body>Error</body></html>');
    expect(r.parsed).toBeNull();
    expect(r.rawText).toContain('Error');
  });

  it('error message with { but not JSON', () => {
    const r = parse('Error: missing } in block');
    expect(r.parsed).toBeNull();
    expect(r.rawText).toContain('Error');
  });

  it('truncated JSON → rawText', () => {
    const r = parse('{"incomplete":');
    expect(r.parsed).toBeNull();
    expect(r.rawText).toContain('incomplete');
  });

  it('truncated JSON array → rawText', () => {
    const r = parse('[1,2,');
    expect(r.parsed).toBeNull();
    expect(r.rawText).toBe('[1,2,');
  });
});

// ============================================================================
// parseOrThrow()
// ============================================================================
describe('parseOrThrow()', () => {
  it('valid JSON → returns the parsed value', () => {
    const val = parseOrThrow<{ ok: boolean }>('{"ok":true}', 'test');
    expect(val).toEqual({ ok: true });
    expect(val.ok).toBe(true);
  });

  it('valid array → returns the array', () => {
    const val = parseOrThrow<number[]>('[10,20]', 'arr');
    expect(val).toHaveLength(2);
    expect(val[0]).toBe(10);
    expect(val[1]).toBe(20);
  });

  it('non-JSON text → throws OzCliError PARSE_ERROR', () => {
    expect(() => parseOrThrow('not json', 'ctx'))
      .toThrowError();
  });

  it('thrown error is an OzCliError with kind PARSE_ERROR', () => {
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

  it('empty string → throws OzCliError', () => {
    expect(() => parseOrThrow('', 'empty')).toThrowError();
  });

  it('error message includes the first 200 chars of rawText', () => {
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
// parse() — rawText is always the trimmed original string
// ============================================================================
describe('parse() — rawText consistency', () => {
  it('rawText is always trimmed for valid JSON', () => {
    const r = parse('  {"a":1}  ');
    expect(r.rawText).toBe('{"a":1}');
  });

  it('rawText is always trimmed for non-JSON text', () => {
    const r = parse('  hello  ');
    expect(r.rawText).toBe('hello');
  });

  it('rawText preserves inner newlines', () => {
    const r = parse('line1\nline2');
    expect(r.rawText).toContain('\n');
    expect(r.rawText).toBe('line1\nline2');
  });
});
