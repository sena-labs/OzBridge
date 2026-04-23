import { describe, it, expect, beforeEach } from 'vitest';
import * as vscodeMock from '../mocks/vscode.js';
import { registerOzTools, RunLocalTool, RunCloudTool, GetRunTool, ListRunsTool } from '../../src/tools/index.js';
import {
  createMockCli,
  createMockConfigManager,
  createMockContextCollector,
  createMockPoller,
} from '../helpers.js';

function makeContext(): { subscriptions: Array<{ dispose: () => void }> } {
  return { subscriptions: [] };
}

beforeEach(() => {
  vscodeMock.lm._reset();
  vscodeMock.lm.registerTool.mockClear();
});

describe('registerOzTools()', () => {
  it('registers the 4 Oz tools under their public names', () => {
    const ctx = makeContext();
    registerOzTools(
      ctx as unknown as Parameters<typeof registerOzTools>[0],
      createMockCli(),
      createMockConfigManager(),
      createMockContextCollector(),
      createMockPoller(),
    );

    expect(vscodeMock.lm.registerTool).toHaveBeenCalledTimes(4);
    expect(vscodeMock.lm._getTool('oz_run_local')).toBeInstanceOf(RunLocalTool);
    expect(vscodeMock.lm._getTool('oz_run_cloud')).toBeInstanceOf(RunCloudTool);
    expect(vscodeMock.lm._getTool('oz_get_run')).toBeInstanceOf(GetRunTool);
    expect(vscodeMock.lm._getTool('oz_list_runs')).toBeInstanceOf(ListRunsTool);
  });

  it('pushes one disposable per tool into context.subscriptions', () => {
    const ctx = makeContext();
    registerOzTools(
      ctx as unknown as Parameters<typeof registerOzTools>[0],
      createMockCli(),
      createMockConfigManager(),
      createMockContextCollector(),
      createMockPoller(),
    );
    expect(ctx.subscriptions.length).toBe(4);
    for (const sub of ctx.subscriptions) {
      expect(typeof sub.dispose).toBe('function');
    }
  });
});
