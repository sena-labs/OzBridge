import { describe, it, expect, vi } from 'vitest';
import { fetchModelIds } from '../../src/services/modelCatalog.js';
import { createMockCli, makeListResult } from '../helpers.js';

describe('fetchModelIds', () => {
  it('extracts non-empty string ids in order', async () => {
    const cli = createMockCli();
    cli.modelList.mockResolvedValue(
      makeListResult([{ id: 'auto' }, { id: 'gpt-5-5-high' }, { id: 'claude-4-8-opus-max' }]),
    );
    expect(await fetchModelIds(cli)).toEqual(['auto', 'gpt-5-5-high', 'claude-4-8-opus-max']);
  });

  it('skips malformed entries and de-duplicates', async () => {
    const cli = createMockCli();
    cli.modelList.mockResolvedValue(
      makeListResult([
        { id: 'auto' },
        { id: '' },
        {} as unknown as { id: string },
        { id: 'auto' },
        { id: 'gpt-5-5-high' },
      ]),
    );
    expect(await fetchModelIds(cli)).toEqual(['auto', 'gpt-5-5-high']);
  });

  it('returns an empty array when no models are reported', async () => {
    const cli = createMockCli();
    cli.modelList.mockResolvedValue(makeListResult([]));
    expect(await fetchModelIds(cli)).toEqual([]);
  });

  it('propagates CLI errors', async () => {
    const cli = createMockCli();
    cli.modelList.mockRejectedValue(new Error('not logged in'));
    await expect(fetchModelIds(cli)).rejects.toThrow('not logged in');
  });
});
