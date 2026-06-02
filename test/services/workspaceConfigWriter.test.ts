import { describe, it, expect } from 'vitest';
import {
  formatYamlScalar,
  upsertFlatYamlLine,
} from '../../src/services/workspaceConfigWriter.js';
import { parseFlatYaml } from '../../src/services/yamlParser.js';

describe('formatYamlScalar', () => {
  it('leaves simple tokens (model ids) bare', () => {
    expect(formatYamlScalar('claude-4-8-opus-max')).toBe('claude-4-8-opus-max');
    expect(formatYamlScalar('gpt-5-5-high')).toBe('gpt-5-5-high');
    expect(formatYamlScalar('gemini-3.1-pro')).toBe('gemini-3.1-pro');
    expect(formatYamlScalar('auto')).toBe('auto');
  });

  it('double-quotes values with spaces or special characters', () => {
    expect(formatYamlScalar('two words')).toBe('"two words"');
    expect(formatYamlScalar('has#hash')).toBe('"has#hash"');
    expect(formatYamlScalar('quote"inside')).toBe('"quote\\"inside"');
  });
});

describe('upsertFlatYamlLine', () => {
  it('appends a key to an empty document with a single trailing newline', () => {
    const out = upsertFlatYamlLine('', 'defaultModel', 'gpt-5-5-high');
    expect(out).toBe('defaultModel: gpt-5-5-high\n');
  });

  it('replaces an existing key in place, preserving other lines and comments', () => {
    const src = '# project defaults\ndefaultModel: auto\ndefaultProfile: Team\n';
    const out = upsertFlatYamlLine(src, 'defaultModel', 'claude-4-8-opus-max');
    expect(out).toBe('# project defaults\ndefaultModel: claude-4-8-opus-max\ndefaultProfile: Team\n');
  });

  it('appends when the key is absent, trimming trailing blank lines', () => {
    const src = 'defaultProfile: Team\n\n\n';
    const out = upsertFlatYamlLine(src, 'defaultModel', 'auto');
    expect(out).toBe('defaultProfile: Team\ndefaultModel: auto\n');
  });

  it('round-trips through parseFlatYaml', () => {
    const out = upsertFlatYamlLine('mcpPort: 3847\n', 'defaultModel', 'claude-4-6-sonnet-high');
    const { data, errors } = parseFlatYaml(out);
    expect(errors).toEqual([]);
    expect(data.defaultModel).toBe('claude-4-6-sonnet-high');
    expect(data.mcpPort).toBe(3847);
  });

  it('matches the key with surrounding whitespace but not a different key', () => {
    const src = 'defaultModelX: keep\n';
    const out = upsertFlatYamlLine(src, 'defaultModel', 'auto');
    // Must not clobber the similarly-named key.
    expect(out).toContain('defaultModelX: keep');
    expect(out).toContain('defaultModel: auto');
  });
});
