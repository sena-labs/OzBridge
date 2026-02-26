import * as vscode from 'vscode';
import {
  IOzCliService,
  IConfigManager,
  SlashCommandHandler,
} from '../types/index.js';
import { OutputFormatter } from '../parsers/outputFormatter.js';
import { t } from '../core/i18n.js';

/**
 * Creates the `/mcp` slash-command handler.
 *
 * Lists the MCP (Model Context Protocol) servers configured in Warp.
 *
 * @param cli - Oz CLI service for `listMcpServers()`.
 * @param cfgMgr - Configuration manager.
 * @returns A {@link SlashCommandHandler} for the `/mcp` command.
 */
export function createMcpCommand(
  cli: IOzCliService,
  cfgMgr: IConfigManager,
): SlashCommandHandler {
  const formatter = new OutputFormatter(cfgMgr);
  return async (_prompt, stream, _token) => {

    stream.progress(t('oz.mcp_progress'));

    try {
      const list = await cli.mcpList();

      if (list.items.length === 0) {
        stream.markdown(t('oz.mcp_empty'));
      } else {
        stream.markdown(t('oz.mcp_count', list.items.length));
        formatter.formatList(list, ['name', 'uuid'], stream);
      }
    } catch (err) {
      formatter.handleError(err, stream);
    }

    return {};
  };
}
