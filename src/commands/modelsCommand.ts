import * as vscode from 'vscode';
import {
  IOzCliService,
  IConfigManager,
  SlashCommandHandler,
} from '../types/index.js';
import { OutputFormatter } from '../parsers/outputFormatter.js';
import { t } from '../core/i18n.js';

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

    stream.progress(t('oz.models_progress'));

    try {
      const list = await cli.modelList();

      if (list.items.length === 0) {
        stream.markdown(t('oz.models_empty'));
      } else {
        stream.markdown(t('oz.models_count', list.items.length));
        formatter.formatList(list, ['id'], stream);
        stream.markdown(t('oz.models_default', config.defaultModel));
      }
    } catch (err) {
      formatter.handleError(err, stream);
    }

    return {};
  };
}
