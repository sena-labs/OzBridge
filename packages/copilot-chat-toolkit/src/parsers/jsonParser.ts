import { CliError, CliErrorKind } from '../types.js';

/**
 * Result of a JSON parse attempt.
 *
 * @typeParam T - Expected shape of the parsed value.
 */
export interface ParseResult<T> {
  parsed: T | null;
  rawText: string;
}

/**
 * Attempts to extract a typed JSON value from raw CLI output.
 *
 * Applies a 5-level strategy:
 * 1. Empty input → `{ parsed: null, rawText: '' }`
 * 2. Direct `JSON.parse` of the trimmed string
 * 3. Multi-line JSON block (first `{`/`[` to last `}`/`]`)
 * 4. Single-line JSON extraction (per-line scan)
 * 5. Non-JSON text → `{ parsed: null, rawText }`
 */
export function parse<T>(stdout: string): ParseResult<T> {
  const trimmed = stdout.trim();

  if (!trimmed) {
    return { parsed: null, rawText: '' };
  }

  try {
    const parsed = JSON.parse(trimmed) as T;
    return { parsed, rawText: trimmed };
  } catch {
    // Strategy 3: multi-line JSON block
    const firstBrace = trimmed.search(/[{\[]/);
    if (firstBrace >= 0) {
      const startChar = trimmed[firstBrace];
      const endChar = startChar === '{' ? '}' : ']';
      const lastBrace = trimmed.lastIndexOf(endChar);
      if (lastBrace > firstBrace) {
        const candidate = trimmed.substring(firstBrace, lastBrace + 1);
        try {
          const parsed = JSON.parse(candidate) as T;
          return { parsed, rawText: trimmed };
        } catch {
          // fallthrough
        }
      }
    }

    // Strategy 4: single-line JSON scan
    const lines = trimmed.split('\n');
    for (const line of lines) {
      const t = line.trim();
      if ((t.startsWith('{') || t.startsWith('[')) && (t.endsWith('}') || t.endsWith(']'))) {
        try {
          const parsed = JSON.parse(t) as T;
          return { parsed, rawText: trimmed };
        } catch {
          continue;
        }
      }
    }

    // Strategy 5: non-JSON text
    return { parsed: null, rawText: trimmed };
  }
}

/**
 * Parses raw CLI output into a typed value or throws a {@link CliError}.
 *
 * @throws {CliError} with kind `PARSE_ERROR` if no JSON could be extracted.
 */
export function parseOrThrow<T>(stdout: string, context: string): T {
  const result = parse<T>(stdout);
  if (result.parsed === null) {
    throw new CliError(
      CliErrorKind.PARSE_ERROR,
      `Failed to parse JSON from '${context}': ${result.rawText.substring(0, 200)}`,
    );
  }
  return result.parsed;
}
