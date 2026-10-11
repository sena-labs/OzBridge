import { describe, it, expect } from 'vitest';
import { detectSkill } from '../../src/commands/skillDetector.js';

describe('detectSkill', () => {
  it('detects the "spec" skill in the prompt', () => {
    expect(detectSkill('write a spec for the new module')).toBe('1-spec-agent');
  });

  it('detects the "test" skill in the prompt', () => {
    expect(detectSkill('generate test cases')).toBe('5-test-agent');
  });

  it('detects the "review" skill in the prompt', () => {
    expect(detectSkill('review my code')).toBe('4-review-agent');
  });

  it('returns undefined when no skill is detected', () => {
    expect(detectSkill('fix the bug in production')).toBeUndefined();
  });

  it('has no false positives on substrings', () => {
    // "inspector" contains "spec" as a substring, but it is not a word match
    expect(detectSkill('run the inspector tool')).toBeUndefined();
  });

  it('is case-insensitive', () => {
    expect(detectSkill('Write a SPEC please')).toBe('1-spec-agent');
  });

  it('detects skills with adjacent punctuation', () => {
    expect(detectSkill('please run test, thanks!')).toBe('5-test-agent');
  });

  it('returns undefined for an empty prompt', () => {
    expect(detectSkill('')).toBeUndefined();
  });
});
