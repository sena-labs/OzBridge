# DEVFORGE — Piano di Implementazione

**Data**: 25 febbraio 2026
**Input**: SPEC-DEVFORGE.md v3.0 + ARCHITECTURE-DEVFORGE.md v3.1
**Destinatario**: Implement Agent

---

## Premessa

Questo documento definisce la sequenza **fase-per-fase** di refactoring
da `warp-vsc-bridge` a **DevForge**. Ogni fase è autocontenuta:
al termine di ogni fase, `tsc`, `vitest` e `esbuild` devono passare.

**Stato attuale**: 412 test, 99.61% coverage, 25.4KB bundle.
**Target finale**: ≥ 450 test, ≥ 95% coverage, ≤ 100KB bundle.

---

## Sequenza delle fasi

```
Phase 1 ─── Infrastruttura toolkit (i18n + IPlugin types)
Phase 2 ─── Core engine (PluginRegistry, Router, Followups)
Phase 2b ── i18n cataloghi + init (core locales)
Phase 3 ─── Plugin Oz (migrazione src/ → plugins/oz/)
Phase 4 ─── Plugin Shell (nuovo)
Phase 5 ─── Rename globale + package.json + extension.ts
Phase 5b ── Cataloghi locale Oz + Shell (10 lingue ciascuno)
Phase 6 ─── Pulizia + ConfigMigrator + docs + l10n bundles
```

---

## Phase 1 — Infrastruttura toolkit

**Obiettivo**: Aggiungere tipi `IPlugin` e servizio i18n nel sdk generico.

### File da creare

| File | Contenuto |
|------|-----------|
| `packages/copilot-chat-toolkit/src/i18n/types.ts` | `MessageCatalog`, `LocaleBundle`, `II18nService` — vedi §3.2 dell'architettura |
| `packages/copilot-chat-toolkit/src/i18n/i18nService.ts` | Classe `I18nService` con `registerCatalog()`, `t()`, fallback chain locale→en→raw key, placeholder `{0}..{N}` |

### File da modificare

| File | Cosa cambia |
|------|-------------|
| `packages/copilot-chat-toolkit/src/types.ts` | Aggiungere: `IPlugin`, `PluginContext`, `PluginRegistration`, `PluginInfo`, `PluginRegistryChangeEvent`, `IPluginLogger`, `IContextCollector` (interfaccia), `SlashCommandHandler` type. Vedi §3.1 dell'architettura per firme esatte |
| `packages/copilot-chat-toolkit/src/index.ts` | Aggiungere export: `export * from './i18n/types';`, `export { I18nService } from './i18n/i18nService';`, export dei nuovi tipi da types.ts |

### Test da creare

| File | Cosa testa |
|------|-----------|
| `test/core/i18n.test.ts` | I18nService: registrazione catalogo, lookup, fallback en, fallback raw key, placeholders, locale sconosciuto, namespace sconosciuto, chiave mancante |

Nota: il test è in `test/core/` anche se il servizio è nel toolkit, perché l'estensione ha i test tutti sotto `test/`.

### Gate di verifica

```bash
cd packages/copilot-chat-toolkit && npx tsc --noEmit   # ✅ compila
cd ../.. && npx vitest run                               # ✅ tutti i test passano
npx esbuild ...                                          # ✅ build
```

---

## Phase 2 — Core engine

**Obiettivo**: Creare i moduli core che gestiscono plugin, routing e followup.

### File da creare

| File | Contenuto | Dettagli architettura |
|------|-----------|----------------------|
| `src/core/pluginRegistry.ts` | `PluginRegistry` class: `register(plugin, source)`, `get(id)`, `getAll()`, `disposeAll()`, `onDidChange` event emitter. Validazione unicità namespace. Try/catch su activate(). Vedi §3.3 | Map<string, PluginInfo>. EventEmitter per PluginRegistryChangeEvent |
| `src/core/hierarchicalRouter.ts` | `HierarchicalRouter` class: `handleRequest(request, stream, token)`. Parsing namespace + subcommand. Dispatch a core commands o plugin commands. Vedi §3.4 | Algoritmo: 1) no command→welcome, 2) coreCommand→handler, 3) pluginNamespace→subcommand dispatch, 4) error |
| `src/core/aggregatedFollowups.ts` | `AggregatedFollowupProvider` class: legge `result.metadata.namespace`, ottiene followup dal plugin, trasforma namespace. Vedi §3.5 | Usa PluginRegistry per lookup. Trasforma followup interni aggiungendo namespace |
| `src/core/i18n.ts` | Facade: `initI18n(locale?)`, singleton, esporta `t()` convenience. Crea `I18nService` dal toolkit, registra catalogo core | Singleton. Il modulo chiama `new I18nService(locale)` e `registerCatalog('core', CORE_MESSAGES)` |
| `src/core/pluginsCommand.ts` | Handler `/plugins`: lista tutti i plugin registrati con status. Usa `t('core.plugins_*')` per output | Format: tabella con id, displayName, version, status, source |
| `src/core/helpCommand.ts` | Handler `/help`: mostra guida per DevForge. Elenca comandi core + per ogni plugin i subcommand. Usa `t('core.help_*')` | Se `/help oz` → mostra solo subcommand di oz con descrizioni |
| `src/core/configCommand.ts` | Handler `/config` globale: mostra riepilogo config di tutti i plugin. Chiama `registration.configSummary()` per ogni plugin. Vedi D1 architettura | Distinto da /oz config! Questo è il globale |

