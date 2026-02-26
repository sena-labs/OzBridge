// IMPL: Phase 2 — AggregatedFollowupProvider unit tests (§3.5 Architecture)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AggregatedFollowupProvider } from '../../src/core/aggregatedFollowups.js';
import { PluginRegistry } from '../../src/core/pluginRegistry.js';
import type { PluginContext, PluginInfo } from 'copilot-chat-toolkit';
import { createMockToken } from '../helpers.js';

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AggregatedFollowupProvider', () => {
  let registry: PluginRegistry;
  let ctx: PluginContext;
  const defaultFollowups = [
    { message: 'Default followup', command: 'help' },
  ];

  beforeEach(() => {
    registry = new PluginRegistry();
    ctx = createMockPluginContext();
  });

  // -----------------------------------------------------------------------
  // Default followups
  // -----------------------------------------------------------------------
  describe('defaults', () => {
    it('returns defaults when result has no metadata', () => {
      const provider = new AggregatedFollowupProvider(registry, defaultFollowups as any);
      const result = provider.provideFollowups({}, {} as any, createMockToken() as any);
      expect(result).toEqual(defaultFollowups);
    });

    it('returns defaults when metadata has no namespace', () => {
      const provider = new AggregatedFollowupProvider(registry, defaultFollowups as any);
      const result = provider.provideFollowups(
        { metadata: { command: 'plugins' } },
        {} as any,
        createMockToken() as any,
      );
      expect(result).toEqual(defaultFollowups);
    });

    it('returns empty array by default when no defaults provided', () => {
      const provider = new AggregatedFollowupProvider(registry);
      const result = provider.provideFollowups({}, {} as any, createMockToken() as any);
      expect(result).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Plugin followup lookup
  // -----------------------------------------------------------------------
  describe('plugin followup lookup', () => {
    it('returns defaults when plugin has no followups', async () => {
      await registry.register({
        id: 'oz',
        displayName: 'Oz',
        version: '1.0.0',
        activate: vi.fn(async () => ({
          commands: new Map([['run', vi.fn()]]),
          // no followups
        })),
      }, ctx);

      const provider = new AggregatedFollowupProvider(registry, defaultFollowups as any);
      const result = provider.provideFollowups(
        { metadata: { namespace: 'oz', subcommand: 'run' } },
        {} as any,
        createMockToken() as any,
      );
      expect(result).toEqual(defaultFollowups);
    });

    it('returns defaults when subcommand has no followups', async () => {
      await registry.register({
        id: 'oz',
        displayName: 'Oz',
        version: '1.0.0',
        activate: vi.fn(async () => ({
          commands: new Map([['run', vi.fn()], ['status', vi.fn()]]),
          followups: { run: [{ message: 'Check status', command: 'status' }] },
        })),
      }, ctx);

      const provider = new AggregatedFollowupProvider(registry, defaultFollowups as any);
      // Query for 'status' subcommand which has no followups
      const result = provider.provideFollowups(
        { metadata: { namespace: 'oz', subcommand: 'status' } },
        {} as any,
        createMockToken() as any,
      );
      expect(result).toEqual(defaultFollowups);
    });

    it('returns defaults when namespace is not in registry', () => {
      const provider = new AggregatedFollowupProvider(registry, defaultFollowups as any);
      const result = provider.provideFollowups(
        { metadata: { namespace: 'unknown', subcommand: 'run' } },
        {} as any,
        createMockToken() as any,
      );
      expect(result).toEqual(defaultFollowups);
    });
  });

  // -----------------------------------------------------------------------
  // Followup transformation
  // -----------------------------------------------------------------------
  describe('followup transformation', () => {
    it('transforms plugin internal followups with namespace', async () => {
      await registry.register({
        id: 'oz',
        displayName: 'Oz',
        version: '1.0.0',
        activate: vi.fn(async () => ({
          commands: new Map([['run', vi.fn()]]),
          followups: {
            run: [
              { message: 'Check status', command: 'status', label: '📊 Status' },
            ],
          },
        })),
      }, ctx);

      const provider = new AggregatedFollowupProvider(registry);
      const result = provider.provideFollowups(
        { metadata: { namespace: 'oz', subcommand: 'run' } },
        {} as any,
        createMockToken() as any,
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        command: 'oz',        // transformed to namespace
        prompt: 'status',     // original command becomes prompt
        label: '📊 Status',  // preserved
        message: 'Check status',
      });
    });

    it('handles followups with prompt instead of command', async () => {
      await registry.register({
        id: 'shell',
        displayName: 'Shell',
        version: '1.0.0',
        activate: vi.fn(async () => ({
          commands: new Map([['exec', vi.fn()]]),
          followups: {
            exec: [
              { message: 'Re-run', prompt: 'exec last', label: '🔄 Re-run' },
            ],
          },
        })),
      }, ctx);

      const provider = new AggregatedFollowupProvider(registry);
      const result = provider.provideFollowups(
        { metadata: { namespace: 'shell', subcommand: 'exec' } },
        {} as any,
        createMockToken() as any,
      );

      expect(result).toHaveLength(1);
      expect(result[0].command).toBe('shell');
      expect(result[0].prompt).toBe('exec last');
    });

    it('handles multiple followups', async () => {
      await registry.register({
        id: 'oz',
        displayName: 'Oz',
        version: '1.0.0',
        activate: vi.fn(async () => ({
          commands: new Map([['run', vi.fn()]]),
          followups: {
            run: [
              { message: 'Status', command: 'status' },
              { message: 'Cloud', command: 'cloud' },
              { message: 'Config', command: 'config' },
            ],
          },
        })),
      }, ctx);

      const provider = new AggregatedFollowupProvider(registry);
      const result = provider.provideFollowups(
        { metadata: { namespace: 'oz', subcommand: 'run' } },
        {} as any,
        createMockToken() as any,
      );

      expect(result).toHaveLength(3);
      expect(result.every((f: any) => f.command === 'oz')).toBe(true);
    });

    it('uses empty string when followup has neither command nor prompt', async () => {
      await registry.register({
        id: 'bare',
        displayName: 'Bare',
        version: '1.0.0',
        activate: vi.fn(async () => ({
          commands: new Map([['run', vi.fn()]]),
          followups: {
            run: [
              { message: 'No cmd no prompt', label: '🔲 Bare' },
            ],
          },
        })),
      }, ctx);

      const provider = new AggregatedFollowupProvider(registry);
      const result = provider.provideFollowups(
        { metadata: { namespace: 'bare', subcommand: 'run' } },
        {} as any,
        createMockToken() as any,
      );

      expect(result).toHaveLength(1);
      expect(result[0].prompt).toBe('');
      expect(result[0].command).toBe('bare');
    });

    it('returns defaults when subcommand is absent but namespace exists', async () => {
      await registry.register({
        id: 'oz',
        displayName: 'Oz',
        version: '1.0.0',
        activate: vi.fn(async () => ({
          commands: new Map([['run', vi.fn()]]),
          followups: { run: [{ message: 'A', command: 'status' }] },
        })),
      }, ctx);

      const provider = new AggregatedFollowupProvider(registry, defaultFollowups as any);
      // namespace but no subcommand
      const result = provider.provideFollowups(
        { metadata: { namespace: 'oz' } },
        {} as any,
        createMockToken() as any,
      );
      expect(result).toEqual(defaultFollowups);
    });
  });
});
