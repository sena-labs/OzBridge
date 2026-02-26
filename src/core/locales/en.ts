// IMPL: Phase 2b — Core i18n catalog — English (master)
import type { MessageCatalog } from 'copilot-chat-toolkit';

export const en: MessageCatalog = {
  // Welcome
  'welcome': '🚀 **DevForge** — Your AI-powered development toolkit.\n\nAvailable plugins: {0}\n\nType `@dev /help` for more info.',
  'welcome_plugin_item': '`/{0}` — {1}',

  // /plugins
  'plugins_title': '🔌 **Registered Plugins**\n',
  'plugins_header': '| ID | Name | Version | Status | Source |\n|---|---|---|---|---|',
  'plugins_row': '| `{0}` | {1} | v{2} | {3} | {4} |',
  'plugins_empty': 'No plugins registered.',

  // /help
  'help_title': '📚 **DevForge Help**\n',
  'help_core_section': '### Core Commands\n- `/plugins` — List registered plugins\n- `/help` — Show this help\n- `/config` — Show global configuration\n',
  'help_plugin_section': '### Plugin: {0} (`/{1}`)\n',
  'help_plugin_command': '- `/{0} {1}` — {2}\n',
  'help_plugin_not_found': '⚠️ Plugin `{0}` not found. Use `/plugins` to see registered plugins.',

  // /config
  'config_title': '⚙️ **DevForge Configuration**\n',
  'config_plugin_section': '### {0} (`/{1}`)\n{2}\n',
  'config_no_summary': '_No configuration summary available._',

  // Errors
  'plugin_not_found': '❌ Unknown command `/{0}`. Use `/plugins` to see available plugins.',
  'subcommand_not_found': '❌ Unknown subcommand `{0}` for plugin `/{1}`. Available: {2}',
};

