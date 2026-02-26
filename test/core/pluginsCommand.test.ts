// IMPL: Phase 2 — /plugins command unit tests
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPluginsCommand } from '../../src/core/pluginsCommand.js';
import { PluginRegistry } from '../../src/core/pluginRegistry.js';
import type { II18nService, PluginContext } from 'copilot-chat-toolkit';
import { createMockStream, createMockToken } from '../helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockI18n(): II18nService {
  return {
    locale: 'en',
    registerCatalog: vi.fn(),
    t: vi.fn((key: string, ...args: Array<string | number>) => {
      return args.length > 0 ? `${key}[${args.join(',')}]` : key;
    }),
  };
}

function createMockPluginContext(i18n: II18nService): PluginContext {
  return {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    contextCollector: {
      gather: vi.fn(() => ({
        workspacePath: '/ws',
        activeFilePath: null,
        activeFileLanguageId: null,
        selection: null,
        diagnostics: [],
      })),
      formatForPrompt: vi.fn(() => ''),
    },
    extensionContext: {} as any,
    i18n,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('/plugins command', () => {
  let registry: PluginRegistry;
  let i18n: II18nService;
  let ctx: PluginContext;

  beforeEach(() => {
    registry = new PluginRegistry();
    i18n = createMockI18n();
    ctx = createMockPluginContext(i18n);
  });

  it('shows empty message when no plugins are registered', async () => {
    const handler = createPluginsCommand(registry, i18n);
    const { stream } = createMockStream();
    const token = createMockToken();

    await handler('', stream as any, token as any);

    expect(i18n.t).toHaveBeenCalledWith('core.plugins_empty');
    expect(stream.markdown).toHaveBeenCalledTimes(1);
  });

  it('shows table header and one row for a single plugin', async () => {
    await registry.register({
      id: 'oz',
      displayName: 'Warp Oz',
      version: '2.0.0',
      activate: vi.fn(async () => ({
        commands: new Map([['run', vi.fn()]]),
      })),
    }, ctx);

    const handler = createPluginsCommand(registry, i18n);
    const { stream } = createMockStream();
    const token = createMockToken();

    await handler('', stream as any, token as any);

    // title + header + 1 row = 3 markdown calls
    expect(stream.markdown).toHaveBeenCalledTimes(3);
    const tCalls = (i18n.t as ReturnType<typeof vi.fn>).mock.calls;
    const rowCall = tCalls.find((c: string[]) => c[0] === 'core.plugins_row');
    expect(rowCall).toBeDefined();
    expect(rowCall![1]).toBe('oz');
    expect(rowCall![2]).toBe('Warp Oz');
    expect(rowCall![3]).toBe('2.0.0');
  });

  it('shows multiple rows for multiple plugins', async () => {
    await registry.register({
      id: 'oz',
      displayName: 'Oz',
      version: '1.0.0',
      activate: vi.fn(async () => ({ commands: new Map() })),
    }, ctx);
    await registry.register({
      id: 'shell',
      displayName: 'Shell',
      version: '0.1.0',
      activate: vi.fn(async () => ({ commands: new Map() })),
    }, ctx);

    const handler = createPluginsCommand(registry, i18n);
    const { stream } = createMockStream();
    const token = createMockToken();

    await handler('', stream as any, token as any);

    // title + header + 2 rows = 4 calls
    expect(stream.markdown).toHaveBeenCalledTimes(4);
  });

  it('shows error icon for errored plugin', async () => {
    await registry.register({
      id: 'broken',
      displayName: 'Broken',
      version: '0.0.1',
      activate: vi.fn(async () => { throw new Error('boom'); }),
    }, ctx);

    const handler = createPluginsCommand(registry, i18n);
    const { stream } = createMockStream();
    const token = createMockToken();

    await handler('', stream as any, token as any);

    const tCalls = (i18n.t as ReturnType<typeof vi.fn>).mock.calls;
    const rowCall = tCalls.find((c: string[]) => c[0] === 'core.plugins_row');
    // statusIcon should be ❌ for errored plugin
    expect(rowCall![4]).toBe('❌');
  });

  it('returns empty ChatResult', async () => {
    const handler = createPluginsCommand(registry, i18n);
    const { stream } = createMockStream();
    const token = createMockToken();

    const result = await handler('', stream as any, token as any);
    expect(result).toEqual({});
  });
});
