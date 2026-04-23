import { describe, it, expect } from 'vitest';
import { isInsufficientCreditsError } from '../../src/services/ozCliService.js';

describe('isInsufficientCreditsError', () => {
  it('matches HTTP 402 (Payment Required)', () => {
    expect(isInsufficientCreditsError('', 402)).toBe(true);
  });

  it('matches HTTP 429 (Too Many Requests)', () => {
    expect(isInsufficientCreditsError('', 429)).toBe(true);
  });

  it.each([
    'error: out of credits',
    'insufficient credits to start agent run',
    'no credits remaining on this account',
    'no credits left',
    'your credit balance is 0',
    'quota exceeded for this billing period',
    'usage limit reached',
    'rate limit exceeded',
    'payment required to continue',
    'billing required',
    'please upgrade your plan to continue',
    'upgrade to continue using cloud agents',
    'subscription required',
    'plan limit reached',
  ])('matches keyword stderr: %s', (stderr) => {
    expect(isInsufficientCreditsError(stderr.toLowerCase(), 1)).toBe(true);
  });

  it('does NOT match generic CLI errors', () => {
    expect(isInsufficientCreditsError('error: invalid argument --foo', 1)).toBe(false);
    expect(isInsufficientCreditsError('panic: nil pointer dereference', 1)).toBe(false);
    expect(isInsufficientCreditsError('connection refused', 1)).toBe(false);
    expect(isInsufficientCreditsError('', 1)).toBe(false);
  });

  it('does NOT match exit code 0 with empty stderr', () => {
    expect(isInsufficientCreditsError('', 0)).toBe(false);
  });
});
