import * as vscode from 'vscode';
import {
  IOzCliService,
  IContextCollector,
  IConfigManager,
  IRunPoller,
} from '../types/index.js';
import { CommandRouter } from '../commands/router.js';
import { FollowupProvider } from './followups.js';

/**
 * Registers the `@oz` Chat Participant in VS Code Copilot Chat.
 *
 * Creates a {@link CommandRouter} for slash-command dispatch and a
 * {@link FollowupProvider} for contextual follow-up suggestions,
 * then attaches them to the chat participant.
 *
 * @param context - Extension context (for `subscriptions`).
 * @param cli - Oz CLI service.
 * @param ctx - IDE context collector.
 * @param cfgMgr - Configuration manager.
 * @param poller - Cloud-run poller.
 * @returns The registered {@link vscode.ChatParticipant} instance.
 */

const PARTICIPANT_ID = 'ozbridge.oz';

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  cli: IOzCliService,
  ctx: IContextCollector,
  cfgMgr: IConfigManager,
  poller: IRunPoller,
): vscode.ChatParticipant {
  const router = new CommandRouter(cli, ctx, cfgMgr, poller);
  const handler = router.createHandler();

  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'warp-icon.png');
  participant.followupProvider = new FollowupProvider();

  context.subscriptions.push(participant);

  return participant;
}
