import {
  FollowupProvider as BaseFollowupProvider,
  type FollowupMap,
} from 'copilot-chat-toolkit';

// IMPL: thin wrapper — configures toolkit's data-driven FollowupProvider with Warp followups.

const L_CHECK_STATUS = '📊 Check run status';
const L_LIST_MODELS  = '🤖 List models';
const L_RUN_LOCAL    = '🚀 Run local agent';
const L_RUN_CLOUD    = '☁️ Run cloud agent';
const L_CONFIG       = '⚙️ Configuration';
const L_SCAFFOLD     = '🏗️ Scaffold skill files';
const L_RUN_AGENT    = '🚀 Run agent';
const L_VIEW_HISTORY = '🗂️ View history';

const WARP_FOLLOWUPS: FollowupMap = {
  run: [
    { prompt: '', command: 'status', label: L_CHECK_STATUS },
    { prompt: '', command: 'models', label: L_LIST_MODELS },
  ],
  cloud: [
    { prompt: '', command: 'status', label: L_CHECK_STATUS },
    { prompt: '', command: 'models', label: L_LIST_MODELS },
  ],
  status: [
    { prompt: '', command: 'run', label: L_RUN_LOCAL },
    { prompt: '', command: 'history', label: L_VIEW_HISTORY },
  ],
  history: [
    { prompt: '', command: 'run', label: L_RUN_LOCAL },
    { prompt: '', command: 'status', label: L_CHECK_STATUS },
  ],
  config: [
    { prompt: '', command: 'run', label: L_RUN_AGENT },
    { prompt: '', command: 'init', label: L_SCAFFOLD },
  ],
  init: [
    { prompt: '', command: 'run', label: L_RUN_AGENT },
    { prompt: '', command: 'config', label: L_CONFIG },
  ],
  schedule: [
    { prompt: '', command: 'status', label: L_CHECK_STATUS },
    { prompt: '', command: 'config', label: L_CONFIG },
  ],
  models: [
    { prompt: '', command: 'run', label: L_RUN_LOCAL },
    { prompt: '', command: 'cloud', label: L_RUN_CLOUD },
  ],
  mcp: [
    { prompt: '', command: 'config', label: L_CONFIG },
    { prompt: '', command: 'models', label: L_LIST_MODELS },
  ],
};

const WARP_DEFAULT_FOLLOWUPS = [
  { prompt: '', command: 'status', label: L_CHECK_STATUS },
  { prompt: '', command: 'models', label: L_LIST_MODELS },
  { prompt: '', command: 'config', label: L_CONFIG },
];

/**
 * Contextual follow-up provider for the `@oz` Chat Participant.
 *
 * Extends the toolkit's data-driven {@link BaseFollowupProvider} with
 * Warp-specific follow-up suggestions.
 */
export class FollowupProvider extends BaseFollowupProvider {
  constructor() {
    super(WARP_FOLLOWUPS, WARP_DEFAULT_FOLLOWUPS);
  }
}
