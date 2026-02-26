// IMPL: Phase 2b — Core i18n catalog — Deutsch
import type { MessageCatalog } from 'copilot-chat-toolkit';

export const de: MessageCatalog = {
  'welcome': '🚀 **DevForge** — Ihr KI-gestütztes Entwicklungstoolkit.\n\nVerfügbare Plugins: {0}\n\nGeben Sie `@dev /help` für weitere Infos ein.',
  'welcome_plugin_item': '`/{0}` — {1}',

  'plugins_title': '🔌 **Registrierte Plugins**\n',
  'plugins_header': '| ID | Name | Version | Status | Quelle |\n|---|---|---|---|---|',
  'plugins_row': '| `{0}` | {1} | v{2} | {3} | {4} |',
  'plugins_empty': 'Keine Plugins registriert.',

  'help_title': '📚 **DevForge Hilfe**\n',
  'help_core_section': '### Hauptbefehle\n- `/plugins` — Registrierte Plugins auflisten\n- `/help` — Diese Hilfe anzeigen\n- `/config` — Globale Konfiguration anzeigen\n',
  'help_plugin_section': '### Plugin: {0} (`/{1}`)\n',
  'help_plugin_command': '- `/{0} {1}` — {2}\n',
  'help_plugin_not_found': '⚠️ Plugin `{0}` nicht gefunden. Verwenden Sie `/plugins` um registrierte Plugins zu sehen.',

  'config_title': '⚙️ **DevForge Konfiguration**\n',
  'config_plugin_section': '### {0} (`/{1}`)\n{2}\n',
  'config_no_summary': '_Keine Konfigurationszusammenfassung verfügbar._',

  'plugin_not_found': '❌ Unbekannter Befehl `/{0}`. Verwenden Sie `/plugins` um verfügbare Plugins zu sehen.',
  'subcommand_not_found': '❌ Unbekannter Unterbefehl `{0}` für Plugin `/{1}`. Verfügbar: {2}',
};
