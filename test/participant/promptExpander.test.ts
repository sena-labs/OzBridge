import { describe, it, expect, beforeEach } from 'vitest';
import { expandPromptVariables, resolveToken } from '../../src/participant/promptExpander.js';
import type { OzRunStatus } from '../../src/types/index.js';
import {
  createMockCli,
  createMockConfigManager,
  makeListResult,
  makeRunResult,
} from '../helpers.js';

let cli: ReturnType<typeof createMockCli>;
let cfgMgr: ReturnType<typeof createMockConfigManager>;

beforeEach(() => {
  cli = createMockCli();
  cfgMgr = createMockConfigManager({
    defaultEnvironment: 'prod-env',
    defaultProfile: 'Default',
    defaultModel: 'gpt-4o',
  });
});

describe('expandPromptVariables', () => {
  it('returns the input unchanged when there are no tokens', async () => {
    const result = await expandPromptVariables('just a regular prompt', { cli, cfgMgr });
    expect(result.text).toBe('just a regular prompt');
    expect(result.replacements).toEqual([]);
  });

  it('expands #warp.env to the configured default environment', async () => {
    const result = await expandPromptVariables('deploy to #warp.env please', { cli, cfgMgr });
    expect(result.text).toBe('deploy to prod-env please');
    expect(result.replacements).toEqual([{ token: '#warp.env', value: 'prod-env' }]);
  });

  it('falls back to "(no default environment)" when defaultEnvironment is empty', async () => {
    cfgMgr = createMockConfigManager({ defaultEnvironment: '' });
    const result = await expandPromptVariables('use #warp.env', { cli, cfgMgr });
    expect(result.text).toContain('(no default environment)');
  });

  it('expands #warp.profile and #warp.model', async () => {
    const result = await expandPromptVariables(
      'profile=#warp.profile model=#warp.model',
      { cli, cfgMgr },
    );
    expect(result.text).toBe('profile=Default model=gpt-4o');
    expect(result.replacements.map((r) => r.token).sort()).toEqual(['#warp.model', '#warp.profile']);
  });

  it('expands #oz.history via cli.runList and renders a markdown table', async () => {
    cli.runList.mockResolvedValue(
      makeListResult<{ id: string; status: OzRunStatus }>([
        { id: 'r1', status: 'SUCCEEDED' },
        { id: 'r2', status: 'FAILED' },
      ]),
    );

    const result = await expandPromptVariables('Context:\n#oz.history\nEnd.', { cli, cfgMgr });

    expect(cli.runList).toHaveBeenCalledTimes(1);
    expect(result.text).toContain('| Run ID | Status |');
    expect(result.text).toContain('`r1`');
    expect(result.text).toContain('SUCCEEDED');
    expect(result.text).toContain('FAILED');
  });

  it('renders "_No runs found._" when #oz.history resolves to an empty list', async () => {
    cli.runList.mockResolvedValue(makeListResult<{ id: string; status: OzRunStatus }>([]));
    const result = await expandPromptVariables('history: #oz.history', { cli, cfgMgr });
    expect(result.text).toContain('_No runs found._');
  });

  it('expands #oz.run/<id> via cli.runGet and embeds a JSON fence', async () => {
    cli.runGet.mockResolvedValue(
      makeRunResult({ runId: 'abc-123', status: 'SUCCEEDED', output: 'ok', durationMs: 500 }),
    );

    const result = await expandPromptVariables('payload:\n#oz.run/abc-123', { cli, cfgMgr });

    expect(cli.runGet).toHaveBeenCalledWith('abc-123');
    expect(result.text).toContain('```json');
    expect(result.text).toContain('"runId": "abc-123"');
    expect(result.text).toContain('"status": "SUCCEEDED"');
    expect(result.text).toContain('```');
  });

  it('truncates the run output when longer than the payload limit', async () => {
    cli.runGet.mockResolvedValue(
      makeRunResult({ runId: 'r1', status: 'SUCCEEDED', output: 'x'.repeat(3000) }),
    );
    const result = await expandPromptVariables('#oz.run/r1', { cli, cfgMgr });
    expect(result.text).toContain('chars truncated');
  });

  it('does not throw when #oz.history CLI call fails — inline error instead', async () => {
    cli.runList.mockRejectedValue(new Error('network down'));
    const result = await expandPromptVariables('#oz.history', { cli, cfgMgr });
    expect(result.text).toContain('_error resolving #oz.history: network down_');
  });

  it('resolves each unique token once even when referenced multiple times', async () => {
    cli.runList.mockResolvedValue(makeListResult<{ id: string; status: OzRunStatus }>([]));
    await expandPromptVariables('A #oz.history B #oz.history C', { cli, cfgMgr });
    expect(cli.runList).toHaveBeenCalledTimes(1);
  });

  it('ignores unrecognised tokens like #some.other', async () => {
    const result = await expandPromptVariables('Keep #some.other intact', { cli, cfgMgr });
    expect(result.text).toBe('Keep #some.other intact');
  });
});

describe('resolveToken (direct)', () => {
  it('returns the token itself for unknown patterns', async () => {
    const value = await resolveToken('#warp.unknown', { cli, cfgMgr });
    expect(value).toBe('#warp.unknown');
  });

  it('reports an invalid run id early', async () => {
    const value = await resolveToken('#oz.run/', { cli, cfgMgr });
    expect(value).toContain('invalid run id');
    expect(cli.runGet).not.toHaveBeenCalled();
  });
});
