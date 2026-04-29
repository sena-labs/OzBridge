import * as vscode from 'vscode';
import { ILanguageModelClient } from './failureTriage.js';

/**
 * Builds an {@link ILanguageModelClient} backed by `vscode.lm`. Returns
 * `undefined` on hosts where the language-model API is not available
 * (VS Code &lt; 1.96 or Insiders without the proposed surface), letting
 * callers degrade gracefully.
 */
export function createVsCodeLanguageModelClient(): ILanguageModelClient | undefined {
  if (typeof vscode.lm?.selectChatModels !== 'function') {
    return undefined;
  }
  return {
    async sendRequest(prompt, cancellation) {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      const model = models.at(0);
      if (!model) {
        throw new Error('No Copilot chat model is available');
      }
      const message = vscode.LanguageModelChatMessage.User(prompt);
      // When the caller does not provide a cancellation token, allocate a
      // local source so we can dispose of it explicitly. Otherwise the source
      // (and its internal listeners) would leak on every call.
      const externalToken = cancellation as vscode.CancellationToken | undefined;
      const localSource = externalToken ? undefined : new vscode.CancellationTokenSource();
      const token = externalToken ?? localSource!.token;
      try {
        const response = await model.sendRequest([message], {}, token);
        let buffer = '';
        for await (const chunk of response.text) {
          buffer += chunk;
        }
        return buffer;
      } finally {
        localSource?.dispose();
      }
    },
  };
}
