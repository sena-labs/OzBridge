import * as vscode from 'vscode';
import {
  IOzCliService,
  IConfigManager,
  SlashCommandHandler,
} from '../types/index.js';
import { OutputFormatter } from '../parsers/outputFormatter.js';

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

    stream.progress('Fetching MCP servers...');

    try {
      const list = await cli.mcpList();

      if (list.items.length === 0) {
        stream.markdown('_No MCP servers configured._\n');
      } else {
        stream.markdown(`**${list.items.length} MCP servers configured:**\n\n`);
        formatter.formatList(list, ['name', 'uuid'], stream);
      }
    } catch (err) {
      formatter.handleError(err, stream);
    }

    return {};
  };
}
