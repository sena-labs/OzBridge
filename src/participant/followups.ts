import {
  FollowupProvider as BaseFollowupProvider,
  type FollowupMap,
} from 'copilot-chat-toolkit';
import { t } from '../core/i18n.js';

// IMPL: thin wrapper — configures toolkit's data-driven FollowupProvider with Warp followups

/**
 * Builds the Warp-specific follow-up map using i18n labels.
 *
 * Must be called **after** {@link initI18n} so that `t()` returns localised strings.
 */
function buildFollowups(): FollowupMap {
  return {
    run: [
      { prompt: '', command: 'status', label: t('oz.followup_check_status') },
      { prompt: '', command: 'models', label: t('oz.followup_list_models') },
    ],
    cloud: [
      { prompt: '', command: 'status', label: t('oz.followup_check_status') },
      { prompt: '', command: 'models', label: t('oz.followup_list_models') },
    ],
    status: [
      { prompt: '', command: 'run', label: t('oz.followup_run_local') },
      { prompt: '', command: 'cloud', label: t('oz.followup_run_cloud') },
    ],
    config: [
      { prompt: '', command: 'run', label: t('oz.followup_run_agent') },
      { prompt: '', command: 'init', label: t('oz.followup_scaffold') },
    ],
    init: [
      { prompt: '', command: 'run', label: t('oz.followup_run_agent') },
      { prompt: '', command: 'config', label: t('oz.followup_config') },
    ],
    schedule: [
      { prompt: '', command: 'status', label: t('oz.followup_check_status') },
      { prompt: '', command: 'config', label: t('oz.followup_config') },
    ],
    models: [
      { prompt: '', command: 'run', label: t('oz.followup_run_local') },
      { prompt: '', command: 'cloud', label: t('oz.followup_run_cloud') },
    ],
    mcp: [
      { prompt: '', command: 'config', label: t('oz.followup_config') },
      { prompt: '', command: 'models', label: t('oz.followup_list_models') },
    ],
  };
}

/**
 * Contextual follow-up provider for the `@warp` Chat Participant.
 *
 * Extends the toolkit's data-driven {@link BaseFollowupProvider} with
 * Warp-specific follow-up suggestions.  The map is built lazily in the
 * constructor so that `t()` is available (after `initI18n()`).
 *
 * To add follow-ups for new commands, add an entry to {@link buildFollowups}
 * and a matching i18n key — no other code changes needed.
 */
export class FollowupProvider extends BaseFollowupProvider {
  constructor() {
    super(buildFollowups(), [
      { prompt: '', command: 'status', label: t('oz.followup_check_status') },
      { prompt: '', command: 'models', label: t('oz.followup_list_models') },
      { prompt: '', command: 'config', label: t('oz.followup_config') },
    ]);
  }
}
