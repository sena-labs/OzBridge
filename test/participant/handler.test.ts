import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chat, Uri } from '../../test/mocks/vscode.js';
import { registerChatParticipant } from '../../src/participant/handler.js';
import {
  createMockCli,
  createMockConfigManager,
  createMockContextCollector,
  createMockPoller,
} from '../helpers.js';
import { initI18n, _resetI18n } from '../../src/core/i18n.js';

beforeEach(() => {
  vi.clearAllMocks();
  initI18n('en');
});

afterEach(() => {
  _resetI18n();
});

describe('registerChatParticipant()', () => {
  function createMockExtensionContext() {
    return {
      extensionUri: Uri.file('/ext'),
      subscriptions: [] as Array<{ dispose: () => void }>,
    };
  }

  it('dovrebbe registrare participant con ID corretto', () => {
    const ctx = createMockExtensionContext();
    registerChatParticipant(
      ctx as any,
      createMockCli(),
      createMockContextCollector(),
      createMockConfigManager(),
      createMockPoller(),
    );

    expect(chat.createChatParticipant).toHaveBeenCalledWith(
      'warp-vsc-bridge.warp',
      expect.any(Function),
    );
  });

  it('dovrebbe aggiungere participant a subscriptions', () => {
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

  it('dovrebbe impostare iconPath', () => {
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

  it('dovrebbe impostare followupProvider', () => {
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

  it('dovrebbe ritornare il participant creato', () => {
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
