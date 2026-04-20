import { describe, it, expect } from 'vitest';
import {
  isDrivePrompt,
  isDriveRule,
  isDriveSkill,
  isDriveEntry,
  parseDriveEntry,
  parseDriveEntryStrict,
} from '../../src/drive/warpDriveSource.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validPrompt = {
  id: 'p1',
  category: 'prompt',
  name: 'Deploy prompt',
  description: 'Pushes the current branch to staging.',
  tags: ['deploy', 'ops'],
  source: 'cli',
  updatedAt: '2026-04-20T05:00:00Z',
};

const validRule = {
  id: 'r1',
  category: 'rule',
  name: 'no-todo',
  description: 'Rejects TODO comments in diffs.',
  source: 'filesystem',
  scope: 'project',
};

const validSkill = {
  id: '/home/u/.agents/skills/5-test-agent/SKILL.md',
  category: 'skill',
  name: '5-test-agent',
  description: 'Writes and maintains unit/integration/E2E tests.',
  source: 'filesystem',
  model: 'gpt-4o',
};

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe('isDrivePrompt', () => {
  it('accepts a well-formed prompt', () => {
    expect(isDrivePrompt(validPrompt)).toBe(true);
  });
  it('rejects wrong categories', () => {
    expect(isDrivePrompt({ ...validPrompt, category: 'rule' })).toBe(false);
    expect(isDrivePrompt({ ...validPrompt, category: 'skill' })).toBe(false);
  });
  it('rejects missing/empty fields', () => {
    expect(isDrivePrompt({ ...validPrompt, id: '' })).toBe(false);
    const { name: _name, ...noName } = validPrompt;
    expect(isDrivePrompt(noName)).toBe(false);
    expect(isDrivePrompt(null)).toBe(false);
    expect(isDrivePrompt('not-an-object')).toBe(false);
  });
  it('rejects invalid `source`', () => {
    expect(isDrivePrompt({ ...validPrompt, source: 'http' })).toBe(false);
  });
  it('rejects non-string tag entries', () => {
    expect(isDrivePrompt({ ...validPrompt, tags: ['ops', 42] })).toBe(false);
  });
});

describe('isDriveRule', () => {
  it('accepts global/project scope or omitted', () => {
    expect(isDriveRule({ ...validRule, scope: 'global' })).toBe(true);
    expect(isDriveRule({ ...validRule, scope: 'project' })).toBe(true);
    const { scope: _scope, ...noScope } = validRule;
    expect(isDriveRule(noScope)).toBe(true);
  });
  it('rejects unknown scopes', () => {
    expect(isDriveRule({ ...validRule, scope: 'personal' })).toBe(false);
  });
});

describe('isDriveSkill', () => {
  it('accepts an optional model or omitted', () => {
    expect(isDriveSkill(validSkill)).toBe(true);
    const { model: _model, ...noModel } = validSkill;
    expect(isDriveSkill(noModel)).toBe(true);
  });
  it('rejects a non-string model', () => {
    expect(isDriveSkill({ ...validSkill, model: 42 })).toBe(false);
  });
});

describe('isDriveEntry', () => {
  it('matches any of the three categories', () => {
    expect(isDriveEntry(validPrompt)).toBe(true);
    expect(isDriveEntry(validRule)).toBe(true);
    expect(isDriveEntry(validSkill)).toBe(true);
  });
  it('rejects foreign categories', () => {
    expect(isDriveEntry({ ...validPrompt, category: 'foreign' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseDriveEntry / parseDriveEntryStrict
// ---------------------------------------------------------------------------

describe('parseDriveEntry', () => {
  it('returns the typed entry when the JSON is well-formed', () => {
    expect(parseDriveEntry(validPrompt)).toEqual(validPrompt);
    expect(parseDriveEntry(validRule)).toEqual(validRule);
    expect(parseDriveEntry(validSkill)).toEqual(validSkill);
  });

  it('defaults the `source` when the upstream producer omits it', () => {
    const { source: _source, ...raw } = validPrompt;
    const parsed = parseDriveEntry(raw, 'cli');
    expect(parsed?.source).toBe('cli');
  });

  it('honours the explicit defaultSource override', () => {
    const { source: _source, ...raw } = validRule;
    const parsed = parseDriveEntry(raw, 'filesystem');
    expect(parsed?.source).toBe('filesystem');
  });

  it('accepts `kind` as an alias of `category`', () => {
    const raw = { ...validPrompt, category: undefined, kind: 'prompt' };
    expect(parseDriveEntry(raw)?.category).toBe('prompt');
  });

  it('returns undefined for non-objects', () => {
    expect(parseDriveEntry(null)).toBeUndefined();
    expect(parseDriveEntry(undefined)).toBeUndefined();
    expect(parseDriveEntry('{"id":"p"}')).toBeUndefined();
    expect(parseDriveEntry(42)).toBeUndefined();
  });

  it('returns undefined when a required field is missing', () => {
    const { name: _name, ...missingName } = validPrompt;
    expect(parseDriveEntry(missingName)).toBeUndefined();
  });
});

describe('parseDriveEntryStrict', () => {
  it('returns { entry } for valid inputs', () => {
    const result = parseDriveEntryStrict(validSkill);
    expect('entry' in result && result.entry.category).toBe('skill');
  });

  it('reports `not an object` for scalars and null', () => {
    expect(parseDriveEntryStrict(null)).toEqual({ error: { reason: 'not an object: object' } });
    // Node reports `typeof null === 'object'` so that branch checks `raw === null`
    // separately; the scalar branch covers strings / numbers.
    expect(parseDriveEntryStrict('s')).toEqual({ error: { reason: 'not an object: string' } });
  });

  it('reports `missing category` when neither category nor kind is a string', () => {
    const result = parseDriveEntryStrict({ id: 'x', name: 'y', source: 'cli' });
    expect('error' in result && result.error.reason).toContain('missing');
  });

  it('reports `unknown category` when the category is a foreign string', () => {
    const result = parseDriveEntryStrict({ category: 'foreign', id: 'x', name: 'y', source: 'cli' });
    expect('error' in result && result.error.reason).toContain('unknown category: foreign');
  });

  it('reports `invalid fields` for a known category with bad payload', () => {
    const result = parseDriveEntryStrict({ category: 'prompt', id: '', name: 'y', source: 'cli' });
    expect('error' in result && result.error.reason).toContain('invalid fields');
  });
});
