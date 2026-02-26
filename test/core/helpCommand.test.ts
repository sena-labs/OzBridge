// IMPL: Phase 2 — /help command unit tests
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHelpCommand } from '../../src/core/helpCommand.js';
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

describe('/help command', () => {
  let registry: PluginRegistry;
  let i18n: II18nService;
  let ctx: PluginContext;

  beforeEach(() => {
    registry = new PluginRegistry();
    i18n = createMockI18n();
    ctx = createMockPluginContext(i18n);
  });

  // -----------------------------------------------------------------------
  // General help (no argument)
  // -----------------------------------------------------------------------
  describe('general help', () => {
    it('shows core sections when no argument', async () => {
      const handler = createHelpCommand(registry, i18n);
      const { stream } = createMockStream();
      const token = createMockToken();

      await handler('', stream as any, token as any);

      expect(i18n.t).toHaveBeenCalledWith('core.help_title');
      expect(i18n.t).toHaveBeenCalledWith('core.help_core_section');
    });

    it('lists plugin commands in general help', async () => {
      await registry.register({
        id: 'oz',
        displayName: 'Warp Oz',
        version: '1.0.0',
        activate: vi.fn(async () => ({
          commands: new Map([['run', vi.fn()], ['status', vi.fn()]]),
        })),
      }, ctx);

      const handler = createHelpCommand(registry, i18n);
      const { stream } = createMockStream();
      const token = createMockToken();

      await handler('', stream as any, token as any);

      const tCalls = (i18n.t as ReturnType<typeof vi.fn>).mock.calls;
      const sectionCall = tCalls.find((c: string[]) => c[0] === 'core.help_plugin_section');
      expect(sectionCall).toBeDefined();

      const cmdCalls = tCalls.filter((c: string[]) => c[0] === 'core.help_plugin_command');
      expect(cmdCalls).toHaveLength(2); // run + status
    });

    it('skips errored plugins in general help', async () => {
      await registry.register({
        id: 'broken',
        displayName: 'Broken',
        version: '0.1.0',
        activate: vi.fn(async () => { throw new Error('crash'); }),
      }, ctx);

      const handler = createHelpCommand(registry, i18n);
      const { stream } = createMockStream();
      const token = createMockToken();

      await handler('', stream as any, token as any);

      const tCalls = (i18n.t as ReturnType<typeof vi.fn>).mock.calls;
      const sectionCalls = tCalls.filter((c: string[]) => c[0] === 'core.help_plugin_section');
      expect(sectionCalls).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Plugin-specific help
  // -----------------------------------------------------------------------
  describe('plugin-specific help', () => {
    it('shows only specified plugin commands', async () => {
      await registry.register({
        id: 'oz',
        displayName: 'Warp Oz',
        version: '1.0.0',
        activate: vi.fn(async () => ({
          commands: new Map([['run', vi.fn()], ['status', vi.fn()], ['cloud', vi.fn()]]),
        })),
      }, ctx);

      const handler = createHelpCommand(registry, i18n);
      const { stream } = createMockStream();
      const token = createMockToken();

      await handler('oz', stream as any, token as any);

      const tCalls = (i18n.t as ReturnType<typeof vi.fn>).mock.calls;
      expect(tCalls.find((c: string[]) => c[0] === 'core.help_plugin_section')).toBeDefined();

      const cmdCalls = tCalls.filter((c: string[]) => c[0] === 'core.help_plugin_command');
      expect(cmdCalls).toHaveLength(3); // run, status, cloud
    });

    it('shows error for unknown plugin name', async () => {
      const handler = createHelpCommand(registry, i18n);
      const { stream } = createMockStream();
      const token = createMockToken();

      await handler('unknown', stream as any, token as any);

      expect(i18n.t).toHaveBeenCalledWith('core.help_plugin_not_found', 'unknown');
    });

    it('is case-insensitive for plugin name', async () => {
      await registry.register({
        id: 'oz',
        displayName: 'Warp Oz',
        version: '1.0.0',
        activate: vi.fn(async () => ({
          commands: new Map([['run', vi.fn()]]),
        })),
      }, ctx);

      const handler = createHelpCommand(registry, i18n);
      const { stream } = createMockStream();
      const token = createMockToken();

      await handler('OZ', stream as any, token as any);

      const tCalls = (i18n.t as ReturnType<typeof vi.fn>).mock.calls;
      expect(tCalls.find((c: string[]) => c[0] === 'core.help_plugin_section')).toBeDefined();
    });
  });

  it('returns empty ChatResult', async () => {
    const handler = createHelpCommand(registry, i18n);
    const { stream } = createMockStream();
    const token = createMockToken();

    const result = await handler('', stream as any, token as any);
    expect(result).toEqual({});
  });
});
