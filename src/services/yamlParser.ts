/**
 * Minimal YAML reader for **flat scalar maps** (`key: value` on its own line).
 *
 * Supports:
 * - unquoted keys matching `[A-Za-z_][A-Za-z0-9_]*`
 * - scalar values: booleans (`true` / `false`), integers, floats, `null` /
 *   `~`, and strings (unquoted, single-quoted, double-quoted).
 * - inline `#` comments (anywhere outside a quoted string).
 * - blank / comment-only lines.
 *
 * **Intentionally unsupported** (out of scope for workspace overrides):
 * nested maps, sequences, anchors, aliases, tagged types, block scalars,
 * multi-document streams. Encountering any of them yields a reported
 * parse error with the offending line number.
 *
 * The parser is hand-rolled so the extension keeps its **zero runtime
 * dependency** promise.
 */
/** The subset of YAML value types this parser recognises. */
export type YamlScalar = string | number | boolean | null;

export interface YamlParseError {
  /** 1-based line number where the parser gave up. */
  line: number;
  /** Human-readable description of the problem. */
  message: string;
}

export interface YamlParseResult {
  /** Parsed key/value map. Keys appear in source order. */
  data: Record<string, YamlScalar>;
  /** Non-fatal errors collected during parsing. If non-empty, `data` may
   *  still contain the entries that parsed successfully. */
  errors: YamlParseError[];
}

const KEY_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*/;

/**
 * Parses a flat YAML document into a key/value map.
 *
 * Never throws — every syntactic issue is collected into
 * {@link YamlParseResult.errors} so callers can decide whether to surface
 * them to the user or degrade silently.
 */
export function parseFlatYaml(source: string): YamlParseResult {
  const lines = source.split(/\r?\n/);
  const data: Record<string, YamlScalar> = {};
  const errors: YamlParseError[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    // Indentation is not allowed because we don't support nested maps.
    if (/^\s/.test(raw)) {
      errors.push({ line: lineNo, message: 'indented lines are not supported (flat YAML only)' });
      continue;
    }
    const keyMatch = KEY_RE.exec(raw);
    if (!keyMatch) {
      errors.push({ line: lineNo, message: `expected "key: value", got \`${raw}\`` });
      continue;
    }
    const key = keyMatch[1];
    const after = raw.slice(keyMatch[0].length);

    let valuePart: string;
    try {
      valuePart = stripTrailingComment(after);
    } catch (err) {
      errors.push({ line: lineNo, message: err instanceof Error ? err.message : String(err) });
      continue;
    }

    const parsed = parseScalar(valuePart.trim());
    if (parsed.error) {
      errors.push({ line: lineNo, message: parsed.error });
      continue;
    }
    data[key] = parsed.value as YamlScalar;
  }

  return { data, errors };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Removes an inline `#` comment from a value string, respecting single and
 * double quotes so that `key: "some # value"` is preserved correctly.
 */
function stripTrailingComment(input: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    // Only double-quoted YAML strings process backslash escapes. In a
    // single-quoted string `\` is a literal character (only `''` escapes a
    // quote), so honouring `\` there would skip the real closing quote and
    // throw a spurious "unterminated quoted string".
    if (ch === '\\' && inDouble) {
      i += 1; // skip escaped char inside a double-quoted string
      continue;
    }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === '#' && !inSingle && !inDouble) {
      return input.slice(0, i);
    }
  }
  if (inSingle || inDouble) {
    throw new Error('unterminated quoted string');
  }
  return input;
}

interface ScalarResult {
  value?: YamlScalar;
  error?: string;
}

function parseScalar(value: string): ScalarResult {
  if (value === '' || value === '~' || value.toLowerCase() === 'null') {
    return { value: null };
  }
  const lower = value.toLowerCase();
  if (lower === 'true') { return { value: true }; }
  if (lower === 'false') { return { value: false }; }

  if (value.startsWith('"') || value.startsWith("'")) {
    return parseQuotedString(value);
  }

  // Try numeric parsing. `JSON.parse` is used because it rejects things
  // like `1.2.3` and leading-zero integers safely.
  if (/^-?\d+$/.test(value) || /^-?\d+\.\d+$/.test(value)) {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return { value: n };
    }
  }

  // Plain unquoted string — trim trailing whitespace, keep inner spaces.
  return { value: value };
}

function parseQuotedString(value: string): ScalarResult {
  const quote = value[0];
  if (value.length < 2 || value[value.length - 1] !== quote) {
    return { error: 'unterminated quoted string' };
  }
  const body = value.slice(1, -1);
  if (quote === '"') {
    // Double-quoted: support common JSON-like escapes.
    try {
      // Re-use JSON.parse for robust escape handling; it also validates syntax.
      return { value: JSON.parse(`"${body}"`) };
    } catch {
      return { error: 'invalid double-quoted string escapes' };
    }
  }
  // Single-quoted strings: only `''` represents a literal `'`. No other escapes.
  return { value: body.replace(/''/g, "'") };
}
