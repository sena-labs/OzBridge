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
      if (models.length === 0) {
        throw new Error('No Copilot chat model is available');
      }
      const message = vscode.LanguageModelChatMessage.User(prompt);
      const token = (cancellation as vscode.CancellationToken | undefined)
        ?? new vscode.CancellationTokenSource().token;
      const response = await models[0].sendRequest([message], {}, token);
      let buffer = '';
      for await (const chunk of response.text) {
        buffer += chunk;
      }
      return buffer;
    },
  };
}
