// IMPL: Phase 2b — Core i18n catalog — 中文
import type { MessageCatalog } from 'copilot-chat-toolkit';

export const zh: MessageCatalog = {
  'welcome': '🚀 **DevForge** — AI驱动的开发工具包。\n\n可用插件: {0}\n\n输入 `@dev /help` 获取更多信息。',
  'welcome_plugin_item': '`/{0}` — {1}',

  'plugins_title': '🔌 **已注册插件**\n',
  'plugins_header': '| ID | 名称 | 版本 | 状态 | 来源 |\n|---|---|---|---|---|',
  'plugins_row': '| `{0}` | {1} | v{2} | {3} | {4} |',
  'plugins_empty': '没有已注册的插件。',

  'help_title': '📚 **DevForge 帮助**\n',
  'help_core_section': '### 核心命令\n- `/plugins` — 列出已注册插件\n- `/help` — 显示此帮助\n- `/config` — 显示全局配置\n',
  'help_plugin_section': '### 插件: {0} (`/{1}`)\n',
  'help_plugin_command': '- `/{0} {1}` — {2}\n',
  'help_plugin_not_found': '⚠️ 未找到插件 `{0}`。使用 `/plugins` 查看已注册插件。',

  'config_title': '⚙️ **DevForge 配置**\n',
  'config_plugin_section': '### {0} (`/{1}`)\n{2}\n',
  'config_no_summary': '_没有可用的配置摘要。_',

  'plugin_not_found': '❌ 未知命令 `/{0}`。使用 `/plugins` 查看可用插件。',
  'subcommand_not_found': '❌ 插件 `/{1}` 的未知子命令 `{0}`。可用: {2}',
};
