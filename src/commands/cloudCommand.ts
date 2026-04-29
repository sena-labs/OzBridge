import * as vscode from 'vscode';
import {
  IOzCliService,
  IConfigManager,
  IContextCollector,
  IRunPoller,
  OzCliError,
  OzCliErrorKind,
  OzRunStatus,
  SlashCommandHandler,
} from '../types/index.js';
import { OutputFormatter } from '../parsers/outputFormatter.js';
import { detectSkill } from './skillDetector.js';
import { expandPromptVariables } from '../participant/promptExpander.js';

/** Minimal tracker interface required by the cloud command (avoids tight coupling). */
interface IRunStatusTracker {
  markRunStatus(runId: string, status: OzRunStatus): void;
}

/**
 * Creates the `/cloud` slash-command handler.
 *
 * Starts a cloud Oz agent run after confirming with the user (credit warning),
 * then polls for completion via {@link IRunPoller} with exponential back-off.
 * Also performs agent-skill detection from the prompt.
 *
 * @param cli - Oz CLI service for `cloudRun()` / `runGet()`.
 * @param cfgMgr - Configuration manager.
 * @param poller - Cloud-run poller.
 * @param ctx - IDE context collector.
 * @param tracker - Optional active-runs tracker. When provided, the sidebar is
 *   updated immediately on run start and on terminal status without waiting for
 *   the next periodic `oz run list` poll.
 * @returns A {@link SlashCommandHandler} for the `/cloud` command.
 */

export function createCloudCommand(
  cli: IOzCliService,
  cfgMgr: IConfigManager,
  poller: IRunPoller,
  ctx: IContextCollector,
  tracker?: IRunStatusTracker,
): SlashCommandHandler {
  const formatter = new OutputFormatter(cfgMgr);
  return async (prompt, stream, token) => {
    const config = cfgMgr.getConfig();

    // Verifica disponibilità
    const avail = await cli.checkAvailability();
    if (!avail.available) {
      formatter.formatError(
        new OzCliError(OzCliErrorKind.NOT_FOUND, 'Oz CLI not found'),
        stream,
      );
      return {};
    }

    // Credit consumption warning (informational, does not block execution)
    stream.markdown(`⚠️ **Launching cloud agent** — this operation consumes Oz credits.\n\nPrompt: _${prompt}_\n\n`);

    // Resolve environment: if configured use it, otherwise auto-detect
    let environment = config.defaultEnvironment || undefined;
    let noEnvironment = false;
    if (environment) {
      stream.markdown(`Environment: \`${environment}\`\n\n`);
    } else {
      try {
        const envResult = await cli.environmentList();
        if (envResult.items.length > 0) {
          const env = envResult.items[0];
          environment = env.id;
          // B-L5: escape backticks so user-controlled environment names
          // can't break out of the inline-code span and inject markdown.
          const safeName = String(env.name).replace(/`/g, '\u02cb');
          const safeId = String(env.id).replace(/`/g, '\u02cb');
          stream.markdown(`ℹ️ No environment configured — auto-selected: \`${safeName}\` (\`${safeId}\`)\n\n`);
        } else {
          noEnvironment = true;
          stream.markdown('⚠️ No environments available — running without environment (not recommended)\n\n');
        }
      } catch {
        noEnvironment = true;
        stream.markdown('⚠️ No environments available — running without environment (not recommended)\n\n');
      }
    }

    // Inietta contesto IDE nel prompt
    const context = ctx.gather();
    const contextBlock = ctx.formatForPrompt(context);

    // Espandi variabili di prompt (#warp.*, #oz.*) prima di iniettare il contesto
    const expanded = await expandPromptVariables(prompt, { cli, cfgMgr });
    if (expanded.replacements.length > 0) {
      stream.markdown(`_Expanded ${expanded.replacements.length} prompt variable${expanded.replacements.length === 1 ? '' : 's'}._\n\n`);
    }
    const resolvedPrompt = expanded.text;
    const fullPrompt = `${contextBlock}\n\n${resolvedPrompt}`;

    // Rileva se il prompt menziona un agent skill specifico
    const skill = detectSkill(resolvedPrompt);

    stream.progress('Launching cloud agent...');

    try {
      const result = await cli.agentRunCloud({
        prompt: fullPrompt,
        model: config.defaultModel !== 'auto' ? config.defaultModel : undefined,
        environment,
        noEnvironment,
        open: false,
        skill,
        cancellation: token,
      });

      if (result.runId) {
        stream.markdown(`🚀 **Cloud run started**: \`${result.runId}\`\n\n`);
        stream.markdown('Polling for results...\n\n');

        // Immediately mark the run as INPROGRESS in the sidebar so users
        // see the entry without waiting for the next periodic runList poll.
        tracker?.markRunStatus(result.runId, 'INPROGRESS');

        // IMPL: async polling with exponential backoff (D3)
        try {
          const finalResult = await poller.poll(
            result.runId,
            (status) => {
              stream.progress(`Status: ${status}...`);
            },
            token,
          );

          // Immediately reflect terminal status in the sidebar.
          tracker?.markRunStatus(result.runId, finalResult.status);

          formatter.formatRunResult(finalResult, stream, { autoOpened: false });

          // VS Code notification — use error toast on FAILED so the colour
          // and icon match the semantic of the status.
          const notification = vscode.l10n.t('OzBridge: {0} ({1})',
            finalResult.status === 'SUCCEEDED'
              ? vscode.l10n.t('✅ Cloud agent completed successfully')
              : vscode.l10n.t('❌ Cloud agent failed'),
            result.runId,
          );
          if (finalResult.status === 'SUCCEEDED') {
            void vscode.window.showInformationMessage(notification);
          } else {
            void vscode.window.showErrorMessage(notification);
          }
        } catch (pollErr) {
          // Mark as FAILED in the sidebar on polling error.
          tracker?.markRunStatus(result.runId, 'FAILED');
          if (pollErr instanceof OzCliError) {
            formatter.formatError(pollErr, stream);
          } else {
            const msg = pollErr instanceof Error ? pollErr.message : String(pollErr);
            stream.markdown(`❌ Polling error: ${msg}\n`);
          }
        }
      } else {
        // Se non c'è runId, mostra il risultato direttamente
        formatter.formatRunResult(result, stream, { autoOpened: false });
      }
    } catch (err) {
      formatter.handleError(err, stream);
    }

    return {};
  };
}
