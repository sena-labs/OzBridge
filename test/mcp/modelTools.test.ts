import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildToolRegistry, McpToolResult } from '../../src/mcp/tools.js';
import { createMockCli, createMockConfigManager, makeListResult } from '../helpers.js';
import { parseFlatYaml } from '../../src/services/yamlParser.js';

function textOf(result: McpToolResult): string {
  return result.content.map((c) => c.text).join('\n');
}

let workspaceRoot: string;
beforeEach(() => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ozbridge-model-'));
});
afterEach(() => {
  try { fs.rmSync(workspaceRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

function yamlModel(): string | undefined {
  const file = path.join(workspaceRoot, '.warp', 'warp-bridge.yaml');
  if (!fs.existsSync(file)) { return undefined; }
  return parseFlatYaml(fs.readFileSync(file, 'utf8')).data.defaultModel as string | undefined;
}

describe('oz_list_models', () => {
  it('returns the available ids plus the current default', async () => {
    const cli = createMockCli();
    cli.modelList.mockResolvedValue(makeListResult([{ id: 'auto' }, { id: 'gpt-5-5-high' }]));
    const registry = buildToolRegistry({ cli, cfgMgr: createMockConfigManager({ defaultModel: 'gpt-5-5-high' }), workspaceRoot });

    const res = await registry.get('oz_list_models')!.invoke({});
    const payload = JSON.parse(textOf(res));
    expect(payload.models).toEqual(['auto', 'gpt-5-5-high']);
    expect(payload.current).toBe('gpt-5-5-high');
    expect(payload.count).toBe(2);
  });
});

describe('oz_set_default_model', () => {
  it('validates against the catalog and writes the workspace override', async () => {
    const cli = createMockCli();
    cli.modelList.mockResolvedValue(makeListResult([{ id: 'auto' }, { id: 'claude-4-8-opus-max' }]));
    const registry = buildToolRegistry({ cli, cfgMgr: createMockConfigManager(), workspaceRoot });

    const res = await registry.get('oz_set_default_model')!.invoke({ model: 'claude-4-8-opus-max' });
    expect(res.isError).toBeUndefined();
    expect(yamlModel()).toBe('claude-4-8-opus-max');
  });

  it('rejects an unknown model id without writing', async () => {
    const cli = createMockCli();
    cli.modelList.mockResolvedValue(makeListResult([{ id: 'auto' }]));
    const registry = buildToolRegistry({ cli, cfgMgr: createMockConfigManager(), workspaceRoot });

    const res = await registry.get('oz_set_default_model')!.invoke({ model: 'gpt-nope' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("Unknown model 'gpt-nope'");
    expect(yamlModel()).toBeUndefined();
  });

  it('errors when no workspace root is configured', async () => {
    const cli = createMockCli();
    cli.modelList.mockResolvedValue(makeListResult([{ id: 'auto' }]));
    const registry = buildToolRegistry({ cli, cfgMgr: createMockConfigManager() }); // no workspaceRoot

    const res = await registry.get('oz_set_default_model')!.invoke({ model: 'auto' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('no workspace root');
  });

  it('still writes when the catalog is unreachable (best-effort validation)', async () => {
    const cli = createMockCli();
    cli.modelList.mockRejectedValue(new Error('not logged in'));
    const registry = buildToolRegistry({ cli, cfgMgr: createMockConfigManager(), workspaceRoot });

    const res = await registry.get('oz_set_default_model')!.invoke({ model: 'claude-4-6-sonnet-high' });
    expect(res.isError).toBeUndefined();
    expect(yamlModel()).toBe('claude-4-6-sonnet-high');
  });
});
