// IMPL: Phase 2b — Core i18n catalog — Português
import type { MessageCatalog } from 'copilot-chat-toolkit';

export const pt: MessageCatalog = {
  'welcome': '🚀 **DevForge** — Seu toolkit de desenvolvimento com IA.\n\nPlugins disponíveis: {0}\n\nDigite `@dev /help` para mais informações.',
  'welcome_plugin_item': '`/{0}` — {1}',

  'plugins_title': '🔌 **Plugins Registrados**\n',
  'plugins_header': '| ID | Nome | Versão | Status | Origem |\n|---|---|---|---|---|',
  'plugins_row': '| `{0}` | {1} | v{2} | {3} | {4} |',
  'plugins_empty': 'Nenhum plugin registrado.',

  'help_title': '📚 **Ajuda do DevForge**\n',
  'help_core_section': '### Comandos Principais\n- `/plugins` — Listar plugins registrados\n- `/help` — Mostrar esta ajuda\n- `/config` — Mostrar configuração global\n',
  'help_plugin_section': '### Plugin: {0} (`/{1}`)\n',
  'help_plugin_command': '- `/{0} {1}` — {2}\n',
  'help_plugin_not_found': '⚠️ Plugin `{0}` não encontrado. Use `/plugins` para ver os plugins registrados.',

  'config_title': '⚙️ **Configuração do DevForge**\n',
  'config_plugin_section': '### {0} (`/{1}`)\n{2}\n',
  'config_no_summary': '_Nenhum resumo de configuração disponível._',

  'plugin_not_found': '❌ Comando `/{0}` desconhecido. Use `/plugins` para ver os plugins disponíveis.',
  'subcommand_not_found': '❌ Subcomando `{0}` desconhecido para o plugin `/{1}`. Disponíveis: {2}',
};