### File da creare — comandi core da `coreCommands` Map

I 3 comandi core (`/plugins`, `/help`, `/config`) devono essere wrappati in `SlashCommandHandler` factory functions che ricevono `PluginRegistry` e `II18nService`.

```typescript
// Pattern per ogni comando core:
export function createPluginsCommand(
  registry: PluginRegistry,
  i18n: II18nService
): SlashCommandHandler {
  return async (prompt, stream, token) => { ... };
}
```

### Test da creare

| File | Cosa testa |
|------|-----------|
| `test/core/pluginRegistry.test.ts` | register, get, getAll, duplicato→errore, activate crash→status error, disposeAll, onDidChange events |
| `test/core/hierarchicalRouter.test.ts` | no command→welcome, core command dispatch, plugin namespace dispatch, subcommand parsing, unknown namespace→error, empty subcommand→plugin help |
| `test/core/aggregatedFollowups.test.ts` | namespace lookup, followup transformation, no followup→default, unknown namespace |
| `test/core/pluginsCommand.test.ts` | lista plugin, format output, plugin con errore |
| `test/core/helpCommand.test.ts` | help generico, help specifico per plugin, plugin sconosciuto |
| `test/core/configCommand.test.ts` | config globale, configSummary per ogni plugin, nessun plugin |

### Gate di verifica

```bash
npx tsc --noEmit                 # ✅ compila
npx vitest run test/core/        # ✅ nuovi test passano
npx vitest run                   # ✅ TUTTI i test passano (vecchi + nuovi)
```

---

## Phase 2b — i18n cataloghi core

**Obiettivo**: Creare i cataloghi localizzati per i comandi core.

### File da creare (10)

| File | Contenuto |
|------|-----------|
| `src/core/locales/en.ts` | Catalogo inglese (~15 chiavi). Export: `const en: MessageCatalog = { ... }` |
| `src/core/locales/it.ts` | Catalogo italiano |
| `src/core/locales/es.ts` | Catalogo spagnolo |
| `src/core/locales/fr.ts` | Catalogo francese |
| `src/core/locales/de.ts` | Catalogo tedesco |
| `src/core/locales/pt.ts` | Catalogo portoghese |
| `src/core/locales/ja.ts` | Catalogo giapponese |
| `src/core/locales/zh.ts` | Catalogo cinese |
| `src/core/locales/ko.ts` | Catalogo coreano |
| `src/core/locales/ru.ts` | Catalogo russo |

### Chiavi del catalogo core (~15)

```typescript
// src/core/locales/en.ts
import { MessageCatalog } from 'copilot-chat-toolkit';

export const en: MessageCatalog = {
  // Welcome
  'welcome': '🚀 **DevForge** — Your AI-powered development toolkit.\n\nAvailable plugins: {0}\n\nType `@dev /help` for more info.',
  'welcome_plugin_item': '`/{0}` — {1}',

  // /plugins
  'plugins_title': '🔌 **Registered Plugins**\n',
  'plugins_row': '| `{0}` | {1} | v{2} | {3} | {4} |',
  'plugins_header': '| ID | Name | Version | Status | Source |\n|---|---|---|---|---|',
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
```

Le altre 9 lingue traducono le stesse chiavi.

### File da creare — aggregatore locales

| File | Contenuto |
|------|-----------|
| (in `src/core/i18n.ts`) | Import tutti i locales e comporre `CORE_MESSAGES: LocaleBundle` |

```typescript
// Pattern per CORE_MESSAGES bundle:
import { en } from './locales/en';
import { it } from './locales/it';
// ... etc
export const CORE_MESSAGES: LocaleBundle = { en, it, es, fr, de, pt, ja, zh, ko, ru };
```

### Gate di verifica

```bash
npx tsc --noEmit       # ✅
npx vitest run         # ✅
```

---

## Phase 3 — Plugin Oz (migrazione)

**Obiettivo**: Spostare tutto il codice Oz da `src/` a `src/plugins/oz/`, implementare `IPlugin`, convertire stringhe a `t()`.

### Sequenza operazioni

#### 3.1 Creare struttura cartelle

```
src/plugins/oz/
src/plugins/oz/commands/
src/plugins/oz/locales/
```

#### 3.2 Estrarre tipi Oz

| Azione | Dettagli |
|--------|---------|
| Creare `src/plugins/oz/types.ts` | Estrarre da `src/types/index.ts`: `OzPluginConfig` (rinomina da `WarpBridgeConfig`), `DEFAULT_OZ_CONFIG` (rinomina da `DEFAULT_CONFIG`), `RunDto`, `ModelDto`, `ScheduleDto`, `McpServerDto`, `OzAgentRunOptions`, `OzConfigDto`, `IOzCliService`, `IConfigManager`, `IRunPoller`, `AGENT_SKILL_MAP`, `OzCliError` enum. Aggiornare naming: tutti i riferimenti "Warp" → "DevForge" o "Oz" nel contesto appropriato |

#### 3.3 Spostare servizi

