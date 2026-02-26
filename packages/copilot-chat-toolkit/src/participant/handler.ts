import * as vscode from 'vscode';
import { CommandRouter } from './commandRouter.js';

/**
 * Convenience helper to register a Copilot Chat Participant.
 *
 * @param opts.participantId - Full participant ID (e.g. `'my-ext.assistant'`).
 * @param opts.context - Extension context for subscriptions.
 * @param opts.router - A {@link CommandRouter} providing the request handler.
 * @param opts.iconSubPath - Relative icon path inside the extension folder.
 * @param opts.followupProvider - Optional follow-up provider.
 * @returns The registered ChatParticipant.
 */
export function registerChatParticipant(opts: {
  participantId: string;
  context: vscode.ExtensionContext;
  router: CommandRouter;
  iconSubPath?: string;
  followupProvider?: vscode.ChatFollowupProvider;
}): vscode.ChatParticipant {
  const handler = opts.router.createHandler();
  const participant = vscode.chat.createChatParticipant(opts.participantId, handler);

  if (opts.iconSubPath) {
    participant.iconPath = vscode.Uri.joinPath(opts.context.extensionUri, opts.iconSubPath);
  }
  if (opts.followupProvider) {
    participant.followupProvider = opts.followupProvider;
  }

  opts.context.subscriptions.push(participant);
  return participant;
}
