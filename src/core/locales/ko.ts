// IMPL: Phase 2b — Core i18n catalog — 한국어
import type { MessageCatalog } from 'copilot-chat-toolkit';

export const ko: MessageCatalog = {
  'welcome': '🚀 **DevForge** — AI 기반 개발 툴킷.\n\n사용 가능한 플러그인: {0}\n\n`@dev /help`를 입력하여 자세한 정보를 확인하세요.',
  'welcome_plugin_item': '`/{0}` — {1}',

  'plugins_title': '🔌 **등록된 플러그인**\n',
  'plugins_header': '| ID | 이름 | 버전 | 상태 | 소스 |\n|---|---|---|---|---|',
  'plugins_row': '| `{0}` | {1} | v{2} | {3} | {4} |',
  'plugins_empty': '등록된 플러그인이 없습니다.',

  'help_title': '📚 **DevForge 도움말**\n',
  'help_core_section': '### 핵심 명령\n- `/plugins` — 등록된 플러그인 목록\n- `/help` — 이 도움말 표시\n- `/config` — 전역 설정 표시\n',
  'help_plugin_section': '### 플러그인: {0} (`/{1}`)\n',
  'help_plugin_command': '- `/{0} {1}` — {2}\n',
  'help_plugin_not_found': '⚠️ 플러그인 `{0}`을(를) 찾을 수 없습니다. `/plugins`로 등록된 플러그인을 확인하세요.',

  'config_title': '⚙️ **DevForge 설정**\n',
  'config_plugin_section': '### {0} (`/{1}`)\n{2}\n',
  'config_no_summary': '_사용 가능한 설정 요약이 없습니다._',

  'plugin_not_found': '❌ 알 수 없는 명령 `/{0}`. `/plugins`로 사용 가능한 플러그인을 확인하세요.',
  'subcommand_not_found': '❌ 플러그인 `/{1}`의 알 수 없는 하위 명령 `{0}`. 사용 가능: {2}',
};