| Da | A | Modifiche |
|----|---|-----------|
| `src/services/ozCliService.ts` | `src/plugins/oz/ozCliService.ts` | Import path: `../types` → `./types`. `WarpBridgeConfig` → `OzPluginConfig`. Config section invariato per ora (si aggiornerà a Phase 5) |
| `src/services/configManager.ts` | `src/plugins/oz/configManager.ts` | Import path. Section: `'warpBridge'` → `'devforge.oz'`. Type: usa `OzPluginConfig` |
| `src/services/runPoller.ts` | `src/plugins/oz/runPoller.ts` | Import path |

#### 3.4 Spostare output formatter e followups

| Da | A | Modifiche |
|----|---|-----------|
| `src/parsers/outputFormatter.ts` | `src/plugins/oz/outputFormatter.ts` | Tutte le stringhe hardcoded → `t('oz.key')`. Riceve `II18nService` nel costruttore o come parametro. URL hardcoded → config-driven (FormatterOptions) |
| `src/participant/followups.ts` | `src/plugins/oz/followups.ts` | `WARP_FOLLOWUPS` → `OZ_FOLLOWUPS`. `WARP_FOLLOWUP_DEFAULTS` → `OZ_FOLLOWUP_DEFAULTS`. Label → `t('oz.followup_*')`. Seguire pattern FollowupProvider toolkit |

#### 3.5 Spostare comandi

| Da | A | Modifiche principali |
|----|---|---------------------|
| `src/commands/runCommand.ts` | `src/plugins/oz/commands/run.ts` | Aggiungere parametro `i18n: II18nService`. Stringhe italiane → `t('oz.run_*')`. Import path |
| `src/commands/cloudCommand.ts` | `src/plugins/oz/commands/cloud.ts` | Idem. Attenzione: ha la logica credit warning e polling |
| `src/commands/statusCommand.ts` | `src/plugins/oz/commands/status.ts` | Import + stringhe |
| `src/commands/scheduleCommand.ts` | `src/plugins/oz/commands/schedule.ts` | Import + stringhe. 5 subcommand: list, create, pause, unpause, delete |
| `src/commands/modelsCommand.ts` | `src/plugins/oz/commands/models.ts` | Import + stringhe |
| `src/commands/mcpCommand.ts` | `src/plugins/oz/commands/mcp.ts` | Import + stringhe |
| `src/commands/configCommand.ts` | `src/plugins/oz/commands/config.ts` | Import + stringhe. Questo diventa `/oz config` (deep plugin config) |
| `src/commands/initCommand.ts` | `src/plugins/oz/commands/init.ts` | Import + stringhe. Directory `.warp/` → mantenere per Oz, è Oz-specific |
| `src/commands/skillDetector.ts` | `src/plugins/oz/skillDetector.ts` | Import path |

#### 3.6 Creare OzPlugin

| File | Contenuto |
|------|-----------|
| `src/plugins/oz/index.ts` | `class OzPlugin implements IPlugin`. Vedi §3.7 dell'architettura. Crea servizi, registra catalogo i18n, restituisce `PluginRegistration` |

#### 3.7 Spostare test

| Da | A |
|----|---|
| `test/services/ozCliService.test.ts` | `test/plugins/oz/ozCliService.test.ts` |
| `test/services/ozCliServiceEdge.test.ts` | `test/plugins/oz/ozCliServiceEdge.test.ts` |
| `test/services/configManager.test.ts` | `test/plugins/oz/configManager.test.ts` |
| `test/services/runPoller.test.ts` | `test/plugins/oz/runPoller.test.ts` |
| `test/parsers/outputFormatter.test.ts` | `test/plugins/oz/outputFormatter.test.ts` |
| `test/parsers/outputFormatterEdge.test.ts` | `test/plugins/oz/outputFormatterEdge.test.ts` |
| `test/participant/followups.test.ts` | `test/plugins/oz/followups.test.ts` |
| `test/commands/skillDetector.test.ts` | `test/plugins/oz/skillDetector.test.ts` |
| `test/commands/cloudCommand.test.ts` | `test/plugins/oz/commands/cloud.test.ts` |
| `test/commands/configCommand.test.ts` | `test/plugins/oz/commands/config.test.ts` |
| `test/commands/scheduleCommand.test.ts` | `test/plugins/oz/commands/schedule.test.ts` |
| `test/commands/initCommand.test.ts` | `test/plugins/oz/commands/init.test.ts` |
| `test/commands/runCommand.test.ts` | `test/plugins/oz/commands/run.test.ts` |
| `test/commands/readCommands.test.ts` | `test/plugins/oz/commands/readCommands.test.ts` |

- Aggiornare tutti gli import path
- Mockare `II18nService` (mock `t(key) => key` per mantenere semplicità)

#### 3.8 Creare test integrazione plugin

| File | Cosa testa |
|------|-----------|
| `test/plugins/oz/ozPlugin.test.ts` | `OzPlugin.activate()` → verifica che restituisca 8 commands, followups, configSummary. `OzPlugin.deactivate()` → cleanup |

### Gate di verifica

```bash
npx tsc --noEmit                         # ✅
npx vitest run test/plugins/oz/          # ✅ tutti i test migrati passano
npx vitest run                           # ✅ TUTTI i test
```

**Nota critica**: Durante questa fase, i file originali in `src/commands/`, `src/services/`, `src/parsers/`, `src/participant/` e `src/types/` vengono **eliminati**. I test in `test/commands/`, `test/services/`, `test/parsers/`, `test/participant/` vengono **spostati**. Al termine della fase, queste cartelle dovrebbero essere vuote (tranne `src/services/contextCollector.ts`, `src/services/logger.ts`, `src/parsers/jsonParser.ts` che sono re-export invariati).

