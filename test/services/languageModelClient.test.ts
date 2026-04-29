// C-M1: direct unit tests for src/services/languageModelClient.ts.
// Verifies the host-availability degradation path, normal request flow,
// the externally-provided cancellation token path, and (regression for A-H1)
// that a locally-allocated CancellationTokenSource is always disposed.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { createVsCodeLanguageModelClient } from '../../src/services/languageModelClient.js';

type LmMutable = {
  selectChatModels?: ((selector?: unknown) => Promise<unknown[]>) | undefined;
};

const lm = vscode.lm as unknown as LmMutable;

function makeModel(chunks: string[]) {
  return {
    sendRequest: vi.fn(async (_msgs: unknown, _opts: unknown, _token: unknown) => ({
      text: (async function* () { for (const c of chunks) yield c; })(),
    })),
  };
}

describe('createVsCodeLanguageModelClient', () => {
  let originalSelect: LmMutable['selectChatModels'];

  beforeEach(() => {
    originalSelect = lm.selectChatModels;
  });

  afterEach(() => {
    lm.selectChatModels = originalSelect;
    vi.restoreAllMocks();
  });

  it('returns undefined when vscode.lm.selectChatModels is unavailable', () => {
    lm.selectChatModels = undefined;
    expect(createVsCodeLanguageModelClient()).toBeUndefined();
  });

  it('returns a client when the LM API is available', () => {
    lm.selectChatModels = vi.fn(async () => []);
    const client = createVsCodeLanguageModelClient();
    expect(client).toBeDefined();
    expect(typeof client!.sendRequest).toBe('function');
  });

  it('throws when no Copilot model is available', async () => {
    lm.selectChatModels = vi.fn(async () => []);
    const client = createVsCodeLanguageModelClient()!;
    await expect(client.sendRequest('hi')).rejects.toThrow(/no copilot chat model/i);
  });

  it('aggregates streamed chunks into a single string', async () => {
    const model = makeModel(['Hel', 'lo,', ' world']);
    lm.selectChatModels = vi.fn(async () => [model]);
    const client = createVsCodeLanguageModelClient()!;
    await expect(client.sendRequest('prompt')).resolves.toBe('Hello, world');
    expect(model.sendRequest).toHaveBeenCalledTimes(1);
  });

  it('passes the externally-provided cancellation token through to model.sendRequest', async () => {
    const model = makeModel(['ok']);
    lm.selectChatModels = vi.fn(async () => [model]);
    const client = createVsCodeLanguageModelClient()!;
    const externalToken = new vscode.CancellationTokenSource().token;

    await client.sendRequest('prompt', externalToken);

    const call = model.sendRequest.mock.calls[0];
    expect(call[2]).toBe(externalToken);
  });

  it('disposes the locally-allocated CancellationTokenSource when no token is provided (A-H1 regression)', async () => {
    const model = makeModel(['ok']);
    lm.selectChatModels = vi.fn(async () => [model]);

    const disposeSpy = vi.spyOn(vscode.CancellationTokenSource.prototype, 'dispose');
    const client = createVsCodeLanguageModelClient()!;

    await client.sendRequest('prompt');
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('still disposes the local source when model.sendRequest rejects', async () => {
    const failingModel = {
      sendRequest: vi.fn(async () => { throw new Error('upstream failure'); }),
    };
    lm.selectChatModels = vi.fn(async () => [failingModel]);

    const disposeSpy = vi.spyOn(vscode.CancellationTokenSource.prototype, 'dispose');
    const client = createVsCodeLanguageModelClient()!;

    await expect(client.sendRequest('prompt')).rejects.toThrow(/upstream failure/);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('does not allocate a CancellationTokenSource when an external token is provided', async () => {
    const model = makeModel(['ok']);
    lm.selectChatModels = vi.fn(async () => [model]);

    const disposeSpy = vi.spyOn(vscode.CancellationTokenSource.prototype, 'dispose');
    const externalToken = new vscode.CancellationTokenSource().token;
    disposeSpy.mockClear(); // ignore the source created above for the token

    const client = createVsCodeLanguageModelClient()!;
    await client.sendRequest('prompt', externalToken);
    expect(disposeSpy).not.toHaveBeenCalled();
  });
});
