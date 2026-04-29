// C-M1: direct unit tests for src/utils/error.ts (previously covered only
// indirectly through callers). Pure functions, no I/O — quick sanity checks
// for every documented branch of `getErrorMessage` / `getErrorDetails`.

import { describe, it, expect } from 'vitest';
import { getErrorMessage, getErrorDetails } from '../../src/utils/error.js';

describe('getErrorMessage', () => {
  it('returns Error.message for Error instances', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns subclass.message for Error subclasses', () => {
    class MyError extends Error { constructor() { super('sub'); this.name = 'MyError'; } }
    expect(getErrorMessage(new MyError())).toBe('sub');
  });

  it('returns object.message when err is a plain object with string message', () => {
    expect(getErrorMessage({ message: 'plain' })).toBe('plain');
  });

  it('falls back to String() when message is missing or non-string', () => {
    expect(getErrorMessage({ message: 42 })).toBe('[object Object]');
    expect(getErrorMessage({})).toBe('[object Object]');
  });

  it('handles primitives', () => {
    expect(getErrorMessage('raw')).toBe('raw');
    expect(getErrorMessage(123)).toBe('123');
    expect(getErrorMessage(null)).toBe('null');
    expect(getErrorMessage(undefined)).toBe('undefined');
  });
});

describe('getErrorDetails', () => {
  it('returns the stack when Error has one', () => {
    const err = new Error('with-stack');
    expect(getErrorDetails(err)).toContain('with-stack');
    // Stack typically includes the file path or "at ..." frames
    expect(getErrorDetails(err)).toMatch(/Error: with-stack|at /);
  });

  it('falls back to message when Error has no stack', () => {
    const err = new Error('no-stack');
    Object.defineProperty(err, 'stack', { value: undefined });
    expect(getErrorDetails(err)).toBe('no-stack');
  });

  it('delegates to getErrorMessage for non-Error values', () => {
    expect(getErrorDetails('plain')).toBe('plain');
    expect(getErrorDetails({ message: 'obj' })).toBe('obj');
  });
});
