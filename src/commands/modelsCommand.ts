import * as vscode from 'vscode';
import {
  IOzCliService,
  IConfigManager,
  SlashCommandHandler,
} from '../types/index.js';
import { OutputFormatter } from '../parsers/outputFormatter.js';

/**
 * Creates the `/models` slash-command handler.
 *
 * Lists the AI models available in the Oz platform.
 *
 * @param cli - Oz CLI service for `listModels()`.
 * @param cfgMgr - Configuration manager.
 * @returns A {@link SlashCommandHandler} for the `/models` command.
 */
export function createModelsCommand(
  cli: IOzCliService,
  cfgMgr: IConfigManager,
): SlashCommandHandler {
  const formatter = new OutputFormatter(cfgMgr);
  return async (_prompt, stream, _token) => {
    const config = cfgMgr.getConfig();

    stream.progress('Fetching available models...');

    try {
      const list = await cli.modelList();

      if (list.items.length === 0) {
        stream.markdown('_No models found._\n');
      } else {
        stream.markdown(`**${list.items.length} models available:**\n\n`);
        formatter.formatList(list, ['id'], stream);
        stream.markdown(`\n_Default model: \`${config.defaultModel}\`_\n`);
      }
    } catch (err) {
      formatter.handleError(err, stream);
    }

    return {};
  };
}
