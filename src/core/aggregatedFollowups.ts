// ============================================================================
// Core — AggregatedFollowupProvider
// ============================================================================
// IMPL: Phase 2 — Namespace-aware followup aggregation (§3.5 Architecture)

import * as vscode from 'vscode';
import type { PluginRegistry } from './pluginRegistry.js';

/**
 * Aggregates follow-up suggestions from all plugins.
 *
 * After a command completes, reads `result.metadata.namespace` and
 * `result.metadata.subcommand` to look up the originating plugin's
 * follow-ups. Internal follow-up commands are **transformed** to include
 * the namespace, so that VS Code routes them correctly.
 *
 * @example
 * Plugin returns followup `{ command: 'status' }` for subcommand `'run'`.
 * This provider transforms it to `{ command: 'oz', prompt: 'status' }`.
 */
export class AggregatedFollowupProvider implements vscode.ChatFollowupProvider {
  /**
   * @param registry - Plugin registry for plugin lookup.
   * @param defaults - Default follow-ups when no plugin match exists.
   */
  constructor(
    private readonly registry: PluginRegistry,
    private readonly defaults: vscode.ChatFollowup[] = [],
  ) {}

  provideFollowups(
    result: vscode.ChatResult,
    _context: vscode.ChatContext,
    _token: vscode.CancellationToken,
  ): vscode.ChatFollowup[] {
    const meta = result.metadata as Record<string, unknown> | undefined;
    if (!meta) {
      return this.defaults;
    }

    const namespace = meta.namespace as string | undefined;
    const subcommand = meta.subcommand as string | undefined;

    if (!namespace) {
      // IMPL: core command or no namespace — use defaults
      return this.defaults;
    }

    const pluginInfo = this.registry.get(namespace);
    if (!pluginInfo || !pluginInfo.registration.followups) {
      return this.defaults;
    }

    const followups = subcommand
      ? pluginInfo.registration.followups[subcommand]
      : undefined;

    if (!followups || followups.length === 0) {
      return this.defaults;
    }

    // IMPL: transform plugin-internal followups → namespace-prefixed
    // Plugin defines: { command: 'status', prompt: '', label: '📊 Status' }
    // We emit:        { command: namespace, prompt: 'status', label: '📊 Status' }
    return followups.map((f) => ({
      ...f,
      command: namespace,
      prompt: f.command ?? f.prompt ?? '',
    }));
  }
}
