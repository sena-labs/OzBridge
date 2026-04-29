import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WALKTHROUGH_ID,
  WALKTHROUGH_STATE_KEY,
  maybeOpenGettingStartedWalkthrough,
} from '../../src/ui/walkthrough.js';

function createGlobalState(initial?: unknown) {
  const store = new Map<string, unknown>();
  if (initial !== undefined) { store.set(WALKTHROUGH_STATE_KEY, initial); }
  return {
    get: vi.fn(<T>(key: string) => store.get(key) as T | undefined),
    update: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    _store: store,
  };
}

function createHost() {
  return {
    executeCommand: vi.fn(async () => undefined),
  };
}

describe('maybeOpenGettingStartedWalkthrough — first-run gating', () => {
  let host: ReturnType<typeof createHost>;

  beforeEach(() => {
    host = createHost();
  });

  it('opens the walkthrough when the gate has never been flipped', async () => {
    const globalState = createGlobalState();
    const opened = await maybeOpenGettingStartedWalkthrough({ globalState, host });
    expect(opened).toBe(true);
    expect(host.executeCommand).toHaveBeenCalledWith(
      'workbench.action.openWalkthrough',
      WALKTHROUGH_ID,
      false,
    );
  });

  it('flips the gate to true before dispatching the command', async () => {
    const globalState = createGlobalState();
    await maybeOpenGettingStartedWalkthrough({ globalState, host });
    expect(globalState.update).toHaveBeenCalledWith(WALKTHROUGH_STATE_KEY, true);
    expect(globalState._store.get(WALKTHROUGH_STATE_KEY)).toBe(true);
  });

  it('skips subsequent activations once the gate is set', async () => {
    const globalState = createGlobalState(true);
    const opened = await maybeOpenGettingStartedWalkthrough({ globalState, host });
    expect(opened).toBe(false);
    expect(host.executeCommand).not.toHaveBeenCalled();
    expect(globalState.update).not.toHaveBeenCalled();
  });

  it('treats falsy stored values as "not shown yet"', async () => {
    const globalState = createGlobalState(false);
    const opened = await maybeOpenGettingStartedWalkthrough({ globalState, host });
    expect(opened).toBe(true);
    expect(host.executeCommand).toHaveBeenCalledTimes(1);
  });

  it('uses the qualified walkthrough id contributed in package.json', async () => {
    const globalState = createGlobalState();
    await maybeOpenGettingStartedWalkthrough({ globalState, host });
    expect(WALKTHROUGH_ID).toBe('sena-labs.ozbridge#ozBridge.gettingStarted');
    expect(host.executeCommand.mock.calls[0]?.[1]).toBe(WALKTHROUGH_ID);
  });

  it('returns false (without throwing) when openWalkthrough rejects', async () => {
    const globalState = createGlobalState();
    host.executeCommand.mockRejectedValueOnce(new Error('no such walkthrough'));
    const opened = await maybeOpenGettingStartedWalkthrough({ globalState, host });
    expect(opened).toBe(false);
    // Gate still flipped so we don't retry on next activation.
    expect(globalState._store.get(WALKTHROUGH_STATE_KEY)).toBe(true);
  });

  it('passes the showProgress=false flag so the wizard does not steal focus from activation', async () => {
    const globalState = createGlobalState();
    await maybeOpenGettingStartedWalkthrough({ globalState, host });
    expect(host.executeCommand.mock.calls[0]?.[2]).toBe(false);
  });
});
