import { describe, it, expect, vi } from 'vitest';
import { OzCliDriveRunner } from '../../src/drive/ozCliDriveRunner.js';
import type { IOzCliService } from '../../src/types/index.js';

function makeCliStub(overrides: Partial<IOzCliService> = {}): IOzCliService {
  const stub: Partial<IOzCliService> = {
    driveList: vi.fn().mockResolvedValue([]),
    driveGet: vi.fn().mockResolvedValue(''),
    ...overrides,
  };
  return stub as IOzCliService;
}

describe('OzCliDriveRunner', () => {
  it('list() forwards the category to driveList()', async () => {
    const driveList = vi.fn().mockResolvedValue([{ id: 'p1' }]);
    const runner = new OzCliDriveRunner(makeCliStub({ driveList }));

    const result = await runner.list('prompt');

    expect(driveList).toHaveBeenCalledWith('prompt');
    expect(result).toEqual([{ id: 'p1' }]);
  });

  it('list() returns the runner payload unchanged for { items: [...] } shape', async () => {
    const payload = { items: [{ id: 'r1' }, { id: 'r2' }] };
    const driveList = vi.fn().mockResolvedValue(payload);
    const runner = new OzCliDriveRunner(makeCliStub({ driveList }));

    const result = await runner.list('rule');

    expect(driveList).toHaveBeenCalledWith('rule');
    expect(result).toBe(payload);
  });

  it('get() forwards the id to driveGet()', async () => {
    const driveGet = vi.fn().mockResolvedValue('# markdown body');
    const runner = new OzCliDriveRunner(makeCliStub({ driveGet }));

    const body = await runner.get('skill_42');

    expect(driveGet).toHaveBeenCalledWith('skill_42');
    expect(body).toBe('# markdown body');
  });

  it('list() propagates errors from the underlying CLI unchanged', async () => {
    const error = new Error('boom');
    const driveList = vi.fn().mockRejectedValue(error);
    const runner = new OzCliDriveRunner(makeCliStub({ driveList }));

    await expect(runner.list('skill')).rejects.toBe(error);
  });

  it('get() propagates errors from the underlying CLI unchanged', async () => {
    const error = new Error('not authenticated');
    const driveGet = vi.fn().mockRejectedValue(error);
    const runner = new OzCliDriveRunner(makeCliStub({ driveGet }));

    await expect(runner.get('p1')).rejects.toBe(error);
  });
});
