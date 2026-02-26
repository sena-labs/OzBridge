import { detectSkill as baseDetectSkill } from 'copilot-chat-toolkit';
import { AGENT_SKILL_MAP } from '../types/index.js';

// IMPL: thin wrapper — calls toolkit's detectSkill with Warp's AGENT_SKILL_MAP

/**
 * Scans the prompt text for a known agent skill keyword from {@link AGENT_SKILL_MAP}.
 *
 * @returns The skill name if found, otherwise `undefined`.
 */
export function detectSkill(prompt: string): string | undefined {
  return baseDetectSkill(prompt, AGENT_SKILL_MAP);
}
