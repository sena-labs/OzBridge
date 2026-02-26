// IMPL: Phase 2 — PluginRegistry unit tests (§3.3 Architecture)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginRegistry } from '../../src/core/pluginRegistry.js';
import type {
  IPlugin,
  PluginContext,
  PluginRegistration,
} from 'copilot-chat-toolkit';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockPluginContext(): PluginContext {
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
    i18n: { locale: 'en', registerCatalog: vi.fn(), t: vi.fn((k: string) => k) },
  };
}

function createMockPlugin(id: string, overrides?: Partial<IPlugin>): IPlugin {
  return {
    id,
    displayName: id.toUpperCase(),
    version: '1.0.0',
    activate: vi.fn(async (): Promise<PluginRegistration> => ({
      commands: new Map([['status', vi.fn()]]),
    })),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PluginRegistry', () => {
  let registry: PluginRegistry;
  let ctx: PluginContext;

  beforeEach(() => {
    registry = new PluginRegistry();
    ctx = createMockPluginContext();
  });

  // -------------------------------------------------------------------------
  // register
  // -------------------------------------------------------------------------
  describe('register', () => {
    it('registers a plugin successfully', async () => {
      const plugin = createMockPlugin('oz');
      await registry.register(plugin, ctx);

      const info = registry.get('oz');
      expect(info).toBeDefined();
      expect(info!.status).toBe('active');
      expect(info!.plugin).toBe(plugin);
      expect(info!.source).toBe('builtin');
    });

    it('calls plugin.activate with the provided context', async () => {
      const plugin = createMockPlugin('shell');
      await registry.register(plugin, ctx);
      expect(plugin.activate).toHaveBeenCalledWith(ctx);
    });

    it('accepts source parameter', async () => {
      const plugin = createMockPlugin('ext');
      await registry.register(plugin, ctx, 'external');
      expect(registry.get('ext')!.source).toBe('external');
    });

    it('throws on duplicate plugin id', async () => {
      const p1 = createMockPlugin('dup');
      const p2 = createMockPlugin('dup');
      await registry.register(p1, ctx);
      await expect(registry.register(p2, ctx)).rejects.toThrow('already registered');
    });

    it('stores plugin with error status when activate() throws', async () => {
      const broken = createMockPlugin('broken', {
        activate: vi.fn(async () => { throw new Error('boom'); }),
      });
      await registry.register(broken, ctx);

      const info = registry.get('broken');
      expect(info).toBeDefined();
      expect(info!.status).toBe('error');
      expect(info!.error).toBe('boom');
    });

    it('stores empty commands map for errored plugin', async () => {
      const broken = createMockPlugin('broken', {
        activate: vi.fn(async () => { throw new Error('fail'); }),
      });
      await registry.register(broken, ctx);
      expect(registry.get('broken')!.registration.commands.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // get / getAll
  // -------------------------------------------------------------------------
  describe('get / getAll', () => {
    it('returns undefined for unregistered id', () => {
      expect(registry.get('nope')).toBeUndefined();
    });

    it('getAll returns all plugins', async () => {
      await registry.register(createMockPlugin('a'), ctx);
      await registry.register(createMockPlugin('b'), ctx);
      expect(registry.getAll()).toHaveLength(2);
    });

    it('getAll returns readonly array', async () => {
      await registry.register(createMockPlugin('x'), ctx);
      const all = registry.getAll();
      expect(Array.isArray(all)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // onDidChange
  // -------------------------------------------------------------------------
  describe('onDidChange', () => {
    it('fires "registered" event on successful registration', async () => {
      const events: Array<{ pluginId: string; action: string }> = [];
      registry.onDidChange((e) => events.push(e));

      await registry.register(createMockPlugin('oz'), ctx);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ pluginId: 'oz', action: 'registered' });
    });

    it('fires "error" event when activate() throws', async () => {
      const events: Array<{ pluginId: string; action: string }> = [];
      registry.onDidChange((e) => events.push(e));

      const broken = createMockPlugin('broken', {
        activate: vi.fn(async () => { throw new Error('fail'); }),
      });
      await registry.register(broken, ctx);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ pluginId: 'broken', action: 'error' });
    });
  });

  // -------------------------------------------------------------------------
  // disposeAll
  // -------------------------------------------------------------------------
  describe('disposeAll', () => {
    it('calls deactivate() on each plugin', async () => {
      const deactivate = vi.fn(async () => {});
      const plugin = createMockPlugin('oz', { deactivate });
      await registry.register(plugin, ctx);

      await registry.disposeAll();
      expect(deactivate).toHaveBeenCalledOnce();
    });

    it('disposes registration disposables', async () => {
      const disposeFn = vi.fn();
      const plugin = createMockPlugin('shell', {
        activate: vi.fn(async () => ({
          commands: new Map(),
          disposables: [{ dispose: disposeFn }],
        })),
      });
      await registry.register(plugin, ctx);
      await registry.disposeAll();
      expect(disposeFn).toHaveBeenCalledOnce();
    });

    it('clears the registry after dispose', async () => {
      await registry.register(createMockPlugin('p'), ctx);
      await registry.disposeAll();
      expect(registry.getAll()).toHaveLength(0);
    });

    it('does not throw when deactivate() throws', async () => {
      const plugin = createMockPlugin('crashy', {
        deactivate: vi.fn(async () => { throw new Error('crash'); }),
      });
      await registry.register(plugin, ctx);
      await expect(registry.disposeAll()).resolves.toBeUndefined();
    });

    it('skips plugins without deactivate', async () => {
      const plugin = createMockPlugin('simple');
      delete (plugin as any).deactivate;
      await registry.register(plugin, ctx);
      await expect(registry.disposeAll()).resolves.toBeUndefined();
    });

    it('register() throws after disposeAll()', async () => {
      await registry.disposeAll();
      const plugin = createMockPlugin('late');
      await expect(registry.register(plugin, ctx)).rejects.toThrow('disposed');
    });

    it('stores String(err) when activate() throws a non-Error value', async () => {
      const broken = createMockPlugin('non-err', {
        activate: vi.fn(async () => { throw 'just a string'; }),
      });
      await registry.register(broken, ctx);

      const info = registry.get('non-err');
      expect(info!.status).toBe('error');
      expect(info!.error).toBe('just a string');
    });
  });
});
