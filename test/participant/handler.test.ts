import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chat, Uri } from '../../test/mocks/vscode.js';
import { registerChatParticipant } from '../../src/participant/handler.js';
import {
  createMockCli,
  createMockConfigManager,
  createMockContextCollector,
  createMockPoller,
} from '../helpers.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registerChatParticipant()', () => {
  function createMockExtensionContext() {
    return {
      extensionUri: Uri.file('/ext'),
      subscriptions: [] as Array<{ dispose: () => void }>,
    };
  }

  it('registers the participant with the correct ID', () => {
    const ctx = createMockExtensionContext();
    registerChatParticipant(
      ctx as any,
      createMockCli(),
      createMockContextCollector(),
      createMockConfigManager(),
      createMockPoller(),
    );

    expect(chat.createChatParticipant).toHaveBeenCalledWith(
      'ozbridge.oz',
      expect.any(Function),
    );
  });

  it('adds the participant to subscriptions', () => {
    const ctx = createMockExtensionContext();
    registerChatParticipant(
      ctx as any,
      createMockCli(),
      createMockContextCollector(),
      createMockConfigManager(),
      createMockPoller(),
    );

    expect(ctx.subscriptions.length).toBe(1);
  });

  it('sets iconPath', () => {
    const participant = { iconPath: undefined as any, followupProvider: undefined as any, dispose: vi.fn() };
    chat.createChatParticipant.mockReturnValue(participant);

    const ctx = createMockExtensionContext();
    registerChatParticipant(
      ctx as any,
      createMockCli(),
      createMockContextCollector(),
      createMockConfigManager(),
      createMockPoller(),
    );

    expect(participant.iconPath).toBeDefined();
  });

  it('sets followupProvider', () => {
    const participant = { iconPath: undefined as any, followupProvider: undefined as any, dispose: vi.fn() };
    chat.createChatParticipant.mockReturnValue(participant);

    const ctx = createMockExtensionContext();
    registerChatParticipant(
      ctx as any,
      createMockCli(),
      createMockContextCollector(),
      createMockConfigManager(),
      createMockPoller(),
    );

    expect(participant.followupProvider).toBeDefined();
  });

  it('returns the created participant', () => {
    const ctx = createMockExtensionContext();
    const result = registerChatParticipant(
      ctx as any,
      createMockCli(),
      createMockContextCollector(),
      createMockConfigManager(),
      createMockPoller(),
    );

    expect(result).toBeDefined();
  });
});