---

## Phase 4 — Plugin Shell

**Obiettivo**: Creare il plugin Shell con streaming exec.

### File da creare

| File | Contenuto | Note |
|------|-----------|------|
| `src/plugins/shell/types.ts` | `ShellPluginConfig { defaultShell: string, timeoutMs: number, maxOutputChars: number }`, `ShellExecResult { exitCode: number, stdout: string, stderr: string, durationMs: number, timedOut: boolean }`, `ShellExecOptions { command: string, cwd?: string, env?: Record<string,string>, onChunk?: (chunk: string, source: 'stdout'\|'stderr') => void, cancellation?: CancellationToken, timeoutMs?: number }` | |
| `src/plugins/shell/shellService.ts` | `ShellService.exec(opts: ShellExecOptions): Promise<ShellExecResult>`. Usa `child_process.spawn`. Gestisce `onChunk` callback per stdout/stderr. Cancellation via token. Timeout via `setTimeout` + kill. Durata misurata con `performance.now()` | Core della funzionalità streaming |
| `src/plugins/shell/configManager.ts` | `extends BaseConfigManager<ShellPluginConfig>`. Section: `'devforge.shell'`. Default: `{ defaultShell: process.platform === 'win32' ? 'powershell' : '/bin/bash', timeoutMs: 30000, maxOutputChars: 50000 }` | |
| `src/plugins/shell/commands/exec.ts` | `createExecCommand(service, cfgMgr, i18n): SlashCommandHandler`. Handler: apre code block, line-buffer su `onChunk`, flush finale, chiude code block, mostra exit code + durata | Vedi flusso §2.4 dell'architettura |
| `src/plugins/shell/index.ts` | `class ShellPlugin implements IPlugin`. id='shell', displayName='Shell Runner'. Activate: registra catalogo, crea config + service, ritorna commands Map con 'exec' | |

### Test da creare

| File | Cosa testa |
|------|-----------|
| `test/plugins/shell/shellService.test.ts` | exec: exit 0, exit non-zero, timeout, cancellation, onChunk callback, stderr, env passthrough |
| `test/plugins/shell/commands/exec.test.ts` | Handler: streaming markdown, code block opening/closing, line buffering, exit code display |
| `test/plugins/shell/shellPlugin.test.ts` | ShellPlugin.activate() → commands Map con 'exec'. configSummary. deactivate |

### Gate di verifica

```bash
npx tsc --noEmit                           # ✅
npx vitest run test/plugins/shell/         # ✅
npx vitest run                             # ✅
```

---

## Phase 5 — Rename globale + extension.ts

**Obiettivo**: Aggiornare `package.json`, `extension.ts`, e tutte le reference globali.

### 5.1 package.json — Modifiche

```jsonc
{
  "name": "devforge",
  "displayName": "DevForge",
  "description": "AI-powered development toolkit for VS Code",
  "publisher": "devforge",  // TODO: confirm publisher name

  "contributes": {
    "chatParticipants": [{
      "id": "devforge.dev",
      "fullName": "DevForge",
      "name": "dev",
      "description": "AI-powered development toolkit",
      "isSticky": true,
      "commands": [
        { "name": "oz", "description": "Warp Oz Cloud agent commands" },
        { "name": "shell", "description": "Execute shell commands with streaming output" },
        { "name": "plugins", "description": "List registered plugins" },
        { "name": "help", "description": "Show help and available commands" },
        { "name": "config", "description": "Show global configuration" }
      ]
    }],

    "configuration": {
      "title": "DevForge",
      "properties": {
        "devforge.oz.cliPath": {
          "type": "string",
          "default": "oz",
          "description": "Path to Oz CLI executable"
        },
        "devforge.oz.defaultModel": {
          "type": "string",
          "default": "",
          "description": "Default Oz model"
        },
        "devforge.oz.defaultProfile": {
          "type": "string",
          "default": "",
          "description": "Default Oz profile"
        },
        "devforge.oz.defaultEnvironment": {
          "type": "string",
          "default": "",
          "description": "Default Oz environment"
        },
        "devforge.oz.pollingIntervalMs": {
          "type": "number",
          "default": 3000,
          "description": "Cloud polling interval (ms)"
        },
        "devforge.oz.pollingTimeoutMs": {
          "type": "number",
          "default": 300000,
          "description": "Cloud polling timeout (ms)"
        },
        "devforge.oz.timeoutMs": {
          "type": "number",
          "default": 120000,
          "description": "Default timeout for Oz CLI commands (ms)"
        },
        "devforge.oz.maxOutputChars": {
          "type": "number",
          "default": 12000,
          "description": "Max output characters"
        },
        "devforge.shell.defaultShell": {
          "type": "string",
          "default": "",
          "description": "Default shell (empty = auto-detect)"
        },
        "devforge.shell.timeoutMs": {
          "type": "number",
          "default": 30000,
          "description": "Shell command timeout (ms)"
        },
        "devforge.shell.maxOutputChars": {
          "type": "number",
          "default": 50000,
          "description": "Max shell output characters"
        }
      }
    },

    "l10n": "./l10n"
  }
}
```

### 5.2 extension.ts — Riscrittura

