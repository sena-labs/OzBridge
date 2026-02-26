// IMPL: Phase 2 — /config command unit tests
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createConfigCommand } from '../../src/core/configCommand.js';
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

describe('/config command', () => {
  let registry: PluginRegistry;
  let i18n: II18nService;
  let ctx: PluginContext;

  beforeEach(() => {
    registry = new PluginRegistry();
    i18n = createMockI18n();
    ctx = createMockPluginContext(i18n);
  });

  it('shows title and empty message when no plugins', async () => {
    const handler = createConfigCommand(registry, i18n);
    const { stream } = createMockStream();
    const token = createMockToken();

    await handler('', stream as any, token as any);

    expect(i18n.t).toHaveBeenCalledWith('core.config_title');
    expect(i18n.t).toHaveBeenCalledWith('core.plugins_empty');
    expect(stream.markdown).toHaveBeenCalledTimes(2);
  });

  it('shows config summary from plugin', async () => {
    await registry.register({
      id: 'oz',
      displayName: 'Warp Oz',
      version: '1.0.0',
      activate: vi.fn(async () => ({
        commands: new Map([['run', vi.fn()]]),
        configSummary: () => 'Timeout: 30s\nProfile: default',
      })),
    }, ctx);

    const handler = createConfigCommand(registry, i18n);
    const { stream } = createMockStream();
    const token = createMockToken();

    await handler('', stream as any, token as any);

    const tCalls = (i18n.t as ReturnType<typeof vi.fn>).mock.calls;
    const sectionCall = tCalls.find((c: string[]) => c[0] === 'core.config_plugin_section');
    expect(sectionCall).toBeDefined();
    expect(sectionCall![1]).toBe('Warp Oz');
    expect(sectionCall![2]).toBe('oz');
    expect(sectionCall![3]).toBe('Timeout: 30s\nProfile: default');
  });

  it('shows "no summary" when plugin has no configSummary', async () => {
    await registry.register({
      id: 'shell',
      displayName: 'Shell',
      version: '1.0.0',
      activate: vi.fn(async () => ({
        commands: new Map([['exec', vi.fn()]]),
        // no configSummary
      })),
    }, ctx);

    const handler = createConfigCommand(registry, i18n);
    const { stream } = createMockStream();
    const token = createMockToken();

    await handler('', stream as any, token as any);

    const tCalls = (i18n.t as ReturnType<typeof vi.fn>).mock.calls;
    // Check that config_no_summary was called as fallback
    const noSummaryCall = tCalls.find((c: string[]) => c[0] === 'core.config_no_summary');
    expect(noSummaryCall).toBeDefined();
  });

  it('shows sections for multiple plugins', async () => {
    await registry.register({
      id: 'oz',
      displayName: 'Oz',
      version: '1.0.0',
      activate: vi.fn(async () => ({
        commands: new Map(),
        configSummary: () => 'Oz config',
      })),
    }, ctx);
    await registry.register({
      id: 'shell',
      displayName: 'Shell',
      version: '1.0.0',
      activate: vi.fn(async () => ({
        commands: new Map(),
        configSummary: () => 'Shell config',
      })),
    }, ctx);

    const handler = createConfigCommand(registry, i18n);
    const { stream } = createMockStream();
    const token = createMockToken();

    await handler('', stream as any, token as any);

    // title + 2 plugin sections = 3 markdown calls
    expect(stream.markdown).toHaveBeenCalledTimes(3);
  });

  it('returns empty ChatResult', async () => {
    const handler = createConfigCommand(registry, i18n);
    const { stream } = createMockStream();
    const token = createMockToken();

    const result = await handler('', stream as any, token as any);
    expect(result).toEqual({});
  });
});
