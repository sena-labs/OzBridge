import { describe, it, expect } from 'vitest';
import { OzCliService } from '../../src/services/ozCliService.js';

/**
 * MED-5 — NDJSON parser edge cases.
 *
 * The Oz CLI is documented to emit one JSON object per line with no embedded
 * newlines when invoked with `WARP_OUTPUT_FORMAT=ndjson`. The parser must:
 *  - reject single-object output (treated as plain JSON, not NDJSON)
 *  - tolerate mixed `\r\n` / `\n` line endings (Windows shells)
 *  - skip non-JSON noise lines (banner, deprecation warnings) instead of
 *    failing the whole stream
 *  - skip JSON without a `type` discriminator (defensive)
 *  - return null when fewer than 2 valid events are present (so callers
 *    fall back to the plain-JSON or text path)
 *  - aggregate all `agent` text events into the result `output`
 *  - flag `FAILED` when any `tool_result` carries an error/failed status
 *  - extract `conversation_id` from the system `conversation_started` event
 */
describe('OzCliService.parseNdjson (MED-5 edge cases)', () => {
  it('returns null for empty input', () => {
    expect(OzCliService.parseNdjson('')).toBeNull();
  });

  it('returns null for single-line input (caller falls back to plain JSON path)', () => {
    expect(OzCliService.parseNdjson('{"type":"agent","text":"hi"}')).toBeNull();
  });

  it('parses a happy-path 2-event stream', () => {
    const stdout = [
      '{"type":"system","event_type":"conversation_started","conversation_id":"abc-123"}',
      '{"type":"agent","text":"Hello"}',
    ].join('\n');
    const result = OzCliService.parseNdjson(stdout);
    expect(result).not.toBeNull();
    expect(result!.runId).toBe('abc-123');
    expect(result!.status).toBe('SUCCEEDED');
    expect(result!.output).toBe('Hello');
  });

  it('handles Windows CRLF line endings', () => {
    const stdout = [
      '{"type":"system","event_type":"conversation_started","conversation_id":"win-1"}',
      '{"type":"agent","text":"From Windows"}',
    ].join('\r\n');
    const result = OzCliService.parseNdjson(stdout);
    expect(result).not.toBeNull();
    expect(result!.runId).toBe('win-1');
    expect(result!.output).toBe('From Windows');
  });

  it('tolerates mixed CRLF and LF line endings', () => {
    const stdout =
      '{"type":"system","event_type":"conversation_started","conversation_id":"mix-1"}\r\n' +
      '{"type":"agent","text":"part one"}\n' +
      '{"type":"agent","text":"part two"}';
    const result = OzCliService.parseNdjson(stdout);
    expect(result).not.toBeNull();
    expect(result!.output).toBe('part one\n\npart two');
  });

  it('skips non-JSON noise lines without failing the stream', () => {
    const stdout = [
      'WARN: deprecation notice (oz banner)',
      '{"type":"system","event_type":"conversation_started","conversation_id":"noise-1"}',
      '   ',
      'not-json at all',
      '{"type":"agent","text":"survived"}',
    ].join('\n');
    const result = OzCliService.parseNdjson(stdout);
    expect(result).not.toBeNull();
    expect(result!.runId).toBe('noise-1');
    expect(result!.output).toBe('survived');
  });

  it('skips JSON objects missing the `type` discriminator', () => {
    const stdout = [
      '{"foo":"bar"}',
      '{"type":"system","event_type":"conversation_started","conversation_id":"disc-1"}',
      '{"type":"agent","text":"only valid one wins"}',
    ].join('\n');
    const result = OzCliService.parseNdjson(stdout);
    expect(result).not.toBeNull();
    expect(result!.output).toBe('only valid one wins');
  });

  it('returns null when fewer than 2 typed events parse successfully', () => {
    // Single typed event + noise should fall back, not be treated as NDJSON.
    const stdout = [
      'noise',
      '{"type":"agent","text":"only one"}',
      'more noise',
    ].join('\n');
    expect(OzCliService.parseNdjson(stdout)).toBeNull();
  });

  it('flags FAILED when any tool_result has status=error', () => {
    const stdout = [
      '{"type":"system","event_type":"conversation_started","conversation_id":"fail-1"}',
      '{"type":"tool_call","tool":"shell","command":"ls"}',
      '{"type":"tool_result","tool":"shell","status":"error","output":"boom"}',
      '{"type":"agent","text":"sorry, that failed"}',
    ].join('\n');
    const result = OzCliService.parseNdjson(stdout);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('FAILED');
    expect(result!.output).toBe('sorry, that failed');
  });

  it('flags FAILED when any tool_result has status=failed', () => {
    const stdout = [
      '{"type":"system","event_type":"conversation_started","conversation_id":"fail-2"}',
      '{"type":"tool_result","tool":"git","status":"failed","output":"x"}',
      '{"type":"agent","text":"oops"}',
    ].join('\n');
    const result = OzCliService.parseNdjson(stdout);
    expect(result!.status).toBe('FAILED');
  });

  it('returns runId=null when no system conversation_started event is present', () => {
    const stdout = [
      '{"type":"agent","text":"hi"}',
      '{"type":"agent","text":"there"}',
    ].join('\n');
    const result = OzCliService.parseNdjson(stdout);
    expect(result).not.toBeNull();
    expect(result!.runId).toBeNull();
    expect(result!.output).toBe('hi\n\nthere');
  });

  it('falls back to raw stdout when no agent text events are present', () => {
    const stdout = [
      '{"type":"system","event_type":"conversation_started","conversation_id":"raw-1"}',
      '{"type":"tool_call","tool":"shell","command":"ls"}',
    ].join('\n');
    const result = OzCliService.parseNdjson(stdout);
    expect(result).not.toBeNull();
    // No agent texts -> output falls back to original stdout.
    expect(result!.output).toBe(stdout);
  });

  it('does not mistake pretty-printed multi-line JSON for NDJSON (returns null)', () => {
    // Pretty-printed JSON has embedded newlines that break the
    // line-per-event contract. Each line individually is invalid JSON,
    // so the parser returns null and the caller falls back to plain JSON.
    const stdout = [
      '{',
      '  "type": "agent",',
      '  "text": "pretty"',
      '}',
    ].join('\n');
    expect(OzCliService.parseNdjson(stdout)).toBeNull();
  });

  it('trims surrounding whitespace and trailing newlines', () => {
    const stdout =
      '\n\n  {"type":"system","event_type":"conversation_started","conversation_id":"trim-1"}\n' +
      '{"type":"agent","text":"trimmed"}\n\n';
    const result = OzCliService.parseNdjson(stdout);
    expect(result).not.toBeNull();
    expect(result!.runId).toBe('trim-1');
    expect(result!.output).toBe('trimmed');
  });
});