```typescript
// PSEUDOCODICE — non implementare letteralmente, usa come guida

import * as vscode from 'vscode';
import { PluginRegistry } from './core/pluginRegistry';
import { HierarchicalRouter } from './core/hierarchicalRouter';
import { AggregatedFollowupProvider } from './core/aggregatedFollowups';
import { ConfigMigrator } from './core/configMigrator';
import { initI18n, t, CORE_MESSAGES } from './core/i18n';
import { createPluginsCommand } from './core/pluginsCommand';
import { createHelpCommand } from './core/helpCommand';
import { createConfigCommand } from './core/configCommand';
import { OzPlugin } from './plugins/oz';
import { ShellPlugin } from './plugins/shell';
import { initLogger, logInfo } from './services/logger';

export interface DevForgeAPI {
  readonly apiVersion: string;
  registerPlugin(plugin: IPlugin): Promise<void>;
  readonly plugins: ReadonlyMap<string, PluginInfo>;
}

export async function activate(
  context: vscode.ExtensionContext
): Promise<DevForgeAPI> {
  // 1. Logger
  const channel = vscode.window.createOutputChannel('DevForge', { log: true });
  initLogger(channel, '[devforge]');
  context.subscriptions.push(channel);

  // 2. i18n
  const i18n = initI18n(vscode.env.language);

  // 3. Plugin Registry
  const registry = new PluginRegistry();
  context.subscriptions.push({ dispose: () => registry.disposeAll() });

  // 4. Plugin Context (shared)
  const pluginContext: PluginContext = {
    logger: { info: logInfo, warn: logWarn, error: logError },
    contextCollector: new ContextCollector(),
    extensionContext: context,
    i18n,
  };

  // 5. Register built-in plugins
  await registry.register(new OzPlugin(), 'builtin', pluginContext);
  await registry.register(new ShellPlugin(), 'builtin', pluginContext);

  // 6. Core commands
  const coreCommands = new Map<string, SlashCommandHandler>([
    ['plugins', createPluginsCommand(registry, i18n)],
    ['help',    createHelpCommand(registry, i18n)],
    ['config',  createConfigCommand(registry, i18n)],
  ]);

  // 7. Router + Followups
  const router = new HierarchicalRouter(registry, coreCommands, i18n);
  const followups = new AggregatedFollowupProvider(registry);

  // 8. Register participant
  const participant = vscode.chat.createChatParticipant(
    'devforge.dev',
    (request, context, stream, token) =>
      router.handleRequest(request, context, stream, token)
  );
  participant.iconPath = vscode.Uri.joinPath(
    context.extensionUri, 'media', 'devforge-icon.png'
  );
  participant.followupProvider = followups;
  context.subscriptions.push(participant);

  // 9. Config migration
  await ConfigMigrator.migrateIfNeeded(context);

  // 10. API
  logInfo('DevForge activated');
  return {
    apiVersion: '1.0.0',
    registerPlugin: (plugin) =>
      registry.register(plugin, 'external', pluginContext),
    plugins: registry.getAll(),
  };
}

export function deactivate(): void {}
```

### 5.3 Eliminare file obsoleti

| File da eliminare | Motivo |
|-------------------|--------|
| `src/types/index.ts` | Contenuto migrato in `plugins/oz/types.ts` + toolkit |
| `src/commands/router.ts` | Sostituito da `core/hierarchicalRouter.ts` |
| `src/participant/handler.ts` | Assorbito in `extension.ts` |
| `src/participant/followups.ts` | Migrato in `plugins/oz/followups.ts` (fase 3) |
| `src/services/configManager.ts` | Migrato in `plugins/oz/configManager.ts` (fase 3) |
| `src/services/ozCliService.ts` | Migrato in `plugins/oz/ozCliService.ts` (fase 3) |
| `src/services/runPoller.ts` | Migrato in `plugins/oz/runPoller.ts` (fase 3) |
| `src/parsers/outputFormatter.ts` | Migrato in `plugins/oz/outputFormatter.ts` (fase 3) |
| `src/commands/*.ts` (8 file) | Migrati in `plugins/oz/commands/` (fase 3) |

Nota: molti di questi saranno già stati eliminati nella fase 3. In questa fase, verificare che non ne rimangano.

### 5.4 Aggiornare test

| File | Modifiche |
|------|-----------|
| `test/smoke.test.ts` | Aggiornare import `extension.ts`, verificare activate → DevForgeAPI |
| `test/extensionEdge.test.ts` | Aggiornare import, verificare plugin registry, edge cases |
| `test/commands/router.test.ts` | ELIMINARE — coperto da `test/core/hierarchicalRouter.test.ts` |
| `test/commands/routerEdge.test.ts` | ELIMINARE — coperto da `test/core/hierarchicalRouter.test.ts` |
| `test/participant/handler.test.ts` | ELIMINARE — logica in extension.ts, coperta da smoke |

### 5.5 Gate di verifica

```bash
npx tsc --noEmit               # ✅
npx vitest run                 # ✅ tutti i test
npx esbuild ...                # ✅ build genera dist/extension.js
# Verifica: dist/extension.js ≤ 100KB
```

---

## Phase 5b — Cataloghi locale Oz + Shell

**Obiettivo**: Creare tutti i cataloghi i18n per i plugin Oz e Shell.

### Inventario stringhe Oz (~83 chiavi)

Queste sono le stringhe hardcoded identificate nel codice (attualmente in italiano).

