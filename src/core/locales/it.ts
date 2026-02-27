// IMPL: Phase 2b — Core i18n catalog — Italiano
import type { MessageCatalog } from 'copilot-chat-toolkit';

export const it: MessageCatalog = {
  'welcome': '🚀 **DevForge** — Il tuo toolkit di sviluppo potenziato dall\'IA.\n\nPlugin disponibili: {0}\n\nDigita `@dev /help` per maggiori info.',
  'welcome_plugin_item': '`/{0}` — {1}',

  'plugins_title': '🔌 **Plugin Registrati**\n',
  'plugins_header': '| ID | Nome | Versione | Stato | Sorgente |\n|---|---|---|---|---|',
  'plugins_row': '| `{0}` | {1} | v{2} | {3} | {4} |',
  'plugins_empty': 'Nessun plugin registrato.',

  'help_title': '📚 **Guida DevForge**\n',
  'help_core_section': '### Comandi Principali\n- `/plugins` — Lista plugin registrati\n- `/help` — Mostra questa guida\n- `/config` — Mostra configurazione globale\n',
  'help_plugin_section': '### Plugin: {0} (`/{1}`)\n',
  'help_plugin_command': '- `/{0} {1}` — {2}\n',
  'help_plugin_not_found': '⚠️ Plugin `{0}` non trovato. Usa `/plugins` per vedere i plugin registrati.',

  'config_title': '⚙️ **Configurazione DevForge**\n',
  'config_plugin_section': '### {0} (`/{1}`)\n{2}\n',
  'config_no_summary': '_Nessun riepilogo configurazione disponibile._',

  'plugin_not_found': '❌ Comando `/{0}` sconosciuto. Usa `/plugins` per vedere i plugin disponibili.',
  'subcommand_not_found': '❌ Sottocomando `{0}` sconosciuto per il plugin `/{1}`. Disponibili: {2}',
};

