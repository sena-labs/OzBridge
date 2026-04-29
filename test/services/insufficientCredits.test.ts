import { describe, it, expect } from 'vitest';
import {
  hasExplicitInsufficientCreditsSignal,
  isInsufficientCreditsError,
} from '../../src/services/ozCliService.js';

describe('hasExplicitInsufficientCreditsSignal', () => {
  // Documented Warp messages — see
  // https://docs.warp.dev/reference/api-and-sdk/troubleshooting/errors/insufficient-credits
  it.each([
    'error: out of credits',
    'insufficient credits to start agent run',
    'no credits remaining on this account',
    'no credits left',
    "your team has run out of add-on credits",
    'purchase more credits in your team\'s billing settings to continue',
    'purchase more add-on credits',
    'purchase additional add-on credits',
    'no add-on credits available',
    'insufficient_credits',
  ])('matches documented Warp credit signal: %s', (stderr) => {
    expect(hasExplicitInsufficientCreditsSignal(stderr.toLowerCase())).toBe(true);
  });

  // Anti false-positive: ambiguous strings must NOT trigger.
  it.each([
    'rate limit exceeded',                // network throttling / 429
    'usage limit reached',                // ambiguous, may be plan tier
    'quota limit reached',                // ambiguous
    'plan limit reached',                 // ambiguous
    'subscription required',              // not the documented message
    'upgrade your plan',                  // marketing copy
    'upgrade to continue',                // ambiguous
    'payment required to continue',       // HTTP 402 is NOT this error
    'billing required',                   // ambiguous
    'connection refused',                 // pure network failure
    'timeout while waiting for response', // pure timeout
    'error: invalid argument --foo',      // CLI arg error
    'panic: nil pointer dereference',     // backend crash
    '',                                   // empty buffer
  ])('does NOT match ambiguous / unrelated text: %s', (stderr) => {
    expect(hasExplicitInsufficientCreditsSignal(stderr.toLowerCase())).toBe(false);
  });
});

describe('isInsufficientCreditsError', () => {
  it('matches HTTP 403 only when an explicit credits signal is present', () => {
    expect(isInsufficientCreditsError('your team has run out of add-on credits', 403)).toBe(true);
  });

  it('does NOT match HTTP 403 alone (no documented credits signal)', () => {
    expect(isInsufficientCreditsError('forbidden', 403)).toBe(false);
  });

  it('does NOT match HTTP 402 (Payment Required) on its own', () => {
    // Warp’s insufficient_credits is documented as 403, not 402.
    expect(isInsufficientCreditsError('', 402)).toBe(false);
  });

  it('does NOT match HTTP 429 (Too Many Requests) on its own', () => {
    // 429 is rate-limiting, not credits exhaustion.
    expect(isInsufficientCreditsError('', 429)).toBe(false);
    expect(isInsufficientCreditsError('rate limit exceeded', 429)).toBe(false);
  });

  it('matches arbitrary exit codes when stderr carries an explicit signal', () => {
    // The CLI may exit with any non-zero code when surfacing the
    // documented body — the matcher relies on the body text, not the
    // exit code, so we accept any code as long as the canonical
    // string is present.
    expect(isInsufficientCreditsError('out of credits', 1)).toBe(true);
    expect(isInsufficientCreditsError('insufficient credits', 7)).toBe(true);
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
