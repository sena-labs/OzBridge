// IMPL: Phase 2b — Core i18n catalog — Español
import type { MessageCatalog } from 'copilot-chat-toolkit';

export const es: MessageCatalog = {
  'welcome': '🚀 **DevForge** — Tu toolkit de desarrollo impulsado por IA.\n\nPlugins disponibles: {0}\n\nEscribe `@dev /help` para más información.',
  'welcome_plugin_item': '`/{0}` — {1}',

  'plugins_title': '🔌 **Plugins Registrados**\n',
  'plugins_header': '| ID | Nombre | Versión | Estado | Origen |\n|---|---|---|---|---|',
  'plugins_row': '| `{0}` | {1} | v{2} | {3} | {4} |',
  'plugins_empty': 'No hay plugins registrados.',

  'help_title': '📚 **Ayuda de DevForge**\n',
  'help_core_section': '### Comandos Principales\n- `/plugins` — Listar plugins registrados\n- `/help` — Mostrar esta ayuda\n- `/config` — Mostrar configuración global\n',
  'help_plugin_section': '### Plugin: {0} (`/{1}`)\n',
  'help_plugin_command': '- `/{0} {1}` — {2}\n',
  'help_plugin_not_found': '⚠️ Plugin `{0}` no encontrado. Usa `/plugins` para ver los plugins registrados.',

  'config_title': '⚙️ **Configuración de DevForge**\n',
  'config_plugin_section': '### {0} (`/{1}`)\n{2}\n',
  'config_no_summary': '_No hay resumen de configuración disponible._',

  'plugin_not_found': '❌ Comando `/{0}` desconocido. Usa `/plugins` para ver los plugins disponibles.',
  'subcommand_not_found': '❌ Subcomando `{0}` desconocido para el plugin `/{1}`. Disponibles: {2}',
};
