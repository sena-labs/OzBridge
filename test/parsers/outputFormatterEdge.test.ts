/**
 * In-depth tests for OutputFormatter — edge cases and full coverage of formatError,
 * formatRunResult, formatList, truncate.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OutputFormatter } from '../../src/parsers/outputFormatter.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';
import { createMockStream, createMockConfigManager, makeRunResult, makeListResult } from '../helpers.js';

let formatter: OutputFormatter;
let mock: ReturnType<typeof createMockStream>;

beforeEach(() => {
  mock = createMockStream();
  formatter = new OutputFormatter(createMockConfigManager());
});

// ============================================================================
// formatRunResult — additional edge cases
// ============================================================================
describe('formatRunResult() — edge case', () => {
  it('shows header, runId and duration together', () => {
    const result = makeRunResult({ runId: 'run-abc', durationMs: 12345 });
    formatter.formatRunResult(result, mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('✅');
    expect(out).toContain('run-abc');
    expect(out).toContain('12.3');
    expect(mock.buttons.length).toBe(1);
    expect(mock.buttons[0].title).toContain('browser');
  });

  it('shows a FAILED run without runId and without duration', () => {
    const result = makeRunResult({ status: 'FAILED', runId: null, durationMs: 0, output: '' });
    formatter.formatRunResult(result, mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('❌');
    expect(out).toContain('FAILED');
    expect(out).not.toContain('Run ID');
    expect(out).not.toContain('Duration');
    expect(mock.buttons).toHaveLength(0);
  });

  it('handles status QUEUED', () => {
    const result = makeRunResult({ status: 'QUEUED' });
    formatter.formatRunResult(result, mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('QUEUED');
  });

  it('handles status INPROGRESS', () => {
    const result = makeRunResult({ status: 'INPROGRESS' });
    formatter.formatRunResult(result, mock.stream as any);
    expect(mock.getFullOutput()).toContain('INPROGRESS');
  });

  it('handles status UNKNOWN', () => {
    const result = makeRunResult({ status: 'UNKNOWN' });
    formatter.formatRunResult(result, mock.stream as any);
    expect(mock.getFullOutput()).toContain('UNKNOWN');
  });

  it('truncates long output and shows an indicator', () => {
    const longOutput = 'x'.repeat(6000);
    const cfgMgr = createMockConfigManager({ maxOutputChars: 100 });
    const fmt = new OutputFormatter(cfgMgr);
    const result = makeRunResult({ output: longOutput });
    fmt.formatRunResult(result, mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('truncated');
    expect(out).toContain('remaining');
    expect(out.length).toBeLessThan(longOutput.length);
  });

  it('should not truncate short output', () => {
    const cfgMgr = createMockConfigManager({ maxOutputChars: 10000 });
    const fmt = new OutputFormatter(cfgMgr);
    const result = makeRunResult({ output: 'short output' });
    fmt.formatRunResult(result, mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('short output');
    expect(out).not.toContain('truncated');
  });

  it('does not render output when it is undefined/an empty string', () => {
    const result = makeRunResult({ output: '' });
    formatter.formatRunResult(result, mock.stream as any);
    expect(mock.getFullOutput()).not.toContain('---');
  });

  it('shows the duration with 1-decimal precision', () => {
    const result = makeRunResult({ durationMs: 1550 });
    formatter.formatRunResult(result, mock.stream as any);
    expect(mock.getFullOutput()).toContain('1.6');
  });
});

// ============================================================================
// formatList — additional edge cases
// ============================================================================
describe('formatList() — edge case', () => {
  it('handles a single item', () => {
    const list = makeListResult([{ name: 'alpha', status: 'active' }]);
    formatter.formatList(list, ['name', 'status'], mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('name');
    expect(out).toContain('status');
    expect(out).toContain('alpha');
    expect(out).toContain('active');
  });

  it('handles many items', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `id-${i}`, val: `v${i}` }));
    const list = makeListResult(items);
    formatter.formatList(list, ['id', 'val'], mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('id-0');
    expect(out).toContain('id-19');
    expect((out.match(/\|/g) ?? []).length).toBeGreaterThan(40);
  });

  it('handles columns with undefined values using an empty string', () => {
    const list = makeListResult([{ a: 1 } as any]);
    formatter.formatList(list, ['a', 'missing' as any], mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('1');
    expect(out).toContain('|  |'); // missing column = empty (space padding)
  });

  it('shows rawText when the list is empty with rawText', () => {
    const list = makeListResult([], 'No items available.');
    formatter.formatList(list, ['id'], mock.stream as any);
    expect(mock.getFullOutput()).toContain('No items available.');
  });

  it('should show generic placeholder when list is empty without rawText', () => {
    const list = makeListResult([]);
    formatter.formatList(list, ['id'], mock.stream as any);
    expect(mock.getFullOutput()).toContain('No items found');
  });
});

// ============================================================================
// formatError — additional coverage
// ============================================================================
describe('formatError() — additional coverage', () => {
  it('NOT_FOUND: button opens the warp.dev URL', () => {
    const err = new OzCliError(OzCliErrorKind.NOT_FOUND, 'not found');
    formatter.formatError(err, mock.stream as any);
    expect(mock.buttons.length).toBe(1);
    const btnUrl = String(mock.buttons[0].arguments?.[0] ?? '');
    expect(btnUrl).toContain('warp.dev');
  });

  it('NOT_AUTHENTICATED: button opens app.warp.dev', () => {
    const err = new OzCliError(OzCliErrorKind.NOT_AUTHENTICATED, 'unauthorized');
    formatter.formatError(err, mock.stream as any);
    expect(mock.buttons.length).toBe(1);
    const btnUrl = String(mock.buttons[0].arguments?.[0] ?? '');
    expect(btnUrl).toContain('app.warp.dev');
  });

  it('TIMEOUT: mentions the configured timeout in seconds', () => {
    const cfgMgr = createMockConfigManager({ timeoutMs: 60000 });
    const fmt = new OutputFormatter(cfgMgr);
    const err = new OzCliError(OzCliErrorKind.TIMEOUT, 'timeout');
    fmt.formatError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('60');
  });

  it('CLI_ERROR without stderr: shows only message', () => {
    const err = new OzCliError(OzCliErrorKind.CLI_ERROR, 'generic error', 2);
    formatter.formatError(err, mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('generic error');
    expect(out).toContain('2');
    expect(out).not.toContain('stderr');
  });

  it('CLI_ERROR with long stderr: truncates stderr to 500 chars', () => {
    const longStderr = 'E'.repeat(1000);
    const err = new OzCliError(OzCliErrorKind.CLI_ERROR, 'fail', 1, longStderr);
    formatter.formatError(err, mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('stderr');
    // The stderr string in the markdown should not contain the whole stdout
    expect(out.length).toBeLessThan(longStderr.length + 500);
  });

  it('CLI_ERROR without exitCode: shows "?"', () => {
    const err = new OzCliError(OzCliErrorKind.CLI_ERROR, 'bad');
    formatter.formatError(err, mock.stream as any);
    expect(mock.getFullOutput()).toContain('?');
  });

  it('CANCELLED: shows no button', () => {
    const err = new OzCliError(OzCliErrorKind.CANCELLED, 'user cancel');
    formatter.formatError(err, mock.stream as any);
    expect(mock.buttons).toHaveLength(0);
  });

  it('PARSE_ERROR with stderr: shows stderr in the code block', () => {
    const err = new OzCliError(OzCliErrorKind.PARSE_ERROR, 'bad json', 0, 'unexpected < at 0');
    formatter.formatError(err, mock.stream as any);
    const out = mock.getFullOutput();
    expect(out).toContain('unexpected < at 0');
    expect(out).toContain('```');
  });
});
