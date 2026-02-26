// IMPL: Phase 2b — Core i18n catalog — Русский
import type { MessageCatalog } from 'copilot-chat-toolkit';

export const ru: MessageCatalog = {
  'welcome': '🚀 **DevForge** — Инструментарий разработки на базе ИИ.\n\nДоступные плагины: {0}\n\nВведите `@dev /help` для подробной информации.',
  'welcome_plugin_item': '`/{0}` — {1}',

  'plugins_title': '🔌 **Зарегистрированные плагины**\n',
  'plugins_header': '| ID | Название | Версия | Статус | Источник |\n|---|---|---|---|---|',
  'plugins_row': '| `{0}` | {1} | v{2} | {3} | {4} |',
  'plugins_empty': 'Нет зарегистрированных плагинов.',

  'help_title': '📚 **Справка DevForge**\n',
  'help_core_section': '### Основные команды\n- `/plugins` — Список зарегистрированных плагинов\n- `/help` — Показать эту справку\n- `/config` — Показать глобальную конфигурацию\n',
  'help_plugin_section': '### Плагин: {0} (`/{1}`)\n',
  'help_plugin_command': '- `/{0} {1}` — {2}\n',
  'help_plugin_not_found': '⚠️ Плагин `{0}` не найден. Используйте `/plugins` для просмотра зарегистрированных плагинов.',

  'config_title': '⚙️ **Конфигурация DevForge**\n',
  'config_plugin_section': '### {0} (`/{1}`)\n{2}\n',
  'config_no_summary': '_Сводка конфигурации недоступна._',

  'plugin_not_found': '❌ Неизвестная команда `/{0}`. Используйте `/plugins` для просмотра доступных плагинов.',
  'subcommand_not_found': '❌ Неизвестная подкоманда `{0}` для плагина `/{1}`. Доступные: {2}',
};
