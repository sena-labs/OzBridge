import * as vscode from 'vscode';
import {
  IOzCliService,
  IConfigManager,
  SlashCommandHandler,
} from '../types/index.js';
import { OutputFormatter } from '../parsers/outputFormatter.js';
import { fetchModelIds } from '../services/modelCatalog.js';

/**
 * Creates the `/models` slash-command handler.
 *
 * - `@oz /models` — lists the AI models available in the Oz platform.
 * - `@oz /models <id>` — sets `ozBridge.defaultModel` to `<id>` (validated
 *   against `oz model list`), so the user can switch models from chat without
 *   opening Settings.
 *
 * @param cli - Oz CLI service for `modelList()`.
 * @param cfgMgr - Configuration manager.
 * @returns A {@link SlashCommandHandler} for the `/models` command.
 */
export function createModelsCommand(
  cli: IOzCliService,
  cfgMgr: IConfigManager,
): SlashCommandHandler {
  const formatter = new OutputFormatter(cfgMgr);
  return async (prompt, stream, _token) => {
    const requested = (prompt ?? '').trim();

    // `@oz /models <id>` → set the default model.
    if (requested.length > 0) {
      stream.progress('Validating model…');
      try {
        const ids = await fetchModelIds(cli);
        if (ids.length > 0 && !ids.includes(requested)) {
          stream.markdown(
            `⚠️ Unknown model \`${requested}\`. Run \`/models\` to see the ${ids.length} available ids.\n`,
          );
          return {};
        }
        await vscode.workspace
          .getConfiguration('ozBridge')
          .update('defaultModel', requested, vscode.ConfigurationTarget.Global);
        const effective = cfgMgr.getConfig().defaultModel;
        if (effective !== requested) {
          stream.markdown(
            `✅ Saved \`${requested}\`, but a workspace \`.warp/warp-bridge.yaml\` overrides ` +
            `\`defaultModel\` to \`${effective}\`. Edit that file to change the effective model.\n`,
          );
        } else {
          stream.markdown(`✅ Default model set to \`${requested}\`.\n`);
        }
      } catch (err) {
        formatter.handleError(err, stream);
      }
      return {};
    }

    // `@oz /models` → list.
    const config = cfgMgr.getConfig();
    stream.progress('Fetching available models...');
    try {
      const list = await cli.modelList();

      if (list.items.length === 0) {
        stream.markdown('_No models found._\n');
      } else {
        stream.markdown(`**${list.items.length} models available:**\n\n`);
        formatter.formatList(list, ['id'], stream);
        stream.markdown(
          `\n_Default model: \`${config.defaultModel}\`_ — change it with ` +
          '`/models <id>` or the **OzBridge: Select Model** command.\n',
        );
      }
    } catch (err) {
      formatter.handleError(err, stream);
    }

    return {};
  };
}
