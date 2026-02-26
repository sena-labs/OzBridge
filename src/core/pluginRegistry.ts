// ============================================================================
// Core — PluginRegistry
// ============================================================================
// IMPL: Phase 2 — Plugin lifecycle management (§3.3 Architecture)

import * as vscode from 'vscode';
import type {
  IPlugin,
  PluginContext,
  PluginInfo,
  PluginRegistration,
  PluginRegistryChangeEvent,
} from 'copilot-chat-toolkit';

/**
 * Manages plugin lifecycle: registration, activation, lookup, and disposal.
 *
 * Each plugin's `activate()` is called inside a try/catch — if it throws,
 * the plugin is stored with `status: 'error'` and an error message,
 * without affecting other plugins.
 *
 * Emits {@link PluginRegistryChangeEvent} via {@link onDidChange}.
 */
export class PluginRegistry {
  private readonly plugins = new Map<string, PluginInfo>();
  private readonly _onDidChange = new vscode.EventEmitter<PluginRegistryChangeEvent>();
  private _disposed = false;

  /** Fires when a plugin is registered, removed, or enters an error state. */
  readonly onDidChange: vscode.Event<PluginRegistryChangeEvent> = this._onDidChange.event;

  /**
   * Registers and activates a plugin.
   *
   * @param plugin  - The plugin instance.
   * @param ctx     - Shared context (logger, contextCollector, extensionContext, i18n).
   * @param source  - Whether the plugin is built-in or loaded from an external extension.
   * @throws If a plugin with the same `id` is already registered.
   */
  async register(
    plugin: IPlugin,
    ctx: PluginContext,
    source: 'builtin' | 'external' = 'builtin',
  ): Promise<void> {
    if (this._disposed) {
      throw new Error('PluginRegistry has been disposed.');
    }

    // IMPL: validate namespace uniqueness
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin "${plugin.id}" is already registered.`);
    }

    try {
      const registration: PluginRegistration = await plugin.activate(ctx);

      const info: PluginInfo = {
        plugin,
        registration,
        source,
        status: 'active',
      };

      this.plugins.set(plugin.id, info);
      this._onDidChange.fire({ pluginId: plugin.id, action: 'registered' });
    } catch (err) {
      // IMPL: crash-safe activation — store with error status
      const message = err instanceof Error ? err.message : String(err);

      const info: PluginInfo = {
        plugin,
        registration: { commands: new Map() },
        source,
        status: 'error',
        error: message,
      };

      this.plugins.set(plugin.id, info);
      this._onDidChange.fire({ pluginId: plugin.id, action: 'error' });
    }
  }

  /** Returns plugin info by id, or `undefined` if not registered. */
  get(id: string): PluginInfo | undefined {
    return this.plugins.get(id);
  }

  /** Returns all registered plugins as a readonly array. */
  getAll(): ReadonlyArray<PluginInfo> {
    return Array.from(this.plugins.values());
  }

  /**
   * Deactivates and disposes all registered plugins.
   *
   * For each plugin (in registration order):
   * 1. Calls `plugin.deactivate()` if defined (swallowing errors).
   * 2. Disposes every item in `registration.disposables`.
   *
   * Finally disposes the internal event emitter.
   */
  async disposeAll(): Promise<void> {
    for (const info of this.plugins.values()) {
      // IMPL: deactivate — best-effort, never throws
      try {
        await info.plugin.deactivate?.();
      } catch {
        // swallow — plugin cleanup should not crash the host
      }

      // IMPL: dispose registration disposables
      if (info.registration.disposables) {
        for (const d of info.registration.disposables) {
          try {
            d.dispose();
          } catch {
            // swallow
          }
        }
      }
    }

    this.plugins.clear();
    this._onDidChange.dispose();
    this._disposed = true;
  }
}
