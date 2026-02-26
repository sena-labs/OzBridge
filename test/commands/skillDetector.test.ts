import { describe, it, expect } from 'vitest';
import { detectSkill } from '../../src/commands/skillDetector.js';

describe('detectSkill', () => {
  it('dovrebbe rilevare skill "spec" nel prompt', () => {
    expect(detectSkill('write a spec for the new module')).toBe('1-spec-agent');
  });

  it('dovrebbe rilevare skill "test" nel prompt', () => {
    expect(detectSkill('generate test cases')).toBe('5-test-agent');
  });

  it('dovrebbe rilevare skill "review" nel prompt', () => {
    expect(detectSkill('review my code')).toBe('4-review-agent');
  });

  it('dovrebbe restituire undefined se nessuna skill rilevata', () => {
    expect(detectSkill('fix the bug in production')).toBeUndefined();
  });

  it('non dovrebbe avere falsi positivi su sottostringhe', () => {
    // "inspector" contiene "spec" come sottostringa, ma non è un word match
    expect(detectSkill('run the inspector tool')).toBeUndefined();
  });

  it('dovrebbe essere case-insensitive', () => {
    expect(detectSkill('Write a SPEC please')).toBe('1-spec-agent');
  });

  it('dovrebbe rilevare skill con punteggiatura adiacente', () => {
    expect(detectSkill('please run test, thanks!')).toBe('5-test-agent');
  });

  it('dovrebbe restituire undefined per prompt vuoto', () => {
    expect(detectSkill('')).toBeUndefined();
  });
});