#### outputFormatter.ts (18 chiavi)

```typescript
'format.agent_result':      '🤖 **Risultato agente Oz**\n\n',
'format.credits_warning':   '⚠️ **Attenzione**: questa operazione utilizza crediti cloud.\n\n',
'format.polling_status':    '⏳ **Polling** — Run ID: `{0}` — Attendere...\n\n',
'format.run_completed':     '✅ **Esecuzione completata** (durata: {0}ms)\n\n',
'format.run_failed':        '❌ **Esecuzione fallita**: {0}\n\n',
'format.section_output':    '### Output\n',
'format.section_logs':      '### Log\n',
'format.no_output':         '_Nessun output disponibile_',
'format.install_cta':       '🔗 [Installa Warp]({0})',
'format.login_cta':         '🔗 [Accedi a Warp]({0})',
'format.view_run':          '🔗 [Visualizza run]({0})',
'format.truncated':         '\n\n⚠️ Output troncato ({0}/{1} caratteri)',
'format.error_generic':     '❌ **Errore**: {0}',
'format.error_timeout':     '⏱️ **Timeout** — Il comando ha superato il tempo limite ({0}ms)',
'format.error_not_found':   '⚠️ **Oz CLI non trovato.** Assicurati che Warp sia installato e `oz` sia nel PATH.',
'format.error_auth':        '🔒 **Non autenticato.** Esegui `oz auth login`.',
'format.error_network':     '🌐 **Errore di rete.** Controlla la connessione internet.',
'format.error_unknown':     '❌ Errore sconosciuto: {0}',
```

#### scheduleCommand.ts (14 chiavi)

```typescript
'schedule.title':           '📅 **Schedule**\n\n',
'schedule.list_header':     '### Scheduled runs\n',
'schedule.list_row':        '| `{0}` | {1} | {2} | {3} |',
'schedule.list_empty':      '_Nessuno schedule trovato._',
'schedule.created':         '✅ Schedule creato: `{0}` — cron: `{1}`',
'schedule.paused':          '⏸️ Schedule `{0}` messo in pausa.',
'schedule.unpaused':        '▶️ Schedule `{0}` riattivato.',
'schedule.deleted':         '🗑️ Schedule `{0}` eliminato.',
'schedule.error_no_id':     '⚠️ Specificare l\'ID dello schedule.',
'schedule.error_no_args':   '⚠️ Specificare prompt e cron. Esempio: `create "il mio prompt" "0 8 * * *"`',
'schedule.error_unknown_sub': '❌ Sottocomando sconosciuto: `{0}`. Disponibili: list, create, pause, unpause, delete.',
'schedule.table_header':    '| ID | Prompt | Cron | Stato |',
'schedule.table_separator': '|---|---|---|---|',
'schedule.cron_parse':      'Parsing cron: `{0}` → prossima esecuzione: {1}',
```

#### configCommand.ts (12 chiavi)

```typescript
'config.title':             '⚙️ **Configurazione Oz**\n\n',
'config.section_cli':       '### CLI\n',
'config.cli_path':          '- **Percorso**: `{0}`\n',
'config.cli_status':        '- **Stato**: {0}\n',
'config.cli_available':     '✅ Disponibile',
'config.cli_not_available': '❌ Non trovato',
'config.section_profile':   '### Profilo\n',
'config.profile_value':     '- **Profilo attivo**: `{0}`\n',
'config.section_env':       '### Ambiente\n',
'config.env_value':         '- **Ambiente**: `{0}`\n',
'config.section_model':     '### Modello\n',
'config.model_value':       '- **Modello**: `{0}`\n',
```

#### cloudCommand.ts (8 chiavi)

```typescript
'cloud.submitting':         '☁️ **Invio al cloud...**\n\n',
'cloud.submitted':          '✅ Inviato — Run ID: `{0}`\n\n',
'cloud.polling':            '⏳ Polling risultato...\n',
'cloud.credits_warning':    '⚠️ I run cloud utilizzano crediti. Vuoi continuare?\n',
'cloud.result_title':       '### Risultato Cloud\n',
'cloud.error_submit':       '❌ Errore invio: {0}',
'cloud.error_polling':      '❌ Errore polling: {0}',
'cloud.cancelled':          '🚫 Operazione annullata.',
```

#### initCommand.ts (6 chiavi)

```typescript
'init.title':               '🏗️ **Inizializzazione progetto**\n\n',
'init.already_exists':      '⚠️ Il progetto è già inizializzato (cartella `.warp/` trovata).\n',
'init.creating':            '📁 Creazione struttura progetto...\n',
'init.created':             '✅ Progetto inizializzato con successo!\n\n',
'init.created_files':       '### File creati\n',
'init.next_steps':          '### Prossimi passi\n1. Modifica `.warp/config.yaml`\n2. Esegui `@dev /oz run` per testare\n',
```

#### modelsCommand.ts (4 chiavi)

```typescript
'models.title':             '🧠 **Modelli disponibili**\n\n',
'models.row':               '| `{0}` | {1} | {2} |',
'models.header':            '| ID | Nome | Provider |\n|---|---|---|',
'models.empty':             '_Nessun modello trovato._',
```

#### runCommand.ts (3 chiavi)

