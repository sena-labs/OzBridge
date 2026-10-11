import { describe, it, expect } from 'vitest';
import { parse, parseOrThrow } from '../../src/parsers/jsonParser.js';
import { OzCliError, OzCliErrorKind, AGENT_SKILL_MAP, DEFAULT_CONFIG } from '../../src/types/index.js';

// ==========================================================================
// parse<T>()
// ==========================================================================
describe('parse()', () => {
  // --- Happy path ---
  it('parses a valid JSON object', () => {
    const input = '{"id":"run-1","status":"SUCCEEDED"}';
    const result = parse<{ id: string; status: string }>(input);
    expect(result.parsed).toEqual({ id: 'run-1', status: 'SUCCEEDED' });
    expect(result.rawText).toBe(input);
  });

  it('parses a valid JSON array', () => {
    const input = '[{"id":"a"},{"id":"b"}]';
    const result = parse<Array<{ id: string }>>(input);
    expect(result.parsed).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('parses JSON with whitespace', () => {
    const input = '  \n  {"key": "value"}  \n  ';
    const result = parse<{ key: string }>(input);
    expect(result.parsed).toEqual({ key: 'value' });
  });

  // --- Boundary values ---
  it('returns null for an empty string', () => {
    const result = parse<unknown>('');
    expect(result.parsed).toBeNull();
    expect(result.rawText).toBe('');
  });

  it('returns null for whitespace only', () => {
    const result = parse<unknown>('   \n  \t  ');
    expect(result.parsed).toBeNull();
    expect(result.rawText).toBe('');
  });

  it('handles a primitive numeric JSON value', () => {
    const result = parse<number>('42');
    expect(result.parsed).toBe(42);
  });

  it('handles a JSON string', () => {
    const result = parse<string>('"hello"');
    expect(result.parsed).toBe('hello');
  });

  it('handles JSON null', () => {
    const result = parse<null>('null');
    expect(result.parsed).toBeNull();
  });

  it('handles a JSON boolean', () => {
    expect(parse<boolean>('true').parsed).toBe(true);
    expect(parse<boolean>('false').parsed).toBe(false);
  });

  // --- Case 3: JSON on a single line (embedded in text) ---
  it('finds JSON in multi-line output (single line)', () => {
    const input = 'Some log output\n{"id":"run-2","status":"FAILED"}\nMore text';
    const result = parse<{ id: string; status: string }>(input);
    expect(result.parsed).toEqual({ id: 'run-2', status: 'FAILED' });
    expect(result.rawText).toBe(input);
  });

  it('finds a JSON array in multi-line output', () => {
    const input = 'Header\n[{"id":"a"}]\nFooter';
    const result = parse<Array<{ id: string }>>(input);
    expect(result.parsed).toEqual([{ id: 'a' }]);
  });

  // --- Case 4: multi-line JSON block (not on a single line) ---
  it('finds a multi-line JSON block', () => {
    const input = 'Prefix line\n{\n  "key": "value",\n  "num": 42\n}\nSuffix line';
    const result = parse<{ key: string; num: number }>(input);
    expect(result.parsed).toEqual({ key: 'value', num: 42 });
  });

  it('finds a multi-line JSON array block', () => {
    const input = 'Log start\n[\n  {"id": 1},\n  {"id": 2}\n]\nDone';
    const result = parse<Array<{ id: number }>>(input);
    expect(result.parsed).toEqual([{ id: 1 }, { id: 2 }]);
  });

  // --- Case 5: not JSON ---
  it('returns null for plain text', () => {
    const input = 'No runs found.';
    const result = parse<unknown>(input);
    expect(result.parsed).toBeNull();
    expect(result.rawText).toBe(input);
  });

  it('returns null for text with non-JSON braces', () => {
    const input = 'function foo() { return bar; }';
    const result = parse<unknown>(input);
    // The parser tries to parse { return bar; } but fails → null
    expect(result.parsed).toBeNull();
    expect(result.rawText).toBe(input);
  });

  // --- Fallback: case 3 (multi-line) fails → case 4 (single line) succeeds ---
  it('falls back to case 4 (single line) when case 3 (multi-line block) fails', () => {
    // The multi-line block from the first { to the last } is not valid JSON,
    // but a single inner line contains valid JSON
    const input = 'prefix { invalid json }\n{"valid":true}\nextra { garbage }';
    const result = parse<{ valid: boolean }>(input);
    expect(result.parsed).toEqual({ valid: true });
  });

  // --- Edge cases ---
  it('handles a deeply nested JSON object', () => {
    const nested = { a: { b: { c: { d: 'deep' } } } };
    const result = parse<typeof nested>(JSON.stringify(nested));
    expect(result.parsed).toEqual(nested);
  });

  it('handles an empty array', () => {
    const result = parse<unknown[]>('[]');
    expect(result.parsed).toEqual([]);
  });

  it('handles an empty object', () => {
    const result = parse<Record<string, never>>('{}');
    expect(result.parsed).toEqual({});
  });

  it('preserves rawText as the trimmed original string', () => {
    const input = '  hello world  ';
    const result = parse<unknown>(input);
    expect(result.rawText).toBe('hello world');
  });
});

// ==========================================================================
// parseOrThrow<T>()
// ==========================================================================
describe('parseOrThrow()', () => {
  it('returns the parsed value for valid JSON', () => {
    const result = parseOrThrow<{ id: string }>('{"id":"x"}', 'test context');
    expect(result).toEqual({ id: 'x' });
  });

  it('throws OzCliError for non-JSON input', () => {
    expect(() => parseOrThrow<unknown>('Not JSON', 'test'))
      .toThrow(OzCliError);
  });

  it('throws with kind PARSE_ERROR', () => {
    try {
      parseOrThrow<unknown>('bad', 'my context');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(OzCliError);
      expect((err as OzCliError).kind).toBe(OzCliErrorKind.PARSE_ERROR);
    }
  });

  it('includes the context in the error message', () => {
    try {
      parseOrThrow<unknown>('not json', 'modelList');
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as OzCliError).message).toContain('modelList');
    }
  });

  it('truncates rawText in the message when it is very long', () => {
    const longText = 'a'.repeat(500);
    try {
      parseOrThrow<unknown>(longText, 'ctx');
      expect.fail('should have thrown');
    } catch (err) {
      // The message shows only the first 200 characters of rawText
      expect((err as OzCliError).message.length).toBeLessThan(longText.length);
    }
  });

  it('throws for an empty string', () => {
    expect(() => parseOrThrow<unknown>('', 'ctx')).toThrow(OzCliError);
  });
});

