import * as vscode from 'vscode';
import { SlashCommandHandler } from '../types.js';

/**
 * Generic slash-command dispatch table for a Copilot Chat Participant.
 *
 * Maps command names to handlers. When no command is specified in the
 * request, falls back to the configured default command.
 */
export class CommandRouter {
  /**
   * @param handlers - Map of command names to their handlers.
   * @param defaultCommand - Fallback command when none is specified.
   * @param unknownMessage - Markdown message shown for unrecognised commands.
   */
  constructor(
    private readonly handlers: Map<string, SlashCommandHandler>,
    private readonly defaultCommand: string = 'run',
    private readonly unknownMessage?: string,
  ) {}

  /** Creates a {@link vscode.ChatRequestHandler} that dispatches slash commands. */
  createHandler(): vscode.ChatRequestHandler {
    return async (
      request: vscode.ChatRequest,
      _context: vscode.ChatContext,
      stream: vscode.ChatResponseStream,
      token: vscode.CancellationToken,
    ): Promise<vscode.ChatResult> => {
      const commandName = request.command ?? this.defaultCommand;
      const handler = this.handlers.get(commandName);

      if (!handler) {
        const available = Array.from(this.handlers.keys()).map((k) => `\`/${k}\``).join(', ');
        stream.markdown(
          this.unknownMessage ??
          `❓ Unknown command \`/${commandName}\`.\n\nAvailable: ${available}\n`,
        );
        return {};
      }

      const result = await handler(request.prompt, stream, token);
      return { ...result, metadata: { ...result.metadata, command: commandName } };
    };
  }
}
