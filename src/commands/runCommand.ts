import * as vscode from 'vscode';
import {
  IOzCliService,
  IContextCollector,
  IConfigManager,
  OzCliError,
  OzCliErrorKind,
  SlashCommandHandler,
} from '../types/index.js';
import { OutputFormatter } from '../parsers/outputFormatter.js';
import { detectSkill } from './skillDetector.js';

/**
 * Creates the `/run` slash-command handler.
 *
 * Executes a local Warp Oz agent run in the current workspace,
 * injecting IDE context and auto-detecting the agent skill from the prompt.
 *
 * @param cli - Oz CLI service for `agentRun()`.
 * @param ctx - IDE context collector.
 * @param cfgMgr - Configuration manager.
 * @returns A {@link SlashCommandHandler} for the `/run` command.
 */
export function createRunCommand(
  cli: IOzCliService,
  ctx: IContextCollector,
  cfgMgr: IConfigManager,
): SlashCommandHandler {
  const formatter = new OutputFormatter(cfgMgr);
  return async (prompt, stream, token) => {
    const config = cfgMgr.getConfig();

    // Verifica disponibilità Oz CLI
    const avail = await cli.checkAvailability();
    if (!avail.available) {
      formatter.formatError(
        new OzCliError(OzCliErrorKind.NOT_FOUND, 'Oz CLI not found'),
        stream,
      );
      return {};
    }

    // Raccogli contesto IDE
    const context = ctx.gather();
    const contextBlock = ctx.formatForPrompt(context);

    // Costruisci prompt con contesto iniettato (D5)
    const fullPrompt = `${contextBlock}\n\n${prompt}`;

    // Rileva se il prompt menziona un agent skill specifico
    const skill = detectSkill(prompt);

    stream.progress('Starting local Oz agent...');

    try {
      const result = await cli.agentRun({
        prompt: fullPrompt,
        model: config.defaultModel !== 'auto' ? config.defaultModel : undefined,
        profile: config.defaultProfile !== 'Default' ? config.defaultProfile : undefined,
        skill,
        cwd: context.workspacePath || undefined,
        cancellation: token,
      });

      formatter.formatRunResult(result, stream, { local: true });
    } catch (err) {
      formatter.handleError(err, stream);
    }

    return {};
  };
}