```typescript
'run.executing':            '🏃 **Esecuzione locale...**\n\n',
'run.context_injected':     '📎 Contesto iniettato: {0} file, {1} selezioni\n',
'run.skill_detected':       '🎯 Skill rilevata: `{0}`\n',
```

#### statusCommand.ts (3 chiavi)

```typescript
'status.title':             '📊 **Stato run**\n\n',
'status.list_header':       '### Ultimi run\n',
'status.detail_header':     '### Dettaglio run `{0}`\n',
```

#### mcpCommand.ts (3 chiavi)

```typescript
'mcp.title':                '🔌 **Server MCP**\n\n',
'mcp.row':                  '| `{0}` | {1} | {2} |',
'mcp.header':               '| Nome | URL | Stato |\n|---|---|---|',
```

#### followups.ts (8 chiavi)

```typescript
'followup.run_status':      'Controlla lo stato',
'followup.check_models':    'Vedi modelli disponibili',
'followup.run_cloud':       'Esegui nel cloud',
'followup.view_schedule':   'Gestisci schedule',
'followup.show_config':     'Mostra configurazione',
'followup.run_local':       'Esegui localmente',
'followup.show_mcp':        'Server MCP',
'followup.init_project':    'Inizializza progetto',
```

#### extension/router → CATALOGO CORE (4 chiavi — vanno in `src/core/locales/`, NON in Oz)

```typescript
'welcome':                  '👋 Welcome to **DevForge**! Type `/help` to see available commands.',
'activated':                'DevForge activated',
'deactivated':              'DevForge deactivated',
'oz_help':                  'Available Oz commands: {0}',
```

Nota: queste chiavi sono **semanticamente core** e devono essere aggiunte al catalogo core (Phase 2b), NON al catalogo Oz. Le 83 chiavi Oz sopra non le includono.

**Totale reale**: ~83 chiavi Oz + ~15+4=~19 chiavi core + ~8 chiavi shell = ~110 chiavi totali × 10 lingue.

### File catalogo Oz da creare (10)

| File | Contiene |
|------|---------|
| `src/plugins/oz/locales/en.ts` | ~83 chiavi tradotte in inglese (MASTER — scritto per primo) |
| `src/plugins/oz/locales/it.ts` | ~83 chiavi in italiano (le stringhe attuali corrispondono) |
| `src/plugins/oz/locales/es.ts` | ~83 chiavi in spagnolo |
| `src/plugins/oz/locales/fr.ts` | ~83 chiavi in francese |
| `src/plugins/oz/locales/de.ts` | ~83 chiavi in tedesco |
| `src/plugins/oz/locales/pt.ts` | ~83 chiavi in portoghese |
| `src/plugins/oz/locales/ja.ts` | ~83 chiavi in giapponese |
| `src/plugins/oz/locales/zh.ts` | ~83 chiavi in cinese semplificato |
| `src/plugins/oz/locales/ko.ts` | ~83 chiavi in coreano |
| `src/plugins/oz/locales/ru.ts` | ~83 chiavi in russo |

### Inventario stringhe Shell (~8 chiavi)

```typescript
'exec.executing':           'Executing: `{0}`...',
'exec.completed':           'Exit: {0} ({1}ms)',
'exec.timeout':             '⏱️ Command timed out after {0}ms',
'exec.cancelled':           '🚫 Execution cancelled',
'exec.error':               '❌ Error: {0}',
'exec.empty_command':       '⚠️ Please specify a command. Usage: `/shell exec <command>`',
'config.title':             '⚙️ Shell Configuration',
'config.default_shell':     '- **Default shell**: `{0}`',
```

### File catalogo Shell da creare (10)

Stessa struttura degli Oz (10 file in `src/plugins/shell/locales/`).

### Gate di verifica

```bash
npx tsc --noEmit        # ✅
npx vitest run          # ✅
```

---

## Phase 6 — Pulizia, ConfigMigrator, docs, l10n

**Obiettivo**: Completare la transizione.

### 6.1 ConfigMigrator

| File | Contenuto |
|------|-----------|
| `src/core/configMigrator.ts` | Implementare la logica migrazione `warpBridge.*` → `devforge.oz.*`. Vedi §3.6 architettura. (Nota: il file NON è stato creato in fasi precedenti, va creato qui) |

| Test |
|------|
| `test/core/configMigrator.test.ts` | migrateIfNeeded: prima volta→migra, seconda volta→skip, solo valori modificati, target già settato→skip, nessun vecchio valore→noop |

### 6.2 l10n bundles (VS Code package.json localization)

| File da creare (10) | Contenuto |
|---------------------|-----------|
| `l10n/bundle.l10n.json` | `{}` (source inglese, stringhe già in codice) |
| `l10n/bundle.l10n.it.json` | Traduzioni per contributes.configuration.description etc. |
| `l10n/bundle.l10n.es.json` | idem |
| `l10n/bundle.l10n.fr.json` | idem |
| `l10n/bundle.l10n.de.json` | idem |
| `l10n/bundle.l10n.pt.json` | idem |
| `l10n/bundle.l10n.ja.json` | idem |
| `l10n/bundle.l10n.zh.json` | idem |
| `l10n/bundle.l10n.ko.json` | idem |
| `l10n/bundle.l10n.ru.json` | idem |

Nota: questi bundle localizzano le stringhe di `package.json` (`description`, titoli sezioni config, etc.). Non sono per il runtime — quello usa I18nService.

### 6.3 Documentazione

