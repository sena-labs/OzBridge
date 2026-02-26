import { SkillMap } from '../types.js';

/**
 * Scans the prompt text for a known agent skill keyword.
 *
 * Uses word-boundary splitting (`/\\W+/`) so that punctuation-adjacent keywords
 * are matched but substrings inside longer words are not.
 *
 * @param prompt - User's natural language prompt.
 * @param skillMap - Keyword → skill-name mapping.
 * @returns The skill name if found, otherwise `undefined`.
 */
export function detectSkill(prompt: string, skillMap: SkillMap): string | undefined {
  const words = prompt.toLowerCase().split(/\W+/);
  for (const [key, skillName] of Object.entries(skillMap)) {
    if (words.includes(key)) {
      return skillName;
    }
  }
  return undefined;
}
