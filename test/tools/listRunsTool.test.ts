import { describe, it, expect, beforeEach } from 'vitest';
import { ListRunsTool } from '../../src/tools/listRunsTool.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';
import type { OzRunStatus } from '../../src/types/index.js';
import { createMockCli, makeListResult } from '../helpers.js';
import { makeInvokeOptions, makePrepareOptions, makeToken, resultText } from './toolHelpers.js';

let cli: ReturnType<typeof createMockCli>;
let tool: ListRunsTool;

beforeEach(() => {
  cli = createMockCli();
  tool = new ListRunsTool(cli);
});

describe('ListRunsTool.name', () => {
  it('matches the manifest entry', () => {
    expect(ListRunsTool.name).toBe('oz_list_runs');
  });
});

describe('ListRunsTool.prepareInvocation', () => {
  it('exposes the current filter in the message', async () => {
    const prepared = await tool.prepareInvocation(
      makePrepareOptions({ status: 'completed' }),
      makeToken(),
    );
    const msg = (prepared.invocationMessage as unknown as { value: string }).value;
    expect(msg).toContain('completed');
  });
});

describe('ListRunsTool.invoke', () => {
  it('returns a friendly "no runs" message when list is empty', async () => {
    cli.runList.mockResolvedValue(makeListResult<{ id: string; status: OzRunStatus }>([]));

    const result = await tool.invoke(makeInvokeOptions({}), makeToken());

    expect(resultText(result)).toContain('No runs found');
  });

  it('falls back to rawText when parser produced none but raw output is present', async () => {
    cli.runList.mockResolvedValue(
      makeListResult<{ id: string; status: OzRunStatus }>([], 'no structured data'),
    );

    const result = await tool.invoke(makeInvokeOptions({}), makeToken());
    expect(resultText(result)).toContain('no structured data');
  });

  it('renders all runs when status=all (default)', async () => {
    cli.runList.mockResolvedValue(
      makeListResult<{ id: string; status: OzRunStatus }>([
        { id: 'r1', status: 'QUEUED' },
        { id: 'r2', status: 'SUCCEEDED' },
        { id: 'r3', status: 'FAILED' },
      ]),
    );

    const result = await tool.invoke(makeInvokeOptions({}), makeToken());
    const text = resultText(result);
    expect(text).toContain('r1');
    expect(text).toContain('r2');
    expect(text).toContain('r3');
    expect(text).toContain('3 runs');
  });

  it('filters by `active` alias (QUEUED + INPROGRESS)', async () => {
    cli.runList.mockResolvedValue(
      makeListResult<{ id: string; status: OzRunStatus }>([
        { id: 'a', status: 'QUEUED' },
        { id: 'b', status: 'INPROGRESS' },
        { id: 'c', status: 'SUCCEEDED' },
      ]),
    );

    const result = await tool.invoke(makeInvokeOptions({ status: 'active' }), makeToken());
    const text = resultText(result);
    expect(text).toContain('a');
    expect(text).toContain('b');
    expect(text).not.toContain('| `c`');
  });

  it('filters by `completed` alias (SUCCEEDED + FAILED)', async () => {
    cli.runList.mockResolvedValue(
      makeListResult<{ id: string; status: OzRunStatus }>([
        { id: 'a', status: 'QUEUED' },
        { id: 'b', status: 'SUCCEEDED' },
        { id: 'c', status: 'FAILED' },
      ]),
    );

    const result = await tool.invoke(makeInvokeOptions({ status: 'completed' }), makeToken());
    const text = resultText(result);
    expect(text).not.toContain('| `a`');
    expect(text).toContain('b');
    expect(text).toContain('c');
  });

  it('filters by a specific OzRunStatus value', async () => {
    cli.runList.mockResolvedValue(
      makeListResult<{ id: string; status: OzRunStatus }>([
        { id: 'a', status: 'SUCCEEDED' },
        { id: 'b', status: 'FAILED' },
      ]),
    );

    const result = await tool.invoke(makeInvokeOptions({ status: 'FAILED' }), makeToken());
    const text = resultText(result);
    expect(text).not.toContain('| `a`');
    expect(text).toContain('b');
  });

  it('applies the limit option after filtering', async () => {
    cli.runList.mockResolvedValue(
      makeListResult<{ id: string; status: OzRunStatus }>([
        { id: 'r1', status: 'SUCCEEDED' },
        { id: 'r2', status: 'SUCCEEDED' },
        { id: 'r3', status: 'SUCCEEDED' },
      ]),
    );

    const result = await tool.invoke(
      makeInvokeOptions({ status: 'completed', limit: 2 }),
      makeToken(),
    );
    const text = resultText(result);
    expect(text).toContain('2 runs');
    expect(text).toContain('r1');
    expect(text).toContain('r2');
    expect(text).not.toContain('| `r3`');
  });

  it('returns "no runs match" when filter yields nothing', async () => {
    cli.runList.mockResolvedValue(
      makeListResult<{ id: string; status: OzRunStatus }>([{ id: 'r1', status: 'SUCCEEDED' }]),
    );

    const result = await tool.invoke(makeInvokeOptions({ status: 'FAILED' }), makeToken());
    expect(resultText(result)).toContain('No runs match');
  });

  it('surfaces CLI errors with hint', async () => {
    cli.runList.mockRejectedValue(new OzCliError(OzCliErrorKind.NOT_FOUND, 'oz missing'));

    const result = await tool.invoke(makeInvokeOptions({}), makeToken());
    expect(resultText(result)).toContain('NOT_FOUND');
    expect(resultText(result)).toContain('Install Warp');
  });
});
