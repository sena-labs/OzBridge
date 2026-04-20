import * as vscode from 'vscode';
import {
  IOzCliService,
  IContextCollector,
  IConfigManager,
  IRunPoller,
  SlashCommandHandler,
} from '../types/index.js';
import { createRunCommand } from './runCommand.js';
import { createCloudCommand } from './cloudCommand.js';
import { createStatusCommand } from './statusCommand.js';
import { createScheduleCommand } from './scheduleCommand.js';
import { createModelsCommand } from './modelsCommand.js';
import { createMcpCommand } from './mcpCommand.js';
import { createConfigCommand } from './ozConfigCommand.js';
import { createInitV2Command } from './initV2Command.js';
import { createHistoryCommand } from './historyCommand.js';

/**
 * Routes incoming slash commands to the appropriate handler.
 *
 * Builds a dispatch table mapping each command name to its factory-created
 * {@link SlashCommandHandler}. When no command is specified the default is `/run`.
 */
export class CommandRouter {
  private readonly handlers: Map<string, SlashCommandHandler>;

  constructor(
    cli: IOzCliService,
    ctx: IContextCollector,
    cfgMgr: IConfigManager,
    poller: IRunPoller,
  ) {
    this.handlers = new Map<string, SlashCommandHandler>([
      ['run', createRunCommand(cli, ctx, cfgMgr)],
      ['cloud', createCloudCommand(cli, cfgMgr, poller, ctx)],
      ['status', createStatusCommand(cli, cfgMgr)],
      ['history', createHistoryCommand(cli, cfgMgr)],
      ['schedule', createScheduleCommand(cli, cfgMgr)],
      ['models', createModelsCommand(cli, cfgMgr)],
      ['mcp', createMcpCommand(cli, cfgMgr)],
      ['config', createConfigCommand(cli, cfgMgr)],
      ['init', createInitV2Command()],
    ]);
  }

  createHandler(): vscode.ChatRequestHandler {
    return async (
      request: vscode.ChatRequest,
      _context: vscode.ChatContext,
      stream: vscode.ChatResponseStream,
      token: vscode.CancellationToken,
    ): Promise<vscode.ChatResult> => {
      const commandName = request.command ?? 'run';
      const handler = this.handlers.get(commandName);

      if (!handler) {
        stream.markdown(`❓ Unknown command \`/${commandName}\`.\n\n`);
        stream.markdown(
          '**Available commands:**\n' +
          '- `/run` — run local agent\n' +
          '- `/cloud` — run cloud agent\n' +
          '- `/status` — active run status\n' +
          '- `/history` — completed run history\n' +
          '- `/schedule` — schedule management\n' +
          '- `/models` — available models\n' +
          '- `/mcp` — MCP servers\n' +
          '- `/config` — configuration\n' +
          '- `/init` — scaffold skills/rules\n',
        );
        return {};
      }

      const result = await handler(request.prompt, stream, token);
      return { ...result, metadata: { ...result.metadata, command: commandName } };
    };
  }
}
