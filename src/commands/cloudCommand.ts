import * as vscode from 'vscode';
import {
  IOzCliService,
  IConfigManager,
  IContextCollector,
  IRunPoller,
  OzCliError,
  OzCliErrorKind,
  SlashCommandHandler,
} from '../types/index.js';
import { OutputFormatter } from '../parsers/outputFormatter.js';
import { detectSkill } from './skillDetector.js';
import { t } from '../core/i18n.js';

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
 * @returns A {@link SlashCommandHandler} for the `/cloud` command.
 */

export function createCloudCommand(
  cli: IOzCliService,
  cfgMgr: IConfigManager,
  poller: IRunPoller,
  ctx: IContextCollector,
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

    // Avviso consumo crediti (informativo, non blocca l'esecuzione)
    stream.markdown(t('oz.cloud_warning', prompt));

    // Risolvi environment: configurato → usa quello, altrimenti auto-detect
    let environment = config.defaultEnvironment || undefined;
    let noEnvironment = false;
    if (environment) {
      stream.markdown(t('oz.cloud_env', environment));
    } else {
      try {
        const envResult = await cli.environmentList();
        if (envResult.items.length > 0) {
          const env = envResult.items[0];
          environment = env.id;
          stream.markdown(t('oz.cloud_env_auto', env.name, env.id));
        } else {
          noEnvironment = true;
          stream.markdown(t('oz.cloud_no_env'));
        }
      } catch {
        noEnvironment = true;
        stream.markdown(t('oz.cloud_no_env'));
      }
    }

    // Inietta contesto IDE nel prompt
    const context = ctx.gather();
    const contextBlock = ctx.formatForPrompt(context);
    const fullPrompt = `${contextBlock}\n\n${prompt}`;

    // Rileva se il prompt menziona un agent skill specifico
    const skill = detectSkill(prompt);

    stream.progress(t('oz.cloud_progress'));

    try {
      const result = await cli.agentRunCloud({
        prompt: fullPrompt,
        model: config.defaultModel !== 'auto' ? config.defaultModel : undefined,
        environment,
        noEnvironment,
        open: true,
        skill,
        cancellation: token,
      });

      if (result.runId) {
        stream.markdown(t('oz.cloud_started', result.runId));
        stream.markdown(t('oz.cloud_polling'));

        // IMPL: polling asincrono con backoff (D3)
        try {
          const finalResult = await poller.poll(
            result.runId,
            (status) => {
              stream.progress(t('oz.cloud_status', status));
            },
            token,
          );

          formatter.formatRunResult(finalResult, stream, { autoOpened: true });

          // Notifica VS Code
          const statusMsg = finalResult.status === 'SUCCEEDED'
            ? t('oz.cloud_success')
            : t('oz.cloud_failed');
          vscode.window.showInformationMessage(`Warp Bridge: ${statusMsg} (${result.runId})`);
        } catch (pollErr) {
          if (pollErr instanceof OzCliError) {
            formatter.formatError(pollErr, stream);
          } else {
            stream.markdown(t('oz.error_polling', pollErr instanceof Error ? pollErr.message : String(pollErr)));
          }
        }
      } else {
        // Se non c'è runId, mostra il risultato direttamente
        formatter.formatRunResult(result, stream, { autoOpened: true });
      }
    } catch (err) {
      formatter.handleError(err, stream);
    }

    return {};
  };
}
