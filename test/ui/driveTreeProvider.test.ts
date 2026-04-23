import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OzDriveTreeProvider, DriveTreeNode } from '../../src/ui/driveTreeProvider.js';
import { DriveCategory, IDriveSource, DrivePrompt, DriveRule, DriveSkill } from '../../src/drive/warpDriveSource.js';

function makeSource(overrides: Partial<IDriveSource> = {}): IDriveSource {
  return {
    label: 'fake',
    listPrompts: vi.fn(async () => []),
    listRules: vi.fn(async () => []),
    listSkills: vi.fn(async () => []),
    read: vi.fn(async () => ''),
    ...overrides,
  } as IDriveSource;
}

function findCategory(nodes: DriveTreeNode[], category: DriveCategory): DriveTreeNode {
  const node = nodes.find((n) => n.kind === 'category' && n.category === category);
  if (!node) { throw new Error(`missing category ${category}`); }
  return node;
}

describe('OzDriveTreeProvider', () => {
  let source: IDriveSource;
  let provider: OzDriveTreeProvider;

  beforeEach(() => {
    source = makeSource();
    provider = new OzDriveTreeProvider(source);
  });

  it('exposes the 3 top-level categories in a stable order', async () => {
    const roots = await provider.getChildren();
    expect(roots.map((n) => n.id)).toEqual([
      'category:prompt',
      'category:rule',
      'category:skill',
    ]);
  });

  it('shows an empty-category message when the source returns []', async () => {
    const roots = await provider.getChildren();
    const children = await provider.getChildren(findCategory(roots, 'prompt'));
    expect(children).toHaveLength(1);
    expect(children[0].kind).toBe('message');
    expect(children[0].label).toContain('No prompts');
  });

  it('renders entries from each category', async () => {
    source = makeSource({
      listPrompts: vi.fn(async () => [
        { id: 'p1', category: 'prompt', name: 'Deploy', source: 'cli' } as DrivePrompt,
      ]),
      listRules: vi.fn(async () => [
        { id: 'r1', category: 'rule', name: 'no-todo', source: 'filesystem' } as DriveRule,
      ]),
      listSkills: vi.fn(async () => [
        { id: 's1', category: 'skill', name: '5-test', source: 'filesystem' } as DriveSkill,
      ]),
    });
    provider = new OzDriveTreeProvider(source);
    const roots = await provider.getChildren();
    const prompts = await provider.getChildren(findCategory(roots, 'prompt'));
    const rules = await provider.getChildren(findCategory(roots, 'rule'));
    const skills = await provider.getChildren(findCategory(roots, 'skill'));
    expect(prompts.map((e) => (e as any).entry?.name)).toEqual(['Deploy']);
    expect(rules.map((e) => (e as any).entry?.name)).toEqual(['no-todo']);
    expect(skills.map((e) => (e as any).entry?.name)).toEqual(['5-test']);
  });

  it('surfaces load errors as message nodes', async () => {
    source = makeSource({
      listPrompts: vi.fn(async () => { throw new Error('network down'); }),
    });
    provider = new OzDriveTreeProvider(source);
    const roots = await provider.getChildren();
    const children = await provider.getChildren(findCategory(roots, 'prompt'));
    expect(children).toHaveLength(1);
    expect(children[0].kind).toBe('message');
    expect(children[0].label).toContain('network down');
  });

  it('caches the per-category listing until refresh()', async () => {
    source = makeSource({
      listPrompts: vi.fn(async () => [
        { id: 'p1', category: 'prompt', name: 'A', source: 'cli' } as DrivePrompt,
      ]),
    });
    provider = new OzDriveTreeProvider(source);
    const roots = await provider.getChildren();
    await provider.getChildren(findCategory(roots, 'prompt'));
    await provider.getChildren(findCategory(roots, 'prompt'));
    expect(source.listPrompts).toHaveBeenCalledTimes(1);
    provider.refresh();
    await provider.getChildren(findCategory(roots, 'prompt'));
    expect(source.listPrompts).toHaveBeenCalledTimes(2);
  });

  it('getTreeItem assigns the expected contextValue per node', async () => {
    source = makeSource({
      listSkills: vi.fn(async () => [
        { id: 's1', category: 'skill', name: '5-test', source: 'filesystem' } as DriveSkill,
      ]),
    });
    provider = new OzDriveTreeProvider(source);
    const roots = await provider.getChildren();
    const skillCat = findCategory(roots, 'skill');
    expect(provider.getTreeItem(skillCat).contextValue).toBe('warpDriveCategory:skill');
    const [entryNode] = await provider.getChildren(skillCat);
    expect(provider.getTreeItem(entryNode).contextValue).toBe('warpDriveSkill');
  });

  it('shows category source mode after loading children', async () => {
    source = makeSource({
      listPrompts: vi.fn(async () => [
        { id: 'p1', category: 'prompt', name: 'Deploy', source: 'cli' } as DrivePrompt,
      ]),
      listRules: vi.fn(async () => [
        { id: 'r1', category: 'rule', name: 'rule-a', source: 'filesystem' } as DriveRule,
      ]),
      listSkills: vi.fn(async () => [
        { id: 's1', category: 'skill', name: 'skill-a', source: 'cli' } as DriveSkill,
        { id: 's2', category: 'skill', name: 'skill-b', source: 'filesystem' } as DriveSkill,
      ]),
    });
    provider = new WarpDriveTreeProvider(source);

    const roots = await provider.getChildren();
    const promptCat = findCategory(roots, 'prompt');
    const ruleCat = findCategory(roots, 'rule');
    const skillCat = findCategory(roots, 'skill');

    await provider.getChildren(promptCat);
    await provider.getChildren(ruleCat);
    await provider.getChildren(skillCat);

    expect(provider.getTreeItem(promptCat).description).toBe('cli');
    expect(provider.getTreeItem(ruleCat).description).toBe('filesystem');
    expect(provider.getTreeItem(skillCat).description).toBe('mixed');
  });

  it('refresh() fires onDidChangeTreeData', () => {
    const fired = vi.fn();
    provider.onDidChangeTreeData(fired);
    provider.refresh();
    expect(fired).toHaveBeenCalledTimes(1);
  });
});