| File | Azione |
|------|--------|
| `README.md` | Riscrivere completamente per DevForge. Sezioni: Overview, Features, Plugin list, Quick start, Configuration, Plugin development guide, Contributing |
| `CONTRIBUTING.md` | Aggiornare nomi e riferimenti |
| `SECURITY.md` | Aggiornare nomi |
| `CHANGELOG.md` | Aggiungere entry `## [0.2.0] - DevForge Migration` |
| `docs/PLUGIN-GUIDE.md` | Creare guida per sviluppatori di plugin esterni |

### 6.4 Media

| File | Azione |
|------|--------|
| `media/devforge-icon.png` | Creare/rinominare icona. Se icona warp-icon.png esiste, rinominare. Altrimenti placeholder |

### 6.5 Pulizia finale

- Rimuovere cartelle vuote (`src/commands/`, `src/participant/`, `src/types/`)
- Rimuovere file test orfani (cartelle `test/commands/`, `test/participant/`, `test/services/`, `test/parsers/`, `test/types/` se vuote)
- Aggiornare `.gitignore` se necessario
- Aggiornare `esbuild.js` se entry point cambiato (non cambia: è sempre `src/extension.ts`)
- Rimuovere vecchio coverage (la directory `coverage/` viene rigenerata)

### 6.6 Test files invariati — conferma posizione

I seguenti test file esistono nel codebase attuale e le loro sorgenti corrispondenti (`contextCollector.ts`, `logger.ts`, `jsonParser.ts`) restano invariate. I test **NON devono essere spostati né eliminati** — rimangono nelle posizioni attuali:

| File test | Status |
|-----------|--------|
| `test/services/contextCollector.test.ts` | INVARIATO — resta in posizione |
| `test/services/logger.test.ts` | INVARIATO — resta in posizione |
| `test/parsers/jsonParser.test.ts` | INVARIATO — resta in posizione |
| `test/parsers/jsonParserEdge.test.ts` | INVARIATO — resta in posizione |
| `test/types/types.test.ts` | ELIMINARE — il sorgente `src/types/index.ts` viene eliminato. Il contenuto dei test va migrato in `test/plugins/oz/ozPlugin.test.ts` per le parti Oz-specifiche |

### 6.7 Gate di verifica FINALE

```bash
# Compilazione
npx tsc --noEmit                         # ✅ zero errori

# Test
npx vitest run                           # ✅ ≥ 450 test passano
npx vitest run --coverage                # ✅ ≥ 95% coverage

# Build
node esbuild.js                          # ✅ dist/extension.js generato
# Verifica size: ≤ 100KB

# Package
npx @vscode/vsce package --no-dependencies   # ✅ .vsix generato

# Sanity check grep
grep -ri "warp-vsc-bridge" src/ test/ packages/ package.json  # ✅ zero risultati
grep -ri "warpBridge" src/ test/ packages/                    # ✅ zero risultati (tranne ConfigMigrator)
grep -ri "@warp" src/ test/ packages/ package.json            # ✅ zero risultati
```

---

## Riepilogo quantitativo

| Metrica | Attuale | Target |
|---------|---------|--------|
| Test | 412 | ≥ 450 |
| Coverage | 99.61% | ≥ 95% |
| Bundle size | 25.4 KB | ≤ 100 KB |
| File sorgente nuovi | 0 | ~55 |
| File sorgente spostati | 0 | ~14 |
| File sorgente eliminati | 0 | ~3 |
| File sorgente modificati | 0 | ~12 |
| Lingue supportate | 1 (it) | 10 |
| Plugin | 0 | 2 (oz, shell) + architettura per esterni |

---

## Dipendenze tra fasi

```
Phase 1 ──→ Phase 2 ──→ Phase 2b ──→ Phase 3 ──→ Phase 4 ──→ Phase 5 ──→ Phase 5b ──→ Phase 6
  │                                      │
  │           ┌──────────────────────────┘
  └───────────┘
  (Phase 1 è prerequisito per Phase 3 perché
   IPlugin + I18nService devono esistere prima
   di poter creare OzPlugin)
```

**Parallelismo possibile**:
- Phase 4 (Shell) può essere sviluppata in parallelo con Phase 3 (Oz), purché Phase 1+2+2b siano completate.
- Phase 5b (cataloghi locale) può essere iniziata appena Phase 3 è completa per Oz, e Phase 4 per Shell.

---

## Checklist per l'Implement Agent

Prima di iniziare ogni fase, verificare:

- [ ] La fase precedente è completata (gate passato)
- [ ] `tsc --noEmit` compila senza errori
- [ ] Tutti i test esistenti passano
- [ ] I nuovi test coprono i nuovi moduli

Al termine di TUTTE le fasi:

- [ ] Nessun riferimento a "warp-vsc-bridge", "@warp", "warpBridge" residuo (eccetto ConfigMigrator)
- [ ] `package.json` ha nome "devforge", participant "devforge.dev"
- [ ] `extension.ts` restituisce `DevForgeAPI`
- [ ] Plugin Oz funzionante con 8 subcommand
- [ ] Plugin Shell funzionante con streaming exec
- [ ] 10 lingue supportate con fallback
- [ ] ≥ 450 test, ≥ 95% coverage
- [ ] Bundle ≤ 100KB
- [ ] VSIX si pacchettizza correttamente
- [ ] README e docs aggiornati