// ============================================================================
// Oz-specific i18n catalog — Italiano
// ============================================================================
export const oz_it: MessageCatalog = {
  // Router
  'unknown_command': '❓ Comando `/{0}` non riconosciuto.\n\n',
  'commands_help': '**Comandi disponibili:**\n- `/run` — esegui agent locale\n- `/cloud` — esegui agent cloud\n- `/status` — stato dei run\n- `/history` — cronologia run\n- `/schedule` — gestione schedule\n- `/models` — modelli disponibili\n- `/mcp` — server MCP\n- `/config` — configurazione\n- `/init` — scaffolding skills/rules\n',

  // /run
  'run_progress': 'Avvio agente Oz locale...',

  // /cloud
  'cloud_warning': '⚠️ **Lancio agent cloud** — questa operazione consuma crediti Warp.\n\nPrompt: _{0}_\n\n',
  'cloud_env': 'Environment: `{0}`\n\n',
  'cloud_env_auto': 'ℹ️ Nessun environment configurato — selezionato automaticamente: `{0}` (`{1}`)\n\n',
  'cloud_no_env': '⚠️ Nessun environment disponibile — esecuzione senza environment (non consigliato)\n\n',
  'cloud_progress': 'Lancio agent cloud...',
  'cloud_started': '🚀 **Run cloud avviata**: `{0}`\n\n',
  'cloud_polling': 'Polling in corso per i risultati...\n\n',
  'cloud_status': 'Stato: {0}...',
  'cloud_success': '✅ Agent cloud completato con successo',
  'cloud_failed': '❌ Agent cloud fallito',
  'error_polling': '❌ Errore polling: {0}\n',
  'error': '❌ Errore: {0}\n',

  // /status
  'status_detail_progress': 'Recupero stato run {0}...',
  'status_list_progress': 'Recupero lista run...',
  'status_empty': '_Nessun run trovato._\n',

  // /history
  'history_progress': 'Recupero cronologia run...',
  'history_detail_progress': 'Recupero dettagli run {0}...',
  'history_empty': '_Nessun run nella cronologia._\n',
  'history_count': '**{0} run recenti:**\n\n',
  'history_help': '**Uso:**\n- `/history` — elenca le run recenti\n- `/history <run-id>` — mostra i dettagli di una run specifica\n',

  // /schedule
  'schedule_list_progress': 'Recupero schedule...',
  'schedule_list_empty': '_Nessuno schedule trovato._\n',
  'schedule_create_usage': '**Uso**: `/schedule create <name> "<cron>" "<prompt>"`\n\nEsempio: `/schedule create daily-lint "0 9 * * *" "Run linting"`\n_Puoi usare apici singoli o doppi._\n',
  'schedule_create_progress': 'Creazione schedule "{0}"...',
  'schedule_created': '✅ **Schedule creato**: `{0}` (ID: `{1}`)\n\nCron: `{2}`\n',
  'schedule_pause_usage': '**Uso**: `/schedule pause <id>`\n',
  'schedule_pause_progress': 'Pausa schedule {0}...',
  'schedule_paused': '⏸️ Schedule `{0}` messo in pausa.\n',
  'schedule_unpause_usage': '**Uso**: `/schedule unpause <id>`\n',
  'schedule_unpause_progress': 'Ripresa schedule {0}...',
  'schedule_unpaused': '▶️ Schedule `{0}` riattivato.\n',
  'schedule_delete_usage': '**Uso**: `/schedule delete <id>`\n',
  'schedule_delete_progress': 'Eliminazione schedule {0}...',
  'schedule_deleted': '🗑️ Schedule `{0}` eliminato.\n',
  'schedule_help': '**Comandi disponibili**:\n- `/schedule list` — lista tutti gli schedule\n- `/schedule create <name> "<cron>" "<prompt>"` — crea uno schedule\n- `/schedule pause <id>` — metti in pausa\n- `/schedule unpause <id>` — riattiva\n- `/schedule delete <id>` — elimina\n',

  // /models
  'models_progress': 'Recupero modelli disponibili...',
  'models_empty': '_Nessun modello trovato._\n',
  'models_count': '**{0} modelli disponibili:**\n\n',
  'models_default': '\n_Modello predefinito: `{0}`_\n',

  // /mcp
  'mcp_progress': 'Recupero server MCP...',
  'mcp_empty': '_Nessun server MCP configurato._\n',
  'mcp_count': '**{0} server MCP configurati:**\n\n',

  // /config (Oz-specific)
  'oz_config_title': '## ⚙️ Configurazione Warp Bridge\n\n',
  'oz_config_settings_header': '### Impostazioni estensione\n\n',
  'oz_config_table_header': '| Parametro | Valore |\n| --- | --- |\n',
  'oz_config_cli_title': '### Stato Oz CLI\n\n',
  'oz_config_available': '✅ **Disponibile** — versione: `{0}`\n\n',
  'oz_config_profiles_header': '**Profili:**\n',
  'oz_config_envs_header': '**Environments:**\n',
  'oz_config_integrations_header': '**Integrazioni:**\n',
  'oz_config_unavailable': '❌ **Non disponibile** — installa Warp e verifica che `oz` sia nel PATH.\n',
  'oz_config_install_button': '📥 Installa Warp',
  'oz_config_error': '❌ Errore imprevisto: {0}\n',

  // /init
  'init_no_workspace': '❌ Nessun workspace aperto. Apri una cartella prima di usare `/init`.\n',
  'init_progress': 'Scaffolding Warp Skills e Rules...',
  'init_done': '## ✅ Scaffolding completato\n\n',
  'init_created': '- **{0}** file creati\n',
  'init_skipped': '- **{0}** file già esistenti (non sovrascritti)\n',
  'init_structure': '\n### Struttura creata\n\n',

  // OutputFormatter
  'fmt_run_header': '{0} **Agent run** — stato: `{1}`',
  'fmt_run_id': '**Run ID**: `{0}`\n\n',
  'fmt_run_duration': '⏱️ Durata: {0}s\n\n',
  'fmt_open_warp': '🔗 Apri in Warp',
  'fmt_open_warp_app': '🖥️ Apri in Warp (app)',
  'fmt_open_warp_web': '🌐 Apri nel browser',
  'fmt_list_empty': '_Nessun elemento trovato._\n',
  'fmt_truncated': '\n\n---\n_… output troncato ({0} caratteri rimanenti). Usa `/status` con il Run ID per l\'output completo._\n',
  'fmt_err_not_found': '⚠️ **Oz CLI non trovato.** Assicurati che Warp sia installato e `oz` sia nel PATH.\n\n',
  'fmt_err_install': '📥 Installa Warp',
  'fmt_err_not_auth': '🔒 **Non autenticato.** Effettua il login a Warp.\n\n',
  'fmt_err_login': '🔑 Login Warp',
  'fmt_err_timeout': '⏰ **Timeout.** L\'operazione ha superato il limite di {0}s.\n\nPuoi aumentare il timeout in Settings → Warp Bridge → Timeout.\n',
  'fmt_err_cancelled': '🚫 **Operazione annullata.**\n',
  'fmt_err_parse': '⚠️ **Errore di parsing.** Output inatteso da Oz CLI.\n\n',
  'fmt_err_cli': '❌ **Errore CLI** (exit code {0}):\n\n',
  'fmt_err_stderr': '\n**stderr:**\n',

  // Extension activation
  'ext_cli_not_found': 'Warp Bridge: Oz CLI non trovato. Installa Warp per usare @warp nel chat.',
  'ext_install_warp': 'Installa Warp',

  // Follow-up labels
  'followup_check_status': '📊 Controlla stato run',
  'followup_list_models': '🤖 Lista modelli',
  'followup_run_local': '🚀 Avvia agent locale',
  'followup_run_cloud': '☁️ Avvia agent cloud',
  'followup_config': '⚙️ Configurazione',
  'followup_scaffold': '🏗️ Scaffold skill files',
  'followup_run_agent': '🚀 Avvia agent',
};
