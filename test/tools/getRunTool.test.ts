import { describe, it, expect, beforeEach } from 'vitest';
import { GetRunTool } from '../../src/tools/getRunTool.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';
import { createMockCli, createMockConfigManager, makeRunResult } from '../helpers.js';
import { makeInvokeOptions, makePrepareOptions, makeToken, resultText } from './toolHelpers.js';

let cli: ReturnType<typeof createMockCli>;
let tool: GetRunTool;

beforeEach(() => {
  cli = createMockCli();
  tool = new GetRunTool(cli, createMockConfigManager());
});

describe('GetRunTool.name', () => {
  it('matches the manifest entry', () => {
    expect(GetRunTool.name).toBe('ozbridge_get_run');
  });
});

describe('GetRunTool.prepareInvocation', () => {
  it('returns an invocation message mentioning the run id', async () => {
    const prepared = await tool.prepareInvocation(makePrepareOptions({ runId: 'run-123' }), makeToken());
    const msg = (prepared.invocationMessage as unknown as { value: string }).value;
    expect(msg).toContain('run-123');
  });
});

describe('GetRunTool.invoke', () => {
  it('rejects empty runId', async () => {
    const result = await tool.invoke(makeInvokeOptions({ runId: '   ' }), makeToken());
    expect(resultText(result)).toContain('Missing input');
    expect(cli.runGet).not.toHaveBeenCalled();
  });

  it('calls runGet with the trimmed id and renders the result', async () => {
    cli.runGet.mockResolvedValue(makeRunResult({ runId: 'run-abc', status: 'SUCCEEDED', output: 'output' }));

    const result = await tool.invoke(makeInvokeOptions({ runId: '  run-abc ' }), makeToken());

    expect(cli.runGet).toHaveBeenCalledWith('run-abc');
    const text = resultText(result);
    expect(text).toContain('run-abc');
    expect(text).toContain('SUCCEEDED');
    expect(text).toContain('output');
  });

  it('propagates CLI errors with actionable hints', async () => {
    cli.runGet.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_FOUND, 'oz missing'));

    const result = await tool.invoke(makeInvokeOptions({ runId: 'run-1' }), makeToken());
    const text = resultText(result);
    expect(text).toContain('NOT_FOUND');
    expect(text).toContain('Install Warp');
  });
});
