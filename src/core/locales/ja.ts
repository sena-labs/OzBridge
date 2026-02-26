// IMPL: Phase 2b — Core i18n catalog — 日本語
import type { MessageCatalog } from 'copilot-chat-toolkit';

export const ja: MessageCatalog = {
  'welcome': '🚀 **DevForge** — AI搭載の開発ツールキット。\n\n利用可能なプラグイン: {0}\n\n`@dev /help` で詳細を表示。',
  'welcome_plugin_item': '`/{0}` — {1}',

  'plugins_title': '🔌 **登録済みプラグイン**\n',
  'plugins_header': '| ID | 名前 | バージョン | ステータス | ソース |\n|---|---|---|---|---|',
  'plugins_row': '| `{0}` | {1} | v{2} | {3} | {4} |',
  'plugins_empty': '登録されたプラグインはありません。',

  'help_title': '📚 **DevForge ヘルプ**\n',
  'help_core_section': '### コアコマンド\n- `/plugins` — 登録済みプラグイン一覧\n- `/help` — このヘルプを表示\n- `/config` — グローバル設定を表示\n',
  'help_plugin_section': '### プラグイン: {0} (`/{1}`)\n',
  'help_plugin_command': '- `/{0} {1}` — {2}\n',
  'help_plugin_not_found': '⚠️ プラグイン `{0}` が見つかりません。`/plugins` で登録済みプラグインを確認してください。',

  'config_title': '⚙️ **DevForge 設定**\n',
  'config_plugin_section': '### {0} (`/{1}`)\n{2}\n',
  'config_no_summary': '_設定の概要はありません。_',

  'plugin_not_found': '❌ 不明なコマンド `/{0}`。`/plugins` で利用可能なプラグインを確認してください。',
  'subcommand_not_found': '❌ プラグイン `/{1}` の不明なサブコマンド `{0}`。利用可能: {2}',
};