// ============================================================================
// Oz-specific i18n catalog — English
// ============================================================================
export const oz_en: MessageCatalog = {
  // Router
  'unknown_command': '❓ Unknown command `/{0}`.\n\n',
  'commands_help': '**Available commands:**\n- `/run` — run local agent\n- `/cloud` — run cloud agent\n- `/status` — run status\n- `/schedule` — schedule management\n- `/models` — available models\n- `/mcp` — MCP servers\n- `/config` — configuration\n- `/init` — scaffold skills/rules\n',

  // /run
  'run_progress': 'Starting local Oz agent...',

  // /cloud
  'cloud_warning': '⚠️ **Launching cloud agent** — this operation consumes Warp credits.\n\nPrompt: _{0}_\n\n',
  'cloud_env': 'Environment: `{0}`\n\n',
  'cloud_env_auto': 'ℹ️ No environment configured — auto-selected: `{0}` (`{1}`)\n\n',
  'cloud_no_env': '⚠️ No environments available — running without environment (not recommended)\n\n',
  'cloud_progress': 'Launching cloud agent...',
  'cloud_started': '🚀 **Cloud run started**: `{0}`\n\n',
  'cloud_polling': 'Polling for results...\n\n',
  'cloud_status': 'Status: {0}...',
  'cloud_success': '✅ Cloud agent completed successfully',
  'cloud_failed': '❌ Cloud agent failed',
  'error_polling': '❌ Polling error: {0}\n',
  'error': '❌ Error: {0}\n',

  // /status
  'status_detail_progress': 'Fetching run status {0}...',
  'status_list_progress': 'Fetching run list...',
  'status_empty': '_No runs found._\n',

  // /schedule
  'schedule_list_progress': 'Fetching schedules...',
  'schedule_list_empty': '_No schedules found._\n',
  'schedule_create_usage': '**Usage**: `/schedule create <name> "<cron>" "<prompt>"`\n\nExample: `/schedule create daily-lint "0 9 * * *" "Run linting"`\n_You can use single or double quotes._\n',
  'schedule_create_progress': 'Creating schedule "{0}"...',
  'schedule_created': '✅ **Schedule created**: `{0}` (ID: `{1}`)\n\nCron: `{2}`\n',
  'schedule_pause_usage': '**Usage**: `/schedule pause <id>`\n',
  'schedule_pause_progress': 'Pausing schedule {0}...',
  'schedule_paused': '⏸️ Schedule `{0}` paused.\n',
  'schedule_unpause_usage': '**Usage**: `/schedule unpause <id>`\n',
  'schedule_unpause_progress': 'Resuming schedule {0}...',
  'schedule_unpaused': '▶️ Schedule `{0}` resumed.\n',
  'schedule_delete_usage': '**Usage**: `/schedule delete <id>`\n',
  'schedule_delete_progress': 'Deleting schedule {0}...',
  'schedule_deleted': '🗑️ Schedule `{0}` deleted.\n',
  'schedule_help': '**Available commands**:\n- `/schedule list` — list all schedules\n- `/schedule create <name> "<cron>" "<prompt>"` — create a schedule\n- `/schedule pause <id>` — pause\n- `/schedule unpause <id>` — resume\n- `/schedule delete <id>` — delete\n',

  // /models
  'models_progress': 'Fetching available models...',
  'models_empty': '_No models found._\n',
  'models_count': '**{0} models available:**\n\n',
  'models_default': '\n_Default model: `{0}`_\n',

  // /mcp
  'mcp_progress': 'Fetching MCP servers...',
  'mcp_empty': '_No MCP servers configured._\n',
  'mcp_count': '**{0} MCP servers configured:**\n\n',

  // /config (Oz-specific)
  'oz_config_title': '## ⚙️ Warp Bridge Configuration\n\n',
  'oz_config_settings_header': '### Extension Settings\n\n',
  'oz_config_table_header': '| Parameter | Value |\n| --- | --- |\n',
  'oz_config_cli_title': '### Oz CLI Status\n\n',
  'oz_config_available': '✅ **Available** — version: `{0}`\n\n',
  'oz_config_profiles_header': '**Profiles:**\n',
  'oz_config_envs_header': '**Environments:**\n',
  'oz_config_integrations_header': '**Integrations:**\n',
  'oz_config_unavailable': '❌ **Not available** — install Warp and verify `oz` is in your PATH.\n',
  'oz_config_install_button': '📥 Install Warp',
  'oz_config_error': '❌ Unexpected error: {0}\n',

  // /init
  'init_no_workspace': '❌ No workspace open. Open a folder before using `/init`.\n',
  'init_progress': 'Scaffolding Warp Skills and Rules...',
  'init_done': '## ✅ Scaffolding complete\n\n',
  'init_created': '- **{0}** files created\n',
  'init_skipped': '- **{0}** files already exist (not overwritten)\n',
  'init_structure': '\n### Created Structure\n\n',

  // OutputFormatter
  'fmt_run_header': '{0} **Agent run** — status: `{1}`',
  'fmt_run_id': '**Run ID**: `{0}`\n\n',
  'fmt_run_duration': '⏱️ Duration: {0}s\n\n',
  'fmt_open_warp': '🔗 Open in Warp',
  'fmt_open_warp_app': '🖥️ Open in Warp (app)',
  'fmt_open_warp_web': '🌐 Open in browser',
  'fmt_list_empty': '_No items found._\n',
  'fmt_truncated': '\n\n---\n_… output truncated ({0} chars remaining). Use `/status` with the Run ID for full output._\n',
  'fmt_err_not_found': '⚠️ **Oz CLI not found.** Make sure Warp is installed and `oz` is in your PATH.\n\n',
  'fmt_err_install': '📥 Install Warp',
  'fmt_err_not_auth': '🔒 **Not authenticated.** Please log in to Warp.\n\n',
  'fmt_err_login': '🔑 Login Warp',
  'fmt_err_timeout': '⏰ **Timeout.** Operation exceeded the {0}s limit.\n\nYou can increase the timeout in Settings → Warp Bridge → Timeout.\n',
  'fmt_err_cancelled': '🚫 **Operation cancelled.**\n',
  'fmt_err_parse': '⚠️ **Parsing error.** Unexpected output from Oz CLI.\n\n',
  'fmt_err_cli': '❌ **CLI Error** (exit code {0}):\n\n',
  'fmt_err_stderr': '\n**stderr:**\n',

  // Extension activation
  'ext_cli_not_found': 'Warp Bridge: Oz CLI not found. Install Warp to use @warp in chat.',
  'ext_install_warp': 'Install Warp',

  // Follow-up labels
  'followup_check_status': '📊 Check run status',
  'followup_list_models': '🤖 List models',
  'followup_run_local': '🚀 Run local agent',
  'followup_run_cloud': '☁️ Run cloud agent',
  'followup_config': '⚙️ Configuration',
  'followup_scaffold': '🏗️ Scaffold skill files',
  'followup_run_agent': '🚀 Run agent',
};
