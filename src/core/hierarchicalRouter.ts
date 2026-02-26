// ============================================================================
// Core — HierarchicalRouter
// ============================================================================
// IMPL: Phase 2 — Namespace-based routing (§3.4 Architecture)

import * as vscode from 'vscode';
import type { SlashCommandHandler, II18nService } from 'copilot-chat-toolkit';
import type { PluginRegistry } from './pluginRegistry.js';

/**
 * Parses a prompt into subcommand + remaining text.
 *
 * @example
 * parseSubcommand('run implement auth') → { sub: 'run', actualPrompt: 'implement auth' }
 * parseSubcommand('') → { sub: '', actualPrompt: '' }
 */
export function parseSubcommand(prompt: string): { sub: string; actualPrompt: string } {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return { sub: '', actualPrompt: '' };
  }
  const tokens = trimmed.split(/\s+/);
  return {
    sub: tokens[0],
    actualPrompt: tokens.slice(1).join(' '),
  };
}

/**
 * Hierarchical command router for the `@dev` Chat Participant.
 *
 * Dispatching algorithm:
 * 1. No command → welcome message listing all plugins.
 * 2. Command is a core command → dispatch to core handler.
 * 3. Command is a plugin namespace → parse subcommand, dispatch to plugin.
 * 4. Otherwise → error message.
 *
 * Results carry `metadata.namespace` and `metadata.subcommand` for the
 * {@link AggregatedFollowupProvider} to produce correct follow-ups.
 */
export class HierarchicalRouter {
  /**
   * @param registry     - Plugin registry for namespace lookup.
   * @param coreCommands - Map of core command names to handlers (e.g. `plugins`, `help`, `config`).
   * @param i18n         - Internationalisation service for messages.
   */
  constructor(
    private readonly registry: PluginRegistry,
    private readonly coreCommands: Map<string, SlashCommandHandler>,
    private readonly i18n: II18nService,
  ) {}

  /**
   * Creates a {@link vscode.ChatRequestHandler} that dispatches requests
   * according to the hierarchical routing algorithm.
   */
  createHandler(): vscode.ChatRequestHandler {
    return async (
      request: vscode.ChatRequest,
      _context: vscode.ChatContext,
      stream: vscode.ChatResponseStream,
      token: vscode.CancellationToken,
    ): Promise<vscode.ChatResult> => {
      const command = request.command ?? '';

      // IMPL: 1) No command → welcome
      if (!command) {
        return this.handleWelcome(stream);
      }

      // IMPL: 2) Core command
      const coreHandler = this.coreCommands.get(command);
      if (coreHandler) {
        const result = await coreHandler(request.prompt, stream, token);
        return { ...result, metadata: { ...result.metadata, command } };
      }

      // IMPL: 3) Plugin namespace
      const pluginInfo = this.registry.get(command);
      if (pluginInfo && pluginInfo.status === 'active') {
        return this.dispatchToPlugin(command, pluginInfo.registration.commands, request.prompt, stream, token);
      }

      // IMPL: 4) Unknown command
      stream.markdown(this.i18n.t('core.plugin_not_found', command));
      return {};
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private handleWelcome(stream: vscode.ChatResponseStream): vscode.ChatResult {
    const plugins = this.registry.getAll().filter((p) => p.status === 'active');

    if (plugins.length === 0) {
      stream.markdown(this.i18n.t('core.welcome', '_none_'));
      return {};
    }

    const items = plugins
      .map((p) => this.i18n.t('core.welcome_plugin_item', p.plugin.id, p.plugin.displayName))
      .join('\n');

    stream.markdown(this.i18n.t('core.welcome', items));
    return {};
  }

  private async dispatchToPlugin(
    namespace: string,
    commands: Map<string, SlashCommandHandler>,
    prompt: string,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<vscode.ChatResult> {
    const { sub, actualPrompt } = parseSubcommand(prompt);

    // IMPL: empty or unknown subcommand → list available subcommands
    if (!sub || !commands.has(sub)) {
      const available = Array.from(commands.keys())
        .map((k) => `\`${k}\``)
        .join(', ');

      if (!sub) {
        // No subcommand — show plugin help
        const pluginInfo = this.registry.get(namespace)!;
        stream.markdown(
          this.i18n.t('core.help_plugin_section', pluginInfo.plugin.displayName, namespace),
        );
        for (const cmdName of commands.keys()) {
          stream.markdown(this.i18n.t('core.help_plugin_command', namespace, cmdName, cmdName));
        }
      } else {
        // Unknown subcommand
        stream.markdown(this.i18n.t('core.subcommand_not_found', sub, namespace, available));
      }

      return { metadata: { namespace } };
    }

    const handler = commands.get(sub)!;
    const result = await handler(actualPrompt, stream, token);
    return {
      ...result,
      metadata: { ...result.metadata, namespace, subcommand: sub },
    };
  }
}