// ==========================================================================
// OzCliError (types)
// ==========================================================================
describe('OzCliError', () => {
  it('has name "CliError"', () => {
    const err = new OzCliError(OzCliErrorKind.CLI_ERROR, 'test');
    expect(err.name).toBe('CliError');
  });

  it('preserves kind, message, exitCode, stderr', () => {
    const err = new OzCliError(OzCliErrorKind.NOT_FOUND, 'not found', 127, 'stderr output');
    expect(err.kind).toBe(OzCliErrorKind.NOT_FOUND);
    expect(err.message).toBe('not found');
    expect(err.exitCode).toBe(127);
    expect(err.stderr).toBe('stderr output');
  });

  it('extends Error', () => {
    const err = new OzCliError(OzCliErrorKind.TIMEOUT, 'timeout');
    expect(err).toBeInstanceOf(Error);
  });

  it('has an optional exitCode that is undefined', () => {
    const err = new OzCliError(OzCliErrorKind.CANCELLED, 'cancelled');
    expect(err.exitCode).toBeUndefined();
    expect(err.stderr).toBeUndefined();
  });
});

// ==========================================================================
// AGENT_SKILL_MAP (types)
// ==========================================================================
describe('AGENT_SKILL_MAP', () => {
  it('contains 7 agent skills', () => {
    expect(Object.keys(AGENT_SKILL_MAP)).toHaveLength(7);
  });

  it('maps spec → 1-spec-agent', () => {
    expect(AGENT_SKILL_MAP['spec']).toBe('1-spec-agent');
  });

  it('maps all numbers from 1 to 7', () => {
    const values = Object.values(AGENT_SKILL_MAP);
    for (let i = 1; i <= 7; i++) {
      expect(values.some(v => v.startsWith(`${i}-`))).toBe(true);
    }
  });

  it('maps each key to the correct skill', () => {
    expect(AGENT_SKILL_MAP['design']).toBe('2-design-agent');
    expect(AGENT_SKILL_MAP['implement']).toBe('3-implement-agent');
    expect(AGENT_SKILL_MAP['review']).toBe('4-review-agent');
    expect(AGENT_SKILL_MAP['test']).toBe('5-test-agent');
    expect(AGENT_SKILL_MAP['deploy']).toBe('6-deploy-agent');
    expect(AGENT_SKILL_MAP['maintenance']).toBe('7-maintenance-agent');
  });
});

// ==========================================================================
// DEFAULT_CONFIG — default values
// ==========================================================================
describe('DEFAULT_CONFIG', () => {
  it('has all fields with the correct values', () => {
    expect(DEFAULT_CONFIG.ozPath).toBe('oz');
    expect(DEFAULT_CONFIG.defaultModel).toBe('auto');
    expect(DEFAULT_CONFIG.defaultProfile).toBe('Default');
    expect(DEFAULT_CONFIG.defaultEnvironment).toBe('');
    expect(DEFAULT_CONFIG.cloudPollingIntervalMs).toBe(5_000);
    expect(DEFAULT_CONFIG.cloudPollingTimeoutMs).toBe(1_800_000);
    expect(DEFAULT_CONFIG.timeoutMs).toBe(300_000);
    expect(DEFAULT_CONFIG.maxOutputChars).toBe(15_000);
  });
});
