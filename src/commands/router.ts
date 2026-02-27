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
import { createInitCommand } from './initCommand.js';
import { createHistoryCommand } from './historyCommand.js';
import { t } from '../core/i18n.js';

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
      ['init', createInitCommand()],
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
        stream.markdown(t('oz.unknown_command', commandName));
        stream.markdown(t('oz.commands_help'));
        return {};
      }

      const result = await handler(request.prompt, stream, token);
      return { ...result, metadata: { ...result.metadata, command: commandName } };
    };
  }
}
