// IMPL: Phase 2 — HierarchicalRouter unit tests (§3.4 Architecture)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HierarchicalRouter, parseSubcommand } from '../../src/core/hierarchicalRouter.js';
import { PluginRegistry } from '../../src/core/pluginRegistry.js';
import type { SlashCommandHandler, II18nService, PluginContext } from 'copilot-chat-toolkit';
import { createMockStream, createMockToken } from '../helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockI18n(): II18nService {
  return {
    locale: 'en',
    registerCatalog: vi.fn(),
    t: vi.fn((_key: string, ...args: Array<string | number>) => {
      // Return key + args for assertion (simple stub)
      return args.length > 0 ? `${_key}[${args.join(',')}]` : _key;
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
// parseSubcommand
// ---------------------------------------------------------------------------
describe('parseSubcommand', () => {
  it('returns empty sub and prompt for empty input', () => {
    expect(parseSubcommand('')).toEqual({ sub: '', actualPrompt: '' });
  });

  it('returns empty sub and prompt for whitespace-only input', () => {
    expect(parseSubcommand('   ')).toEqual({ sub: '', actualPrompt: '' });
  });

  it('extracts first token as sub', () => {
    const result = parseSubcommand('run implement auth');
    expect(result.sub).toBe('run');
    expect(result.actualPrompt).toBe('implement auth');
  });

  it('handles single word', () => {
    const result = parseSubcommand('status');
    expect(result.sub).toBe('status');
    expect(result.actualPrompt).toBe('');
  });

  it('collapses multiple spaces', () => {
    const result = parseSubcommand('run   some   prompt');
    expect(result.sub).toBe('run');
    expect(result.actualPrompt).toBe('some prompt');
  });
});

// ---------------------------------------------------------------------------
// HierarchicalRouter
// ---------------------------------------------------------------------------
describe('HierarchicalRouter', () => {
  let registry: PluginRegistry;
  let i18n: II18nService;
  let ctx: PluginContext;
  let coreCommands: Map<string, SlashCommandHandler>;

  beforeEach(() => {
    registry = new PluginRegistry();
    i18n = createMockI18n();
    ctx = createMockPluginContext(i18n);
    coreCommands = new Map();
  });

  function makeRequest(command: string, prompt = ''): any {
    return { command: command || undefined, prompt };
  }

  // -----------------------------------------------------------------------
  // 1) Welcome — no command
  // -----------------------------------------------------------------------
  describe('welcome (no command)', () => {
    it('shows welcome message when no command is given', async () => {
      const router = new HierarchicalRouter(registry, coreCommands, i18n);
      const handler = router.createHandler();
      const { stream } = createMockStream();
      const token = createMockToken();

      const result = await handler(makeRequest(''), {} as any, stream as any, token as any);
      expect(stream.markdown).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('lists active plugins in welcome', async () => {
      // Register a plugin
      await registry.register({
        id: 'oz',
        displayName: 'Warp Oz',
        version: '1.0.0',
        activate: vi.fn(async () => ({
          commands: new Map([['run', vi.fn()]]),
        })),
      }, ctx);

      const router = new HierarchicalRouter(registry, coreCommands, i18n);
      const handler = router.createHandler();
      const { stream } = createMockStream();
      const token = createMockToken();

      await handler(makeRequest(''), {} as any, stream as any, token as any);
      // i18n.t should have been called with welcome_plugin_item
      const tCalls = (i18n.t as ReturnType<typeof vi.fn>).mock.calls;
      const pluginItemCall = tCalls.find((c: string[]) => c[0] === 'core.welcome_plugin_item');
      expect(pluginItemCall).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // 2) Core command dispatch
  // -----------------------------------------------------------------------
  describe('core command dispatch', () => {
    it('dispatches to core handler when command matches', async () => {
      const pluginsHandler = vi.fn(async () => ({ metadata: { tested: true } }));
      coreCommands.set('plugins', pluginsHandler);

      const router = new HierarchicalRouter(registry, coreCommands, i18n);
      const handler = router.createHandler();
      const { stream } = createMockStream();
      const token = createMockToken();

      const result = await handler(makeRequest('plugins', ''), {} as any, stream as any, token as any);
      expect(pluginsHandler).toHaveBeenCalledWith('', expect.anything(), expect.anything());
      expect(result.metadata).toHaveProperty('command', 'plugins');
    });

    it('passes prompt to core handler', async () => {
      const helpHandler = vi.fn(async () => ({}));
      coreCommands.set('help', helpHandler);

      const router = new HierarchicalRouter(registry, coreCommands, i18n);
      const handler = router.createHandler();
      const { stream } = createMockStream();
      const token = createMockToken();

      await handler(makeRequest('help', 'oz'), {} as any, stream as any, token as any);
      expect(helpHandler).toHaveBeenCalledWith('oz', expect.anything(), expect.anything());
    });
  });

  // -----------------------------------------------------------------------
  // 3) Plugin namespace dispatch
  // -----------------------------------------------------------------------
  describe('plugin namespace dispatch', () => {
    it('dispatches to plugin subcommand', async () => {
      const runHandler = vi.fn(async () => ({ metadata: { agent: 'oz' } }));
      await registry.register({
        id: 'oz',
        displayName: 'Warp Oz',
        version: '1.0.0',
        activate: vi.fn(async () => ({
          commands: new Map([['run', runHandler]]),
        })),
      }, ctx);

      const router = new HierarchicalRouter(registry, coreCommands, i18n);
      const handler = router.createHandler();
      const { stream } = createMockStream();
      const token = createMockToken();

      const result = await handler(makeRequest('oz', 'run my prompt'), {} as any, stream as any, token as any);
      expect(runHandler).toHaveBeenCalledWith('my prompt', expect.anything(), expect.anything());
      expect(result.metadata).toHaveProperty('namespace', 'oz');
      expect(result.metadata).toHaveProperty('subcommand', 'run');
    });

    it('shows plugin help when no subcommand', async () => {
      await registry.register({
        id: 'shell',
        displayName: 'Shell',
        version: '1.0.0',
        activate: vi.fn(async () => ({
          commands: new Map([['exec', vi.fn()]]),
        })),
      }, ctx);

      const router = new HierarchicalRouter(registry, coreCommands, i18n);
      const handler = router.createHandler();
      const { stream } = createMockStream();
      const token = createMockToken();

      await handler(makeRequest('shell', ''), {} as any, stream as any, token as any);
      // Should call i18n.t with help_plugin_section
      const tCalls = (i18n.t as ReturnType<typeof vi.fn>).mock.calls;
      const sectionCall = tCalls.find((c: string[]) => c[0] === 'core.help_plugin_section');
      expect(sectionCall).toBeDefined();
    });

    it('shows error for unknown subcommand', async () => {
      await registry.register({
        id: 'oz',
        displayName: 'Warp Oz',
        version: '1.0.0',
        activate: vi.fn(async () => ({
          commands: new Map([['run', vi.fn()]]),
        })),
      }, ctx);

      const router = new HierarchicalRouter(registry, coreCommands, i18n);
      const handler = router.createHandler();
      const { stream } = createMockStream();
      const token = createMockToken();

      await handler(makeRequest('oz', 'badcmd arg'), {} as any, stream as any, token as any);
      const tCalls = (i18n.t as ReturnType<typeof vi.fn>).mock.calls;
      const errCall = tCalls.find((c: string[]) => c[0] === 'core.subcommand_not_found');
      expect(errCall).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // 4) Unknown command
  // -----------------------------------------------------------------------
  describe('unknown command', () => {
    it('shows error for completely unknown command', async () => {
      const router = new HierarchicalRouter(registry, coreCommands, i18n);
      const handler = router.createHandler();
      const { stream } = createMockStream();
      const token = createMockToken();

      await handler(makeRequest('garbage'), {} as any, stream as any, token as any);
      const tCalls = (i18n.t as ReturnType<typeof vi.fn>).mock.calls;
      const errCall = tCalls.find((c: string[]) => c[0] === 'core.plugin_not_found');
      expect(errCall).toBeDefined();
    });

    it('does not dispatch to errored plugin', async () => {
      await registry.register({
        id: 'broken',
        displayName: 'Broken',
        version: '0.1.0',
        activate: vi.fn(async () => { throw new Error('crash'); }),
      }, ctx);

      const router = new HierarchicalRouter(registry, coreCommands, i18n);
      const handler = router.createHandler();
      const { stream } = createMockStream();
      const token = createMockToken();

      await handler(makeRequest('broken', 'run'), {} as any, stream as any, token as any);
      const tCalls = (i18n.t as ReturnType<typeof vi.fn>).mock.calls;
      const errCall = tCalls.find((c: string[]) => c[0] === 'core.plugin_not_found');
      expect(errCall).toBeDefined();
    });
  });
});
