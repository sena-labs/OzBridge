import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  activationEvents?: string[];
  contributes?: {
    chatParticipants?: Array<{ id: string }>;
    languageModelTools?: Array<{ name: string }>;
  };
};

describe('Manifest activation consistency audit', () => {
  it('chat participant activation event must match contributes.chatParticipants[0].id', () => {
    const participantIds = (PKG.contributes?.chatParticipants ?? []).map((p) => p.id);
    expect(participantIds.length).toBeGreaterThan(0);

    const expectedEvent = `onChatParticipant:${participantIds[0]}`;
    expect(
      PKG.activationEvents ?? [],
      `Missing activation event ${expectedEvent}. This can break lazy activation when user opens @participant first.`,
    ).toContain(expectedEvent);
  });

  it('each contributed language model tool must have matching onLanguageModelTool activation event', () => {
    const toolNames = (PKG.contributes?.languageModelTools ?? []).map((t) => t.name);
    const activation = new Set(PKG.activationEvents ?? []);

    expect(toolNames.length).toBeGreaterThan(0);

    for (const toolName of toolNames) {
      const expected = `onLanguageModelTool:${toolName}`;
      expect(
        activation.has(expected),
        `Missing activation event ${expected}. Tool may not auto-activate extension in agent flows.`,
      ).toBe(true);
    }
  });
});
