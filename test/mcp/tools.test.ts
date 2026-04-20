import { describe, it, expect, beforeEach } from 'vitest';
import { buildToolRegistry } from '../../src/mcp/tools.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';
import type { OzRunStatus } from '../../src/types/index.js';
import {
  createMockCli,
  createMockConfigManager,
  makeListResult,
  makeRunResult,
} from '../helpers.js';

let cli: ReturnType<typeof createMockCli>;
let registry: ReturnType<typeof buildToolRegistry>;

beforeEach(() => {
  cli = createMockCli();
  registry = buildToolRegistry({ cli, cfgMgr: createMockConfigManager() });
});

describe('buildToolRegistry — descriptors', () => {
  it('exposes exactly the 4 MCP tools', () => {
    expect([...registry.keys()].sort()).toEqual([
      'oz_agent_run',
      'oz_agent_run_cloud',
      'oz_run_get',
      'oz_run_list',
    ]);
  });

  it('each descriptor declares a valid JSON-schema-shaped inputSchema', () => {
    for (const entry of registry.values()) {
      expect(entry.descriptor.inputSchema.type).toBe('object');
      expect(typeof entry.descriptor.name).toBe('string');
      expect(typeof entry.descriptor.description).toBe('string');
      expect(entry.descriptor.description.length).toBeGreaterThan(10);
    }
  });

  it('mandatory params are marked via `required`', () => {
    expect(registry.get('oz_agent_run')!.descriptor.inputSchema.required).toEqual(['prompt']);
    expect(registry.get('oz_agent_run_cloud')!.descriptor.inputSchema.required).toEqual(['prompt']);
    expect(registry.get('oz_run_get')!.descriptor.inputSchema.required).toEqual(['runId']);
    expect(registry.get('oz_run_list')!.descriptor.inputSchema.required).toBeUndefined();
  });
});

describe('oz_agent_run', () => {
  it('executes agentRun and returns a JSON text block', async () => {
    cli.agentRun.mockResolvedValue(makeRunResult({ output: 'done' }));
    const result = await registry.get('oz_agent_run')!.invoke({ prompt: 'hello' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('"status": "SUCCEEDED"');
    expect(result.content[0].text).toContain('"output": "done"');
  });

  it('rejects missing prompt with isError=true', async () => {
    const result = await registry.get('oz_agent_run')!.invoke({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('missing or non-string field: prompt');
  });

  it('surfaces OzCliError with its kind and stderr snippet', async () => {
    cli.agentRun.mockRejectedValue(
      new OzCliError(OzCliErrorKind.NOT_AUTHENTICATED, 'oz login required', 1, 'stderr here'),
    );
    const result = await registry.get('oz_agent_run')!.invoke({ prompt: 'x' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('NOT_AUTHENTICATED');
    expect(result.content[0].text).toContain('stderr here');
  });
});

describe('oz_run_get', () => {
  it('calls runGet with the trimmed id', async () => {
    cli.runGet.mockResolvedValue(makeRunResult({ runId: 'abc', status: 'SUCCEEDED' }));
    const result = await registry.get('oz_run_get')!.invoke({ runId: '  abc  ' });
    expect(cli.runGet).toHaveBeenCalledWith('abc');
    expect(result.content[0].text).toContain('"runId": "abc"');
  });

  it('rejects empty/whitespace runId', async () => {
    const result = await registry.get('oz_run_get')!.invoke({ runId: '   ' });
    expect(result.isError).toBe(true);
    expect(cli.runGet).not.toHaveBeenCalled();
  });
});

describe('oz_run_list', () => {
  it('returns a filtered list with count + items', async () => {
    cli.runList.mockResolvedValue(
      makeListResult<{ id: string; status: OzRunStatus }>([
        { id: 'a', status: 'QUEUED' },
        { id: 'b', status: 'SUCCEEDED' },
        { id: 'c', status: 'FAILED' },
      ]),
    );
    const result = await registry.get('oz_run_list')!.invoke({ status: 'completed' });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.filter).toBe('completed');
    expect(payload.count).toBe(2);
    expect(payload.items.map((r: any) => r.id)).toEqual(['b', 'c']);
  });

  it('applies limit after filtering', async () => {
    cli.runList.mockResolvedValue(
      makeListResult<{ id: string; status: OzRunStatus }>([
        { id: 'a', status: 'SUCCEEDED' },
        { id: 'b', status: 'SUCCEEDED' },
        { id: 'c', status: 'SUCCEEDED' },
      ]),
    );
    const result = await registry.get('oz_run_list')!.invoke({ status: 'completed', limit: 2 });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.count).toBe(2);
    expect(payload.items.map((r: any) => r.id)).toEqual(['a', 'b']);
  });
});
