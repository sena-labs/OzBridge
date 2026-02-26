import * as vscode from 'vscode';
import type { FollowupMap } from '../types.js';

// IMPL: Phase 1 — FollowupMap moved to types.ts for centralised type definitions

/**
 * Generic contextual follow-up provider for Chat Participants.
 *
 * After each command, suggests relevant next commands based on the
 * `command` key stored in `result.metadata`.
 */
export class FollowupProvider implements vscode.ChatFollowupProvider {
  /**
   * @param followups - Map of command → suggested follow-ups.
   * @param defaults - Default follow-ups when no match exists.
   */
  constructor(
    private readonly followups: FollowupMap = {},
    private readonly defaults: vscode.ChatFollowup[] = [],
  ) {}

  provideFollowups(
    result: vscode.ChatResult,
    _context: vscode.ChatContext,
    _token: vscode.CancellationToken,
  ): vscode.ChatFollowup[] {
    const command = (result.metadata as Record<string, unknown> | undefined)?.command as
      | string
      | undefined;
    return (command && this.followups[command]) || this.defaults;
  }
}
