/**
 * In-depth tests for types/index.ts — types, constants, OzCliError, AGENT_SKILL_MAP.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIG,
  OzCliError,
  OzCliErrorKind,
  AGENT_SKILL_MAP,
  OzBridgeConfig,
} from '../../src/types/index.js';

// ============================================================================
// DEFAULT_CONFIG
// ============================================================================
describe('DEFAULT_CONFIG', () => {
  it('has all OzBridgeConfig keys', () => {
    const keys: Array<keyof OzBridgeConfig> = [
      'ozPath', 'defaultModel', 'defaultProfile', 'defaultEnvironment',
      'cloudPollingIntervalMs', 'cloudPollingTimeoutMs', 'timeoutMs', 'idleTimeoutMs', 'maxOutputChars',
    ];
    for (const key of keys) {
      expect(DEFAULT_CONFIG).toHaveProperty(key);
    }
  });

  it('has ozPath = "oz"', () => {
    expect(DEFAULT_CONFIG.ozPath).toBe('oz');
  });

  it('has defaultModel = "auto"', () => {
    expect(DEFAULT_CONFIG.defaultModel).toBe('auto');
  });

  it('has defaultProfile = "Default"', () => {
    expect(DEFAULT_CONFIG.defaultProfile).toBe('Default');
  });

  it('has an empty-string defaultEnvironment', () => {
    expect(DEFAULT_CONFIG.defaultEnvironment).toBe('');
  });

  it('has cloudPollingIntervalMs = 5000', () => {
    expect(DEFAULT_CONFIG.cloudPollingIntervalMs).toBe(5_000);
  });

  it('has cloudPollingTimeoutMs = 1800000 (30 min)', () => {
    expect(DEFAULT_CONFIG.cloudPollingTimeoutMs).toBe(1_800_000);
  });

  it('has timeoutMs = 300000 (5 min)', () => {
    expect(DEFAULT_CONFIG.timeoutMs).toBe(300_000);
  });

  it('has maxOutputChars = 15000', () => {
    expect(DEFAULT_CONFIG.maxOutputChars).toBe(15_000);
  });

  it('has strictly positive numeric values for timeout and polling', () => {
    expect(DEFAULT_CONFIG.cloudPollingIntervalMs).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.cloudPollingTimeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.timeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.maxOutputChars).toBeGreaterThan(0);
  });
});

// ============================================================================
// OzCliError
// ============================================================================
describe('OzCliError', () => {
  it('extends Error', () => {
    const err = new OzCliError(OzCliErrorKind.CLI_ERROR, 'test');
    expect(err).toBeInstanceOf(Error);
  });

  it('has name = "CliError"', () => {
    const err = new OzCliError(OzCliErrorKind.TIMEOUT, 'timed out');
    expect(err.name).toBe('CliError');
  });

  it('retains kind, message, exitCode, stderr', () => {
    const err = new OzCliError(OzCliErrorKind.PARSE_ERROR, 'bad json', 2, 'stderr data');
    expect(err.kind).toBe(OzCliErrorKind.PARSE_ERROR);
    expect(err.message).toBe('bad json');
    expect(err.exitCode).toBe(2);
    expect(err.stderr).toBe('stderr data');
  });

  it('makes exitCode and stderr optional (undefined)', () => {
    const err = new OzCliError(OzCliErrorKind.CANCELLED, 'cancelled');
    expect(err.exitCode).toBeUndefined();
    expect(err.stderr).toBeUndefined();
  });

  it('has a valid stack trace', () => {
    const err = new OzCliError(OzCliErrorKind.NOT_FOUND, 'nope');
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('CliError');
  });

  it('covers all kinds of the OzCliErrorKind enum', () => {
    const allKinds = Object.values(OzCliErrorKind);
    expect(allKinds).toContain('NOT_FOUND');
    expect(allKinds).toContain('NOT_AUTHENTICATED');
    expect(allKinds).toContain('INSUFFICIENT_CREDITS');
    expect(allKinds).toContain('STALLED');
    expect(allKinds).toContain('TIMEOUT');
    expect(allKinds).toContain('PARSE_ERROR');
    expect(allKinds).toContain('CLI_ERROR');
    expect(allKinds).toContain('CANCELLED');
    expect(allKinds).toHaveLength(8);
  });
});

// ============================================================================
// OzCliErrorKind
// ============================================================================
describe('OzCliErrorKind', () => {
  it('has 8 values', () => {
    expect(Object.keys(OzCliErrorKind)).toHaveLength(8);
  });

  it('has string values equal to the keys', () => {
    for (const [key, value] of Object.entries(OzCliErrorKind)) {
      expect(key).toBe(value);
    }
  });
});

// ============================================================================
// AGENT_SKILL_MAP
// ============================================================================
describe('AGENT_SKILL_MAP', () => {
  it('has 7 entries (one per agent)', () => {
    expect(Object.keys(AGENT_SKILL_MAP)).toHaveLength(7);
  });

  it('maps keywords to skill names in the N-name-agent format', () => {
    for (const value of Object.values(AGENT_SKILL_MAP)) {
      expect(value).toMatch(/^\d-\w+-agent$/);
    }
  });

  it('contains the expected keywords', () => {
    const expected = ['spec', 'design', 'implement', 'review', 'test', 'deploy', 'maintenance'];
    for (const keyword of expected) {
      expect(AGENT_SKILL_MAP).toHaveProperty(keyword);
    }
  });

  it('has skills numbered from 1 to 7', () => {
    const numbers = Object.values(AGENT_SKILL_MAP).map((v) => parseInt(v.charAt(0), 10));
    expect(numbers.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('maps spec → 1-spec-agent', () => {
    expect(AGENT_SKILL_MAP['spec']).toBe('1-spec-agent');
  });

  it('maps deploy → 6-deploy-agent', () => {
    expect(AGENT_SKILL_MAP['deploy']).toBe('6-deploy-agent');
  });

  it('maps maintenance → 7-maintenance-agent', () => {
    expect(AGENT_SKILL_MAP['maintenance']).toBe('7-maintenance-agent');
  });
});

// ============================================================================
// OzCliError — toString, spread, prototype chain
// ============================================================================
describe('OzCliError — advanced properties', () => {
  it('has the correct prototype chain', () => {
    const err = new OzCliError(OzCliErrorKind.TIMEOUT, 'test');
    expect(Object.getPrototypeOf(err)).toBe(OzCliError.prototype);
    expect(err instanceof Error).toBe(true);
    expect(err instanceof OzCliError).toBe(true);
  });

  it('propagates exitCode 0 (not truthy)', () => {
    const err = new OzCliError(OzCliErrorKind.CLI_ERROR, 'exit 0', 0);
    expect(err.exitCode).toBe(0);
    expect(err.exitCode).not.toBeUndefined();
    expect(err.exitCode).toBeDefined();
  });

  it('propagates an empty-string stderr (not undefined)', () => {
    const err = new OzCliError(OzCliErrorKind.CLI_ERROR, 'msg', 1, '');
    expect(err.stderr).toBe('');
    expect(err.stderr).toBeDefined();
    expect(err.stderr).not.toBeUndefined();
  });

  it('propagates unicode messages', () => {
    const err = new OzCliError(OzCliErrorKind.CLI_ERROR, '错误: 失败了 🚫');
    expect(err.message).toContain('错误');
    expect(err.message).toContain('🚫');
  });

  it('propagates multi-line stderr', () => {
    const err = new OzCliError(OzCliErrorKind.CLI_ERROR, 'fail', 1, 'line1\nline2\nline3');
    expect(err.stderr).toContain('\n');
    expect(err.stderr!.split('\n')).toHaveLength(3);
    expect(err.stderr!.split('\n')[0]).toBe('line1');
    expect(err.stderr!.split('\n')[2]).toBe('line3');
  });
});

// ============================================================================
// DEFAULT_CONFIG — type guards and invariants
// ============================================================================
describe('DEFAULT_CONFIG — numeric invariants', () => {
  it('cloudPollingIntervalMs << cloudPollingTimeoutMs', () => {
    expect(DEFAULT_CONFIG.cloudPollingIntervalMs).toBeLessThan(DEFAULT_CONFIG.cloudPollingTimeoutMs);
  });

  it('pollingTimeout / pollingInterval >= 10 cycles', () => {
    const cycles = DEFAULT_CONFIG.cloudPollingTimeoutMs / DEFAULT_CONFIG.cloudPollingIntervalMs;
    expect(cycles).toBeGreaterThanOrEqual(10);
  });

  it('timeoutMs >= 60000 (at least 1 minute)', () => {
    expect(DEFAULT_CONFIG.timeoutMs).toBeGreaterThanOrEqual(60_000);
  });

  it('maxOutputChars >= 1000', () => {
    expect(DEFAULT_CONFIG.maxOutputChars).toBeGreaterThanOrEqual(1000);
  });

  it('all numeric values are integers', () => {
    expect(Number.isInteger(DEFAULT_CONFIG.cloudPollingIntervalMs)).toBe(true);
    expect(Number.isInteger(DEFAULT_CONFIG.cloudPollingTimeoutMs)).toBe(true);
    expect(Number.isInteger(DEFAULT_CONFIG.timeoutMs)).toBe(true);
    expect(Number.isInteger(DEFAULT_CONFIG.maxOutputChars)).toBe(true);
  });

  it('ozPath and defaultModel are non-empty strings', () => {
    expect(typeof DEFAULT_CONFIG.ozPath).toBe('string');
    expect(DEFAULT_CONFIG.ozPath.length).toBeGreaterThan(0);
    expect(typeof DEFAULT_CONFIG.defaultModel).toBe('string');
    expect(DEFAULT_CONFIG.defaultModel.length).toBeGreaterThan(0);
    expect(typeof DEFAULT_CONFIG.defaultProfile).toBe('string');
    expect(DEFAULT_CONFIG.defaultProfile.length).toBeGreaterThan(0);
    expect(typeof DEFAULT_CONFIG.defaultEnvironment).toBe('string');
  });
});
