import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OutputFormatter } from '../../src/parsers/outputFormatter.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';
import { createMockStream, createMockConfigManager, makeRunResult, makeListResult } from '../helpers.js';

let formatter: OutputFormatter;
let mock: ReturnType<typeof createMockStream>;

beforeEach(() => {
  vi.clearAllMocks();
  formatter = new OutputFormatter(createMockConfigManager());
  mock = createMockStream();
});

// ==========================================================================
// formatRunResult()
// ==========================================================================
describe('formatRunResult()', () => {
  it('shows the ✅ icon for a SUCCEEDED run', () => {
    formatter.formatRunResult(makeRunResult({ status: 'SUCCEEDED' }), mock.stream as any);
    expect(mock.getFullOutput()).toContain('✅');
    expect(mock.getFullOutput()).toContain('SUCCEEDED');
  });

  it('shows the ❌ icon for a FAILED run', () => {
    formatter.formatRunResult(makeRunResult({ status: 'FAILED' }), mock.stream as any);
    expect(mock.getFullOutput()).toContain('❌');
    expect(mock.getFullOutput()).toContain('FAILED');
  });

  it('shows ⏳ (not ❌) for an in-flight run', () => {
    formatter.formatRunResult(makeRunResult({ status: 'INPROGRESS' }), mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('⏳');
    expect(out).not.toContain('❌');
  });

  it('shows the Run ID when present', () => {
    formatter.formatRunResult(makeRunResult({ runId: 'abc-123' }), mock.stream as any);
    expect(mock.getFullOutput()).toContain('abc-123');
  });

  it('omits the Run ID when null', () => {
    formatter.formatRunResult(makeRunResult({ runId: null }), mock.stream as any);
    expect(mock.getFullOutput()).not.toContain('Run ID');
  });

  it('shows the duration in seconds', () => {
    formatter.formatRunResult(makeRunResult({ durationMs: 3500 }), mock.stream as any);
    expect(mock.getFullOutput()).toContain('3.5s');
  });

  it('does not show the duration when 0', () => {
    formatter.formatRunResult(makeRunResult({ durationMs: 0 }), mock.stream as any);
    expect(mock.getFullOutput()).not.toContain('⏱️');
  });

  it('shows the agent output', () => {
    formatter.formatRunResult(makeRunResult({ output: 'Agent result text' }), mock.stream as any);
    expect(mock.getFullOutput()).toContain('Agent result text');
  });

  it('adds a web button when runId is present (without autoOpened)', () => {
    formatter.formatRunResult(makeRunResult({ runId: 'xyz' }), mock.stream as any);
    expect(mock.buttons).toHaveLength(1);
    expect(mock.buttons[0].title).toContain('browser');
    // The fallback URL uses /session/ with runId
    expect(mock.buttons[0].arguments![0].toString()).toContain('/session/xyz');
  });

  it('does not show buttons when autoOpened is true (Warp opened via --open)', () => {
    formatter.formatRunResult(makeRunResult({ runId: 'conv-123' }), mock.stream as any, { autoOpened: true });
    expect(mock.buttons).toHaveLength(0);
  });

  it('does not show buttons when local is true (local run)', () => {
    formatter.formatRunResult(makeRunResult({ runId: 'local-conv-id' }), mock.stream as any, { local: true });
    expect(mock.buttons).toHaveLength(0);
  });

  it('extracts the session URL from the output when present', () => {
    const result = makeRunResult({
      runId: 'abc',
      output: 'Spawned agent\nView agent session: https://app.warp.dev/session/e84b70c3-b2fa-4c8e-8d51-afc319898bb1',
    });
    formatter.formatRunResult(result, mock.stream as any);
    expect(mock.buttons).toHaveLength(1);
    expect(mock.buttons[0].arguments![0].toString()).toContain('/session/e84b70c3-b2fa-4c8e-8d51-afc319898bb1');
  });

  it('does not add a button when runId is null', () => {
    formatter.formatRunResult(makeRunResult({ runId: null }), mock.stream as any);
    expect(mock.buttons).toHaveLength(0);
  });

  // Gap: empty output (falsy string) → output block skipped
  it('does not show the output block when output is an empty string', () => {
    formatter.formatRunResult(makeRunResult({ output: '' }), mock.stream as any);
    const output = mock.getFullOutput();
    // Must not contain the ---\n separator that precedes the output
    expect(output).not.toContain('---');
  });

  // --- Truncation ---
  it('should truncate output exceeding maxOutputChars', () => {
    const longOutput = 'x'.repeat(20_000);
    formatter.formatRunResult(makeRunResult({ output: longOutput }), mock.stream as any);
    const full = mock.getFullOutput();
    expect(full).toContain('truncated');
    // Total output must be significantly shorter than the input
    expect(full.length).toBeLessThan(longOutput.length);
  });

  it('should not truncate output within the limit', () => {
    const shortOutput = 'x'.repeat(100);
    formatter.formatRunResult(makeRunResult({ output: shortOutput }), mock.stream as any);
    expect(mock.getFullOutput()).not.toContain('truncated');
  });
});

// ==========================================================================
// formatList()
// ==========================================================================
describe('formatList()', () => {
  it('should show message for empty list', () => {
    formatter.formatList(makeListResult([]), ['id'], mock.stream as any);
    expect(mock.getFullOutput()).toContain('No items found');
  });

  it('shows rawText for an empty list with rawText', () => {
    formatter.formatList(makeListResult([], 'No runs found.'), ['id'], mock.stream as any);
    expect(mock.getFullOutput()).toContain('No runs found.');
  });

  it('renders a markdown table with header and rows', () => {
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

  it('handles missing columns with an empty string', () => {
    const items = [{ id: 'x' }];
    formatter.formatList(makeListResult(items), ['id', 'name' as any], mock.stream as any);
    const output = mock.getFullOutput();
    expect(output).toContain('| x |');
  });

  it('escapes `|` in cell values so the table layout is not broken', () => {
    const items = [{ id: 'x', name: 'a|b' }];
    formatter.formatList(makeListResult(items), ['id', 'name' as any], mock.stream as any);
    expect(mock.getFullOutput()).toContain('a\\|b');
  });

  it('escapes backslashes before pipes so an escape cannot be neutralised', () => {
    // Value is the four characters a \ | b. Escaping `|` alone emitted
    // a \ \ | b, where the value's own backslash escaped the backslash we
    // had just added and left the pipe live as a column separator.
    // Escaping `\` first yields a \ \ \ | b: literal backslash, escaped pipe.
    const items = [{ id: 'x', name: 'a\\|b' }];
    formatter.formatList(makeListResult(items), ['id', 'name' as any], mock.stream as any);
    expect(mock.getFullOutput()).toContain('a\\\\\\|b');
  });

  it('escapes a lone trailing backslash so it cannot escape the row separator', () => {
    const items = [{ id: 'x', name: 'end\\' }];
    formatter.formatList(makeListResult(items), ['id', 'name' as any], mock.stream as any);
    expect(mock.getFullOutput()).toContain('end\\\\');
  });
});

// ==========================================================================
// formatError()
// ==========================================================================
describe('formatError()', () => {
  it('should show NOT_FOUND message with install button', () => {
    const err = new OzCliError(OzCliErrorKind.NOT_FOUND, 'not found');
    formatter.formatError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('not found');
    expect(mock.buttons.length).toBeGreaterThanOrEqual(1);
    expect(mock.buttons[0].title).toContain('Install');
  });

  it('should show NOT_AUTHENTICATED message with login button', () => {
    const err = new OzCliError(OzCliErrorKind.NOT_AUTHENTICATED, 'not logged in');
    formatter.formatError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('Not authenticated');
    expect(mock.buttons.length).toBeGreaterThanOrEqual(1);
    expect(mock.buttons[0].title).toContain('Login');
  });

  it('should show TIMEOUT message with settings hint', () => {
    const err = new OzCliError(OzCliErrorKind.TIMEOUT, 'timed out');
    formatter.formatError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('Timeout');
  });

  it('should show CANCELLED message', () => {
    const err = new OzCliError(OzCliErrorKind.CANCELLED, 'cancelled');
    formatter.formatError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('cancelled');
  });

  it('should show PARSE_ERROR message with detail', () => {
    const err = new OzCliError(OzCliErrorKind.PARSE_ERROR, 'bad json', 0, 'stderr data');
    formatter.formatError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('Parsing error');
    expect(mock.getFullOutput()).toContain('stderr data');
  });

  // Gap: PARSE_ERROR without stderr → fallback to error.message
  it('should fallback to message when PARSE_ERROR has no stderr', () => {
    const err = new OzCliError(OzCliErrorKind.PARSE_ERROR, 'unexpected token at col 5');
    formatter.formatError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('Parsing error');
    expect(mock.getFullOutput()).toContain('unexpected token at col 5');
  });

  it('should show generic CLI_ERROR message with exit code', () => {
    const err = new OzCliError(OzCliErrorKind.CLI_ERROR, 'something failed', 1, 'err output');
    formatter.formatError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('CLI Error');
    expect(mock.getFullOutput()).toContain('1');
  });

  it('handles CLI_ERROR without stderr', () => {
    const err = new OzCliError(OzCliErrorKind.CLI_ERROR, 'fail');
    formatter.formatError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('fail');
  });
});

// ==========================================================================
// handleError()
// ==========================================================================
describe('handleError()', () => {
  it('should delegate OzCliError to formatError', () => {
    const err = new OzCliError(OzCliErrorKind.NOT_FOUND, 'not found');
    formatter.handleError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('not found');
    expect(mock.buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('formats a generic Error with its message', () => {
    formatter.handleError(new Error('something broke'), mock.stream as any);
    expect(mock.getFullOutput()).toContain('something broke');
  });

  it('formats a plain string as an error', () => {
    formatter.handleError('raw string error', mock.stream as any);
    expect(mock.getFullOutput()).toContain('raw string error');
  });

  // Edge case: null / undefined / numeric
  it('handles null without crashing', () => {
    expect(() => formatter.handleError(null, mock.stream as any)).not.toThrow();
    expect(mock.getFullOutput()).toContain('null');
  });

  it('handles undefined without crashing', () => {
    expect(() => formatter.handleError(undefined, mock.stream as any)).not.toThrow();
    expect(mock.getFullOutput()).toContain('undefined');
  });

  it('handles a numeric error (throw 42)', () => {
    formatter.handleError(42, mock.stream as any);
    expect(mock.getFullOutput()).toContain('42');
  });

  it('delegates OzCliError TIMEOUT to formatError', () => {
    const err = new OzCliError(OzCliErrorKind.TIMEOUT, 'timed out');
    formatter.handleError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('Timeout');
  });
});
