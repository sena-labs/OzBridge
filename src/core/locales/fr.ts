// IMPL: Phase 2b — Core i18n catalog — Français
import type { MessageCatalog } from 'copilot-chat-toolkit';

export const fr: MessageCatalog = {
  'welcome': '🚀 **DevForge** — Votre boîte à outils de développement propulsée par l\'IA.\n\nPlugins disponibles : {0}\n\nTapez `@dev /help` pour plus d\'informations.',
  'welcome_plugin_item': '`/{0}` — {1}',

  'plugins_title': '🔌 **Plugins Enregistrés**\n',
  'plugins_header': '| ID | Nom | Version | Statut | Source |\n|---|---|---|---|---|',
  'plugins_row': '| `{0}` | {1} | v{2} | {3} | {4} |',
  'plugins_empty': 'Aucun plugin enregistré.',

  'help_title': '📚 **Aide DevForge**\n',
  'help_core_section': '### Commandes Principales\n- `/plugins` — Lister les plugins enregistrés\n- `/help` — Afficher cette aide\n- `/config` — Afficher la configuration globale\n',
  'help_plugin_section': '### Plugin : {0} (`/{1}`)\n',
  'help_plugin_command': '- `/{0} {1}` — {2}\n',
  'help_plugin_not_found': '⚠️ Plugin `{0}` introuvable. Utilisez `/plugins` pour voir les plugins enregistrés.',

  'config_title': '⚙️ **Configuration de DevForge**\n',
  'config_plugin_section': '### {0} (`/{1}`)\n{2}\n',
  'config_no_summary': '_Aucun résumé de configuration disponible._',

  'plugin_not_found': '❌ Commande `/{0}` inconnue. Utilisez `/plugins` pour voir les plugins disponibles.',
  'subcommand_not_found': '❌ Sous-commande `{0}` inconnue pour le plugin `/{1}`. Disponibles : {2}',
};
