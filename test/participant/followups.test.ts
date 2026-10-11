import { describe, it, expect, beforeEach } from 'vitest';
import { FollowupProvider } from '../../src/participant/followups.js';

let provider: FollowupProvider;

beforeEach(() => {
  provider = new FollowupProvider();
});

function getFollowups(command?: string) {
  const result = command
    ? { metadata: { command } }
    : {};
  return provider.provideFollowups(result as any, {} as any, {} as any);
}

describe('FollowupProvider', () => {
  it('provides followups for /run → status + models', () => {
    const followups = getFollowups('run');
    expect(followups).toHaveLength(2);
    expect(followups.some(f => f.command === 'status')).toBe(true);
    expect(followups.some(f => f.command === 'models')).toBe(true);
  });

  it('provides followups for /cloud → status + models', () => {
    const followups = getFollowups('cloud');
    expect(followups).toHaveLength(2);
    expect(followups.some(f => f.command === 'status')).toBe(true);
  });

  it('should provide followups for /status → run + history', () => {
    const followups = getFollowups('status');
    expect(followups).toHaveLength(2);
    expect(followups.some(f => f.command === 'run')).toBe(true);
    expect(followups.some(f => f.command === 'history')).toBe(true);
  });

  it('provides followups for /config → run + init', () => {
    const followups = getFollowups('config');
    expect(followups).toHaveLength(2);
    expect(followups.some(f => f.command === 'run')).toBe(true);
    expect(followups.some(f => f.command === 'init')).toBe(true);
  });

  it('provides followups for /init → run + config', () => {
    const followups = getFollowups('init');
    expect(followups).toHaveLength(2);
    expect(followups.some(f => f.command === 'run')).toBe(true);
    expect(followups.some(f => f.command === 'config')).toBe(true);
  });

  it('provides default followups for an unknown command', () => {
    const followups = getFollowups('unknown_cmd');
    expect(followups).toHaveLength(3);
    expect(followups.some(f => f.command === 'status')).toBe(true);
    expect(followups.some(f => f.command === 'models')).toBe(true);
    expect(followups.some(f => f.command === 'config')).toBe(true);
  });

  it('provides default followups without metadata', () => {
    const followups = getFollowups(undefined);
    expect(followups).toHaveLength(3);
  });

  it('has an empty prompt and a non-empty label for every followup', () => {
    for (const cmd of ['run', 'cloud', 'status', 'config', 'init', undefined]) {
      const followups = getFollowups(cmd);
      for (const f of followups) {
        expect(f.prompt).toBe('');
        expect(f.label).toBeTruthy();
      }
    }
  });
});
