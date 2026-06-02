import { describe, it, expect } from 'vitest';
import { parseFlatYaml } from '../../src/services/yamlParser.js';

describe('parseFlatYaml — happy paths', () => {
  it('returns empty data for an empty string', () => {
    const result = parseFlatYaml('');
    expect(result.data).toEqual({});
    expect(result.errors).toEqual([]);
  });

  it('parses simple key/value pairs with unquoted strings', () => {
    const src = 'defaultModel: gpt-4o\ndefaultProfile: Default\n';
    const result = parseFlatYaml(src);
    expect(result.data).toEqual({ defaultModel: 'gpt-4o', defaultProfile: 'Default' });
    expect(result.errors).toEqual([]);
  });

  it('parses booleans, numbers and nulls', () => {
    const src = [
      'mcpEnabled: true',
      'mcpPort: 3900',
      'cloudPollingIntervalMs: 7500',
      'defaultEnvironment: ~',
      'maxOutputChars: null',
    ].join('\n');
    const result = parseFlatYaml(src);
    expect(result.data).toEqual({
      mcpEnabled: true,
      mcpPort: 3900,
      cloudPollingIntervalMs: 7500,
      defaultEnvironment: null,
      maxOutputChars: null,
    });
    expect(result.errors).toEqual([]);
  });

  it('parses quoted strings and preserves inner spaces', () => {
    const src = `profile: "team shared"\nbranch: 'master'\nmcpBindAddress: "0.0.0.0"`;
    const result = parseFlatYaml(src);
    expect(result.data).toEqual({
      profile: 'team shared',
      branch: 'master',
      mcpBindAddress: '0.0.0.0',
    });
  });

  it('ignores blank and comment-only lines', () => {
    const src = [
      '# OzBridge per-workspace overrides',
      '',
      'defaultModel: gpt-4o  # inline comment',
      '   ',
      '# trailing comment',
      'mcpPort: 3900',
    ].join('\n');
    const result = parseFlatYaml(src);
    expect(result.data).toEqual({ defaultModel: 'gpt-4o', mcpPort: 3900 });
    expect(result.errors).toEqual([]);
  });

  it('keeps `#` inside quoted strings (not a comment)', () => {
    const src = 'defaultProfile: "a # not a comment"';
    const result = parseFlatYaml(src);
    expect(result.data.defaultProfile).toBe('a # not a comment');
  });

  it('parses a single-quoted value ending in a backslash (no escape processing)', () => {
    // YAML single quotes treat `\` literally; the comment-stripper must not
    // skip the real closing quote → previously threw "unterminated".
    const result = parseFlatYaml("defaultProfile: 'C:\\Users\\me\\'\n");
    expect(result.errors).toEqual([]);
    expect(result.data.defaultProfile).toBe('C:\\Users\\me\\');
  });

  it('parses negative integers and floats', () => {
    const src = 'a: -42\nb: 3.14';
    const result = parseFlatYaml(src);
    expect(result.data).toEqual({ a: -42, b: 3.14 });
  });

  it('coerces true/false case-insensitively', () => {
    const src = 'a: TRUE\nb: False';
    const result = parseFlatYaml(src);
    expect(result.data).toEqual({ a: true, b: false });
  });
});

describe('parseFlatYaml — error handling', () => {
  it('collects an error for indented lines (nesting is unsupported)', () => {
    const src = 'a: 1\n  b: 2';
    const result = parseFlatYaml(src);
    expect(result.data).toEqual({ a: 1 });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(2);
    expect(result.errors[0].message).toContain('flat YAML only');
  });

  it('reports a missing colon without throwing', () => {
    const src = 'foo-bar-baz';
    const result = parseFlatYaml(src);
    expect(result.data).toEqual({});
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('expected "key: value"');
  });

  it('reports unterminated quoted strings', () => {
    const src = 'foo: "unterminated';
    const result = parseFlatYaml(src);
    expect(result.errors[0].message).toContain('unterminated quoted string');
  });
});
