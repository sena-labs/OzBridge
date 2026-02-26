# DEVFORGE — Architettura Tecnica v3.1

**Data**: 25 febbraio 2026
**Input**: SPEC-DEVFORGE.md v3.0
**Output**: Design per Implement Agent

---

## 1. Overview di sistema

### 1.1 Block diagram

```
┌──────────────────────────────────────────────────────────────────┐
│ VS Code Host                                                      │
│  ┌─────────────────┐                                              │
│  │ Utente Chat      │──── @dev /oz run implement auth module      │
│  └────────┬────────┘                                              │
│           ▼                                                       │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Chat Participant: @dev  (devforge.dev)                       │  │
│  │  ┌──────────────────────────────────────┐                    │  │
│  │  │ HierarchicalRouter                    │                    │  │
│  │  │  ├─ /plugins → CorePluginsCmd         │                    │  │
│  │  │  ├─ /help    → CoreHelpCmd            │                    │  │
│  │  │  ├─ /config  → CoreConfigCmd          │                    │  │
│  │  │  ├─ /oz ...  → PluginRegistry→OzPlugin│                    │  │
│  │  │  └─ /shell...→ PluginRegistry→ShellPl │                    │  │
│  │  └──────────────────────────────────────┘                    │  │
│  │  ┌──────────────────────────────────────┐                    │  │
│  │  │ AggregatedFollowupProvider            │                    │  │
│  │  └──────────────────────────────────────┘                    │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Core Services                                                │  │
│  │  ├─ PluginRegistry       (lifecycle, registration, events)   │  │
│  │  ├─ I18nService          (locale detection, t(), catalogs)   │  │
│  │  ├─ ConfigMigrator       (warpBridge.* → devforge.oz.*)      │  │
│  │  └─ Logger               (prefixed [devforge])               │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌───────────────────────┐  ┌───────────────────────┐            │
│  │ Plugin: oz             │  │ Plugin: shell          │            │
│  │  ├ OzCliService        │  │  ├ ShellService        │            │
│  │  ├ OzConfigManager     │  │  │  (streaming exec)   │            │
│  │  ├ RunPoller           │  │  └ commands/exec.ts    │            │
│  │  ├ OutputFormatter     │  │                        │            │
│  │  ├ commands/ (8)       │  └────────────────────────┘            │
│  │  ├ locales/ (10)       │                                       │
│  │  └ followups           │                                       │
│  └───────────────────────┘                                        │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ copilot-chat-toolkit  (SDK generico — pacchetto npm)         │  │
│  │  ├ Types (BridgeConfig, RunResult, CliError, IPlugin, ...)   │  │
│  │  ├ Parsers (parse, OutputFormatter)                          │  │
│  │  ├ Services (BaseConfigManager, BaseRunPoller, Logger, ...)  │  │
│  │  ├ Participant (CommandRouter, FollowupProvider, register)   │  │
│  │  └ i18n (I18nService, MessageCatalog)                        │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ External Plugin API  (DevForgeAPI via extension exports)     │  │
│  │  registerPlugin(plugin) → PluginRegistry                     │  │
│  └─────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 Moduli e responsabilità singola

| Modulo | Percorso | Responsabilità |
|--------|----------|---------------|
| **extension.ts** | `src/extension.ts` | Wiring: crea PluginRegistry, initI18n, carica built-in, registra `@dev`, restituisce DevForgeAPI |
| **PluginRegistry** | `src/core/pluginRegistry.ts` | Lifecycle plugin: register → activate → dispose. Emette eventi |
| **HierarchicalRouter** | `src/core/hierarchicalRouter.ts` | Parsing `/<namespace> <subcommand> <prompt>`, dispatching |
| **AggregatedFollowups** | `src/core/aggregatedFollowups.ts` | Aggrega followup da tutti i plugin, prefissa con namespace |
| **ConfigMigrator** | `src/core/configMigrator.ts` | Migrazione one-time `warpBridge.*` → `devforge.oz.*` |
| **CorePluginsCmd** | `src/core/pluginsCommand.ts` | Handler `/plugins` |
| **CoreHelpCmd** | `src/core/helpCommand.ts` | Handler `/help` |
| **CoreConfigCmd** | `src/core/configCommand.ts` | Handler `/config` globale |
| **i18n init** | `src/core/i18n.ts` | Init singleton + re-export `t()` |
| **OzPlugin** | `src/plugins/oz/index.ts` | Implementa `IPlugin`, wiring servizi Oz |
| **ShellPlugin** | `src/plugins/shell/index.ts` | Implementa `IPlugin`, streaming shell exec |
| **copilot-chat-toolkit** | `packages/copilot-chat-toolkit/` | SDK generico riusabile (invariato + aggiunte) |

---

## 2. Data flow

### 2.1 Flusso principale — comando utente

```
@dev /oz run implement auth module
 │
 ▼
VS Code API → ChatRequest { command: "oz", prompt: "run implement auth module" }
 │
 ▼
HierarchicalRouter.handleRequest()
 │
 ├─ command ∈ coreCommands? → NO
 ├─ command ∈ pluginNamespaces? → YES ("oz")
 │
 ▼
PluginRegistry.get("oz") → OzPlugin.registration.commands
 │
 ▼
parseSubcommand(prompt) → { subcommand: "run", actualPrompt: "implement auth module" }
 │
 ▼
OzPlugin.commands.get("run") → runCommandHandler
 │
 ▼
runCommandHandler("implement auth module", stream, token)
 │
 ├─ ContextCollector.gather() → ContextPayload
 ├─ detectSkill(prompt) → skill | undefined
 ├─ OzCliService.agentRun({ prompt: contextBlock + actualPrompt, ... })
 │     └─ spawn('oz', ['agent', 'run', '-p', ...]) → ExecResult
 ├─ OutputFormatter.formatRunResult(result, stream)
 │
 ▼
ChatResult { metadata: { namespace: "oz", subcommand: "run" } }
 │
 ▼
AggregatedFollowupProvider.provideFollowups(result)
 │
 ├─ lookup OZ_FOLLOWUPS["run"] → [{ command: "status" }, { command: "models" }]
 ├─ transform → [{ command: "oz", prompt: "status" }, { command: "oz", prompt: "models" }]
 │
 ▼
VS Code mostra follow-up con namespace corretto
```

### 2.2 Flusso registrazione plugin (built-in)

```
extension.activate(context)
 │
 ├─ locale = vscode.env.language
 ├─ i18n = new I18nService(locale)
 ├─ i18n.registerCatalog('core', CORE_MESSAGES)
 ├─ initLogger(channel, '[devforge]')
 │
 ├─ registry = new PluginRegistry()
 │
 ├─ registry.register(new OzPlugin())
 │     │
 │     ├─ pluginContext = { logger, contextCollector, extensionContext, i18n }
 │     ├─ OzPlugin.activate(pluginContext)
 │     │     ├─ i18n.registerCatalog('oz', OZ_MESSAGES)
 │     │     ├─ new OzConfigManager('devforge.oz', OZ_DEFAULTS)
 │     │     ├─ new OzCliService(cfgMgr)
 │     │     ├─ new RunPoller(cli, cfgMgr)
 │     │     └─ return PluginRegistration { commands: Map(8), followups, configSummary, disposables }
 │     │
 │     └─ store PluginInfo { source: 'builtin', status: 'active' }
 │
 ├─ registry.register(new ShellPlugin())
 │     └─ ...analogous
 │
 ├─ router = new HierarchicalRouter(registry, coreCommands)
 ├─ aggregatedFollowups = new AggregatedFollowupProvider(registry)
 ├─ registerChatParticipant({ id: 'devforge.dev', router, followups: aggregatedFollowups, icon: 'media/devforge-icon.png' })
 │
 ├─ ConfigMigrator.migrateIfNeeded(context)
 │
 └─ return { apiVersion: '1.0.0', registerPlugin: (p) => registry.registerExternal(..., p), plugins: registry.getAll() }
```

### 2.3 Flusso plugin esterno

```
Estensione esterna activate():
 │
 ├─ api = vscode.extensions.getExtension('devforge.devforge')?.exports as DevForgeAPI
 ├─ api.registerPlugin(myPlugin)
 │     ├─ PluginRegistry.registerExternal('ext-id', myPlugin)
 │     ├─ myPlugin.activate(pluginContext)
 │     ├─ HierarchicalRouter.registerPlugin(myPlugin.id, registration.commands)
 │     └─ AggregatedFollowupProvider.addPlugin(myPlugin.id, registration.followups)
 │
 ▼
 @dev /myplugin subcommand → routing funzionante
 (nota: /myplugin NON appare nell'autocomplete — limite statico package.json)
 Alternativa: myPlugin registra il proprio ChatParticipant (FR-10)
```

### 2.4 Flusso shell streaming

```
@dev /shell exec npm test
 │
 ▼
ShellPlugin.commands.get("exec") → execHandler(prompt, stream, token)
 │
 ├─ stream.markdown('```\n')                     ← apertura code block
 │
 ├─ lineBuffer = ''
 ├─ shellService.exec({
 │     command: "npm test",
 │     onChunk: (chunk, src) => {
 │       lineBuffer += chunk
 │       lines = lineBuffer.split('\n')
 │       lineBuffer = lines.pop()               ← frammento non terminato
 │       for (line of lines):
 │         stream.markdown(line + '\n')          ← streaming live per riga
 │     },
 │     cancellation: token,
 │     timeoutMs: config.timeoutMs
 │   })
 │
 ├─ if (lineBuffer) stream.markdown(lineBuffer)  ← flush finale
 ├─ stream.markdown('\n```\n')                    ← chiusura code block
 └─ stream.markdown(`Exit: ${result.exitCode} (${result.durationMs}ms)`)
```

### 2.5 Flusso i18n

```
t('oz.cli_not_found')
 │
 ▼
I18nService.t('oz.cli_not_found')
 │
 ├─ split key: namespace='oz', msgKey='cli_not_found'
 ├─ lookup catalogs.get('oz')
 │
 ├─ 1. bundle[this.locale]['cli_not_found']      → trovato? usa
 ├─ 2. bundle['en']['cli_not_found']              → fallback inglese
 ├─ 3. 'oz.cli_not_found'                         → raw key
 │
 ├─ replace placeholders: '{0}' → args[0]
 │
 ▼
"⚠️ **Oz CLI non trovato.** Assicurati che Warp sia installato e `oz` sia nel PATH."
```

### 2.6 Flusso errori

```
Plugin crasha durante activate()           Oz CLI non trovato
 │                                          │
 ▼                                          ▼
try/catch                                  OzCliService.checkAvailability() → false
logError(...)                              Warning notification + bottone install
PluginInfo.status = 'error'                Plugin resta attivo, comandi → CliError.NOT_FOUND
Continua con altri plugin
                                           Locale sconosciuto
                                            │
                                            ▼
                                           I18nService: fallback chain → en → raw key
```

---

## 3. Interfacce tra moduli (dettaglio)

### 3.1 Toolkit → Plugin: IPlugin

```typescript
// IN: copilot-chat-toolkit/src/types.ts (AGGIUNTA)

/** Contratto generico per plugin di un'estensione toolkit-based. */
export interface IPlugin {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  activate(ctx: PluginContext): Promise<PluginRegistration>;
  deactivate?(): Promise<void>;
}

export interface PluginContext {
  readonly logger: IPluginLogger;
  readonly contextCollector: IContextCollector;
  readonly extensionContext: vscode.ExtensionContext;
  readonly i18n: II18nService;
}

export interface IPluginLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface PluginRegistration {
  commands: Map<string, SlashCommandHandler>;
  followups?: FollowupMap;
  ownParticipant?: { id: string; name: string; iconSubPath?: string };
  disposables?: vscode.Disposable[];
  configSummary?: () => string;
}

export interface PluginInfo {
  readonly plugin: IPlugin;
  readonly registration: PluginRegistration;
  readonly source: 'builtin' | 'external';
  status: 'active' | 'error' | 'disabled';
  readonly error?: string;
}

export type PluginRegistryChangeEvent = {
  pluginId: string;
  action: 'registered' | 'removed' | 'error';
};
```

**Ownership**: Core crea `PluginContext`, possiede logger + contextCollector. Plugin possiede i propri `disposables`. Core chiama `deactivate()` + dispone i `disposables` al teardown.

### 3.2 Toolkit → i18n

```typescript
// IN: copilot-chat-toolkit/src/i18n/types.ts (NUOVO)

export type MessageCatalog = Record<string, string>;
export type LocaleBundle = Record<string, MessageCatalog>;

export interface II18nService {
  readonly locale: string;
  registerCatalog(namespace: string, bundle: LocaleBundle): void;
  t(key: string, ...args: Array<string | number>): string;
}
```

```typescript
// IN: copilot-chat-toolkit/src/i18n/i18nService.ts (NUOVO)

export class I18nService implements II18nService {
  private readonly catalogs = new Map<string, LocaleBundle>();
  readonly locale: string;

  constructor(locale?: string) {
    this.locale = (locale ?? 'en').split('-')[0].toLowerCase();
  }

  registerCatalog(namespace: string, bundle: LocaleBundle): void {
    this.catalogs.set(namespace, bundle);
  }

  t(key: string, ...args: Array<string | number>): string {
    const [ns, ...rest] = key.split('.');
    const msgKey = rest.join('.');

    const bundle = this.catalogs.get(ns);
    if (!bundle) return key;

    const msg = bundle[this.locale]?.[msgKey]
             ?? bundle['en']?.[msgKey]
             ?? key;

    return msg.replace(/\{(\d+)\}/g, (_, idx) =>
      String(args[Number(idx)] ?? `{${idx}}`));
  }
}
```

### 3.3 Core: PluginRegistry

```typescript
// IN: src/core/pluginRegistry.ts (NUOVO)
// Implementa IPluginRegistry conforme alla firma §3.1 della spec.
//
// Responsabilità:
// - Valida unicità namespace
// - Chiama plugin.activate(pluginContext) in try/catch
// - Memorizza PluginInfo
// - Emette onDidChange
// - disposeAll() chiama deactivate() + dispone disposables per ogni plugin
```

### 3.4 Core: HierarchicalRouter

```typescript
// IN: src/core/hierarchicalRouter.ts (NUOVO)
//
// Algoritmo dispatching:
//
//   handleRequest(request):
//     command = request.command ?? ''
//
//     IF command == '' OR undefined:
//       → welcome message con lista plugin (i18n: 'core.welcome')
//
//     IF command ∈ coreCommands:
//       → coreCommands[command](request.prompt, stream, token)
//
//     IF command ∈ pluginNamespaces:
//       → parseSubcommand(request.prompt) → { sub, actualPrompt }
//         IF sub == '' OR sub not in plugin.commands:
//           → plugin help (lista subcommand, i18n: 'core.plugin_help')
//         ELSE:
//           → plugin.commands[sub](actualPrompt, stream, token)
//       → result.metadata = { namespace: command, subcommand: sub }
//
//     ELSE:
//       → i18n: 'core.plugin_not_found'
//
// parseSubcommand(prompt: string):
//   tokens = prompt.trim().split(/\s+/)
//   sub = tokens[0] ?? ''
//   actualPrompt = tokens.slice(1).join(' ')
//   return { sub, actualPrompt }
```

### 3.5 Core: AggregatedFollowupProvider

```typescript
// IN: src/core/aggregatedFollowups.ts (NUOVO)
//
// Logica:
// - Legge result.metadata.namespace e result.metadata.subcommand
// - Cerca il plugin nel registry
// - Ottiene i followup del plugin per quel subcommand
// - TRASFORMA: i followup interni (command='status') diventano
//   (command='oz', prompt='status') per VS Code
// - Se namespace non trovato o nessun followup → followup default globali
//
// Il plugin NON conosce il proprio namespace.
// Il core gestisce la trasposizione.
```

### 3.6 Core: ConfigMigrator

```typescript
// IN: src/core/configMigrator.ts (NUOVO)
//
// migrateIfNeeded(context: ExtensionContext):
//   1. Controlla context.globalState.get('devforge.migrated')
//   2. Se true → skip
//   3. Legge vscode.workspace.getConfiguration('warpBridge')
//   4. Per ogni chiave con valore diverso dal default WarpBridge:
//      - Scrivi in devforge.oz.* (SOLO se devforge.oz.* è ancora al default)
//   5. Salva flag context.globalState.update('devforge.migrated', true)
//   6. Mostra notification informativa
//
// MAPPING CHIAVI:
//   warpBridge.ozPath              → devforge.oz.cliPath
//   warpBridge.defaultModel        → devforge.oz.defaultModel
//   warpBridge.defaultProfile      → devforge.oz.defaultProfile
//   warpBridge.defaultEnvironment  → devforge.oz.defaultEnvironment
//   warpBridge.cloudPollingIntervalMs → devforge.oz.pollingIntervalMs
//   warpBridge.cloudPollingTimeoutMs  → devforge.oz.pollingTimeoutMs
//   warpBridge.timeoutMs           → devforge.oz.timeoutMs
//   warpBridge.maxOutputChars      → devforge.oz.maxOutputChars
```

### 3.7 Plugin Oz: wiring interno

```typescript
// IN: src/plugins/oz/index.ts (NUOVO)
//
// class OzPlugin implements IPlugin {
//   readonly id = 'oz';
//   readonly displayName = 'Warp Oz Cloud';
//   readonly version = '0.1.0';
//
//   activate(ctx: PluginContext): Promise<PluginRegistration> {
//     // 1. Registra catalogo i18n
//     ctx.i18n.registerCatalog('oz', OZ_MESSAGES);
//     // 2. Crea config manager
//     this.cfgMgr = new OzConfigManager('devforge.oz', OZ_DEFAULTS);
//     // 3. Crea CLI service
//     const cli = new OzCliService(this.cfgMgr);
//     // 4. Crea poller
//     this.poller = new RunPoller(cli, this.cfgMgr);
//     // 5. Check availability in background
//     this.checkAvailabilityInBackground(cli, ctx);
//     // 6. Return registration
//     return {
//       commands: new Map([
//         ['run',      createRunCommand(cli, ctx.contextCollector, this.cfgMgr, ctx.i18n)],
//         ['cloud',    createCloudCommand(cli, this.cfgMgr, this.poller, ctx.contextCollector, ctx.i18n)],
//         ['status',   createStatusCommand(cli, this.cfgMgr, ctx.i18n)],
//         ['schedule', createScheduleCommand(cli, this.cfgMgr, ctx.i18n)],
//         ['models',   createModelsCommand(cli, this.cfgMgr, ctx.i18n)],
//         ['mcp',      createMcpCommand(cli, this.cfgMgr, ctx.i18n)],
//         ['config',   createOzConfigCommand(cli, this.cfgMgr, ctx.i18n)],
//         ['init',     createInitCommand(ctx.i18n)],
//       ]),
//       followups: OZ_FOLLOWUPS_MAP,  // costruito con t() per le label
//       configSummary: () => `CLI: ${...} | Model: ${...} | Profile: ${...}`,
//       disposables: [this.cfgMgr, { dispose: () => this.poller?.disposeAll() }],
//     };
//   }
// }
```

### 3.8 Plugin Shell: wiring interno

```typescript
// IN: src/plugins/shell/index.ts (NUOVO)
//
// class ShellPlugin implements IPlugin {
//   readonly id = 'shell';
//   readonly displayName = 'Shell Runner';
//   readonly version = '0.1.0';
//
//   activate(ctx: PluginContext): Promise<PluginRegistration> {
//     ctx.i18n.registerCatalog('shell', SHELL_MESSAGES);
//     this.cfgMgr = new ShellConfigManager();
//     const service = new ShellService();
//     return {
//       commands: new Map([
//         ['exec', createExecCommand(service, this.cfgMgr, ctx.i18n)],
//       ]),
//       configSummary: () => `Shell: ${this.cfgMgr.getConfig().defaultShell}`,
//       disposables: [this.cfgMgr],
//     };
//   }
// }
```

---

## 4. Decisioni di design

### 4.1 Pattern scelti

| Pattern | Dove | Motivazione |
|---------|------|-------------|
| **Plugin (Strategy + Registry)** | Core | Integrazioni senza modificare il core |
| **Composition over inheritance** | HierarchicalRouter | Compone sopra il toolkit's CommandRouter |
| **Factory functions** | Commands | Già in uso. Closure catturano dipendenze senza DI container |
| **Data-driven follow-up** | FollowupProvider | Già in uso. Esteso con trasformazione namespace |
| **Observer** | PluginRegistry.onDidChange | Notifica router e comandi core |
| **Singleton + façade** | I18nService, t() | Accesso globale comodo, init unico in activate() |
| **Thin wrapper / Façade** | OzConfigManager, RunPoller | Pattern confermato dall'architettura precedente |

### 4.2 Trade-off espliciti

| Decisione | Alternativa scartata | Motivo |
|-----------|---------------------|--------|
| Un ChatParticipant `@dev` con namespace routing | Un ChatParticipant per plugin | VS Code non permette aggiunta comandi da estensioni diverse. Un `@dev` centralizza l'UX |
| Namespace routing via primo token del prompt | Dot notation (`/oz.run`) | `/oz run prompt` più naturale. Comandi in package.json flat (`/oz`) |
| `IPlugin` nel toolkit (generico) | `IDevForgePlugin` solo nel bridge | Toolkit deve restare reusabile. DevForge ri-esporta come alias se serve |
| Plugin Oz crea servizi internamente | Core inietta tutti i servizi | Plugin autosufficienti. Core fornisce solo logger + contextCollector + extensionContext + i18n |
| Follow-up trasformati dal core | Plugin consapevole del namespace | Decoupling: plugin non sa sotto quale namespace è montato |
| i18n singleton con cataloghi per-namespace | Ogni plugin con il proprio I18nService | Un unico servizio = un unico locale. Cataloghi separati per autonomia di contenuto |
| Config duale (/config + /oz config) | Un solo /config unificato | Separazione responsabilità: globale vs plugin-specific |

### 4.3 Vincoli tecnici

| Vincolo | Impatto |
|---------|---------|
| `chatParticipants.commands` in package.json è statico | Comandi plugin esterni non in autocomplete. Workaround: proprio ChatParticipant |
| Un'estensione VS Code = un bundle | Plugin built-in nel bundle principale. Plugin esterni sono estensioni separate |
| `activate()` deve restituire l'API | `DevForgeAPI` pronto prima che plugin esterni lo richiedano |
| esbuild tree-shaking | Plugin built-in bundlati insieme. Dynamic import in futuro se pesanti |
| `vscode.env.language` è read-only | Locale determinato all'avvio, non cambia runtime. Se l'utente cambia lingua, reload necessario |

---

## 5. Struttura cartelle target

```
devforge/
├── packages/
│   └── copilot-chat-toolkit/
│       └── src/
│           ├── types.ts                   ╌╌╌ + IPlugin, PluginContext, PluginRegistration,
│           │                                    PluginInfo, PluginRegistryChangeEvent
│           ├── i18n/                      ═══ NUOVA CARTELLA
│           │   ├── types.ts               ═══ MessageCatalog, LocaleBundle, II18nService
│           │   └── i18nService.ts          ═══ I18nService implementazione
│           ├── index.ts                   ╌╌╌ + export i18n
│           └── ... (tutti gli altri invariati)
│
├── src/
│   ├── extension.ts                       ╌╌╌ RISCRITTURA (PluginRegistry + i18n + DevForgeAPI)
│   │
│   ├── core/                              ═══ NUOVA CARTELLA
│   │   ├── pluginRegistry.ts              ═══
│   │   ├── hierarchicalRouter.ts          ═══
│   │   ├── aggregatedFollowups.ts         ═══
│   │   ├── configMigrator.ts              ═══
│   │   ├── i18n.ts                        ═══ (initI18n + singleton t())
│   │   ├── pluginsCommand.ts              ═══
│   │   ├── helpCommand.ts                 ═══
│   │   ├── configCommand.ts               ═══ (/config globale)
│   │   └── locales/                       ═══
│   │       ├── en.ts                      ═══ (~15 chiavi core)
│   │       ├── it.ts                      ═══
│   │       ├── es.ts                      ═══
│   │       ├── fr.ts                      ═══
│   │       ├── de.ts                      ═══
│   │       ├── pt.ts                      ═══
│   │       ├── ja.ts                      ═══
│   │       ├── zh.ts                      ═══
│   │       ├── ko.ts                      ═══
│   │       └── ru.ts                      ═══
│   │
│   ├── plugins/
│   │   ├── oz/                            ═══ NUOVA CARTELLA (contenuto migrato da src/)
│   │   │   ├── index.ts                   ═══ OzPlugin implements IPlugin
│   │   │   ├── types.ts                   ═══ (estratto da src/types/index.ts)
│   │   │   ├── ozCliService.ts            ─── (da src/services/ozCliService.ts)
│   │   │   ├── configManager.ts           ─── (da src/services/configManager.ts, section=devforge.oz)
│   │   │   ├── runPoller.ts               ─── (da src/services/runPoller.ts)
│   │   │   ├── outputFormatter.ts         ─── (da src/parsers/outputFormatter.ts, con t())
│   │   │   ├── skillDetector.ts           ─── (da src/commands/skillDetector.ts)
│   │   │   ├── followups.ts              ─── (da src/participant/followups.ts, label con t())
│   │   │   ├── locales/                   ═══
│   │   │   │   ├── en.ts                  ═══ (~83 chiavi)
│   │   │   │   ├── it.ts                  ═══
│   │   │   │   ├── es.ts                  ═══
│   │   │   │   ├── fr.ts                  ═══
│   │   │   │   ├── de.ts                  ═══
│   │   │   │   ├── pt.ts                  ═══
│   │   │   │   ├── ja.ts                  ═══
│   │   │   │   ├── zh.ts                  ═══
│   │   │   │   ├── ko.ts                  ═══
│   │   │   │   └── ru.ts                  ═══
│   │   │   └── commands/
│   │   │       ├── run.ts                 ─── (da src/commands/runCommand.ts)
│   │   │       ├── cloud.ts               ─── (da src/commands/cloudCommand.ts)
│   │   │       ├── status.ts              ─── (da src/commands/statusCommand.ts)
│   │   │       ├── schedule.ts            ─── (da src/commands/scheduleCommand.ts)
│   │   │       ├── models.ts              ─── (da src/commands/modelsCommand.ts)
│   │   │       ├── mcp.ts                 ─── (da src/commands/mcpCommand.ts)
│   │   │       ├── config.ts              ─── (da src/commands/configCommand.ts, /oz config)
│   │   │       └── init.ts               ─── (da src/commands/initCommand.ts)
│   │   │
│   │   └── shell/                         ═══ NUOVA CARTELLA
│   │       ├── index.ts                   ═══ ShellPlugin implements IPlugin
│   │       ├── types.ts                   ═══ ShellPluginConfig, ShellExecResult
│   │       ├── shellService.ts            ═══ streaming exec con onChunk callback
│   │       ├── configManager.ts           ═══ extends BaseConfigManager<ShellPluginConfig>
│   │       ├── locales/                   ═══
│   │       │   ├── en.ts                  ═══ (~8 chiavi)
│   │       │   ├── it.ts                  ═══
│   │       │   └── ... (10 file)
│   │       └── commands/
│   │           └── exec.ts                ═══ line-buffered streaming handler
│   │
│   ├── services/                          (re-export invariati — 3 file da toolkit)
│   │   ├── contextCollector.ts            ── invariato
│   │   ├── logger.ts                      ── invariato
│   │   └── (nota: configManager.ts e ozCliService.ts e runPoller.ts SPOSTATI in plugins/oz/)
│   │
│   └── parsers/
│       └── jsonParser.ts                  ── invariato (re-export)
│       (nota: outputFormatter.ts SPOSTATO in plugins/oz/)
│
├── test/
│   ├── core/                              ═══ NUOVI
│   │   ├── pluginRegistry.test.ts
│   │   ├── hierarchicalRouter.test.ts
│   │   ├── aggregatedFollowups.test.ts
│   │   ├── configMigrator.test.ts
│   │   ├── i18n.test.ts
│   │   ├── pluginsCommand.test.ts
│   │   ├── helpCommand.test.ts
│   │   └── configCommand.test.ts
│   ├── plugins/
│   │   ├── oz/
│   │   │   ├── ozPlugin.test.ts           ═══ NUOVO (integration test del plugin intero)
│   │   │   ├── ozCliService.test.ts       ─── (da test/services/ozCliService.test.ts)
│   │   │   ├── ozCliServiceEdge.test.ts   ─── (da test/services/ozCliServiceEdge.test.ts)
│   │   │   ├── configManager.test.ts      ─── (da test/services/configManager.test.ts)
│   │   │   ├── runPoller.test.ts          ─── (da test/services/runPoller.test.ts)
│   │   │   ├── outputFormatter.test.ts    ─── (da test/parsers/outputFormatter.test.ts)
│   │   │   ├── outputFormatterEdge.test.ts ─── (da test/parsers/outputFormatterEdge.test.ts)
│   │   │   ├── followups.test.ts          ─── (da test/participant/followups.test.ts)
│   │   │   ├── skillDetector.test.ts      ─── (da test/commands/skillDetector.test.ts)
│   │   │   └── commands/
│   │   │       ├── run.test.ts            ─── (da test/commands/runCommand.test.ts — part of readCommands.test.ts)
│   │   │       ├── readCommands.test.ts   ─── (da test/commands/readCommands.test.ts)
│   │   │       ├── cloud.test.ts          ─── (da test/commands/cloudCommand.test.ts)
│   │   │       ├── config.test.ts         ─── (da test/commands/configCommand.test.ts)
│   │   │       ├── schedule.test.ts       ─── (da test/commands/scheduleCommand.test.ts)
│   │   │       └── init.test.ts           ─── (da test/commands/initCommand.test.ts)
│   │   └── shell/
│   │       ├── shellPlugin.test.ts        ═══
│   │       ├── shellService.test.ts       ═══
│   │       └── commands/
│   │           └── exec.test.ts           ═══
│   ├── smoke.test.ts                      ╌╌╌ aggiornare import
│   ├── extensionEdge.test.ts              ╌╌╌ aggiornare import
│   ├── helpers.ts                         ── invariato
│   ├── mocks/
│   │   └── vscode.ts                      ── invariato
│   ├── services/                          (file test invariati — sorgenti restano)
│   │   ├── contextCollector.test.ts       ── invariato
│   │   └── logger.test.ts                 ── invariato
│   ├── parsers/                           (file test invariati — sorgenti restano)
│   │   ├── jsonParser.test.ts             ── invariato
│   │   └── jsonParserEdge.test.ts         ── invariato
│   └── types/
│       └── types.test.ts                  ╌╌╌ ELIMINARE (sorgente eliminata, contenuto migrato in ozPlugin.test.ts)
│
├── l10n/                                  ═══ NUOVO (VS Code package.json l10n)
│   ├── bundle.l10n.json                   ═══ (inglese source)
│   ├── bundle.l10n.it.json                ═══
│   ├── bundle.l10n.es.json                ═══
│   ├── bundle.l10n.fr.json                ═══
│   ├── bundle.l10n.de.json                ═══
│   ├── bundle.l10n.pt.json                ═══
│   ├── bundle.l10n.ja.json                ═══
│   ├── bundle.l10n.zh.json                ═══
│   ├── bundle.l10n.ko.json                ═══
│   └── bundle.l10n.ru.json                ═══
│
├── media/
│   └── devforge-icon.png                  ─── (da warp-icon.png, rinominato)
│
├── package.json                           ╌╌╌ name, displayName, participant, config, l10n
├── tsconfig.json                          ── invariato
├── esbuild.js                             ── invariato
├── vitest.config.ts                       ── invariato (scopre test/**/*.test.ts)
├── README.md                              ╌╌╌ riscritto per DevForge
├── CONTRIBUTING.md                        ╌╌╌ aggiornato
├── SECURITY.md                            ╌╌╌ aggiornato
├── CHANGELOG.md                           ╌╌╌ aggiornato
└── docs/
    ├── SPEC-DEVFORGE.md                   ═══ (questo documento)
    ├── ARCHITECTURE-DEVFORGE.md           ═══ (questo documento)
    ├── IMPLEMENTATION-PLAN.md             ═══
    └── PLUGIN-GUIDE.md                    ═══ (guida per sviluppatori plugin)
```

**Legenda**: `═══` = file nuovo · `───` = file spostato · `╌╌╌` = file modificato in-place

---

## 6. Mappa file: PRIMA → DOPO

Questa tabella è la referenza operativa per l'Implement Agent.

### 6.1 File ELIMINATI (3)

| File attuale | Motivo |
|-------------|--------|
| `src/types/index.ts` | Contenuto distribuito: tipi Oz → `plugins/oz/types.ts`, tipi toolkit invariati |
| `src/commands/router.ts` | Sostituito da `core/hierarchicalRouter.ts` + registrazione nel plugin |
| `src/participant/handler.ts` | Logica assorbita in `extension.ts` + `core/hierarchicalRouter.ts` |

### 6.2 File SPOSTATI (14)

| Da | A | Modifiche nel file |
|----|---|-------------------|
| `src/services/ozCliService.ts` | `src/plugins/oz/ozCliService.ts` | Import path. `OzCliError` → import da `./types.ts`. Config section naming |
| `src/services/configManager.ts` | `src/plugins/oz/configManager.ts` | Section: `'warpBridge'` → `'devforge.oz'`. Type: `WarpBridgeConfig` → `OzPluginConfig` |
| `src/services/runPoller.ts` | `src/plugins/oz/runPoller.ts` | Import path |
| `src/parsers/outputFormatter.ts` | `src/plugins/oz/outputFormatter.ts` | Tutte le stringhe hardcoded → `t('oz.key')`. URL warp.dev → config |
| `src/commands/skillDetector.ts` | `src/plugins/oz/skillDetector.ts` | Import path |
| `src/participant/followups.ts` | `src/plugins/oz/followups.ts` | `WARP_FOLLOWUPS` → `OZ_FOLLOWUPS`. Label → `t('oz.followup_*')` |
| `src/commands/runCommand.ts` | `src/plugins/oz/commands/run.ts` | Import path. Stringhe → `t()`. + parametro `i18n` |
| `src/commands/cloudCommand.ts` | `src/plugins/oz/commands/cloud.ts` | Import path. Stringhe → `t()`. + parametro `i18n` |
| `src/commands/statusCommand.ts` | `src/plugins/oz/commands/status.ts` | Import path. Stringhe → `t()` |
| `src/commands/scheduleCommand.ts` | `src/plugins/oz/commands/schedule.ts` | Import path. Stringhe → `t()` |
| `src/commands/modelsCommand.ts` | `src/plugins/oz/commands/models.ts` | Import path. Stringhe → `t()` |
| `src/commands/mcpCommand.ts` | `src/plugins/oz/commands/mcp.ts` | Import path. Stringhe → `t()` |
| `src/commands/configCommand.ts` | `src/plugins/oz/commands/config.ts` | Import path. Stringhe → `t()`. Titolo: /oz config |
| `src/commands/initCommand.ts` | `src/plugins/oz/commands/init.ts` | Import path. Stringhe → `t()`. Path `.warp/` → `.devforge/plugins/oz/` |

### 6.3 File NUOVI (~55)

| File | Contenuto |
|------|-----------|
| `packages/copilot-chat-toolkit/src/i18n/types.ts` | MessageCatalog, LocaleBundle, II18nService |
| `packages/copilot-chat-toolkit/src/i18n/i18nService.ts` | I18nService implementazione |
| `src/core/pluginRegistry.ts` | PluginRegistry |
| `src/core/hierarchicalRouter.ts` | HierarchicalRouter |
| `src/core/aggregatedFollowups.ts` | AggregatedFollowupProvider |
| `src/core/configMigrator.ts` | ConfigMigrator |
| `src/core/i18n.ts` | initI18n() + singleton t() |
| `src/core/pluginsCommand.ts` | /plugins handler |
| `src/core/helpCommand.ts` | /help handler |
| `src/core/configCommand.ts` | /config globale handler |
| `src/core/locales/*.ts` | 10 file catalogo (en, it, es, fr, de, pt, ja, zh, ko, ru) |
| `src/plugins/oz/index.ts` | OzPlugin class |
| `src/plugins/oz/types.ts` | OzPluginConfig + DTOs estratti |
| `src/plugins/oz/locales/*.ts` | 10 file catalogo (~83 chiavi) |
| `src/plugins/shell/index.ts` | ShellPlugin class |
| `src/plugins/shell/types.ts` | ShellPluginConfig, ShellExecResult |
| `src/plugins/shell/shellService.ts` | Streaming exec con onChunk |
| `src/plugins/shell/configManager.ts` | BaseConfigManager<ShellPluginConfig> |
| `src/plugins/shell/commands/exec.ts` | Line-buffered streaming handler |
| `src/plugins/shell/locales/*.ts` | 10 file catalogo (~8 chiavi) |
| `l10n/bundle.l10n.*.json` | 10 file bundle VS Code |
| `test/core/*.test.ts` | 8 file test |
| `test/plugins/oz/ozPlugin.test.ts` | Integration test |
| `test/plugins/shell/*.test.ts` | 3+ file test |

### 6.4 File MODIFICATI in-place (~12)

| File | Modifiche |
|------|-----------|
| `packages/copilot-chat-toolkit/src/types.ts` | + IPlugin, PluginContext, PluginRegistration, PluginInfo, etc. |
| `packages/copilot-chat-toolkit/src/index.ts` | + export i18n |
| `src/extension.ts` | Riscrittura completa (PluginRegistry + i18n + DevForgeAPI) |
| `src/services/contextCollector.ts` | Invariato (re-export) |
| `src/services/logger.ts` | Invariato (re-export) |
| `src/parsers/jsonParser.ts` | Invariato (re-export) |
| `package.json` | name, displayName, publisher, participant, config, l10n |
| `README.md` | Riscritto |
| `CONTRIBUTING.md` | Aggiornato nomi |
| `SECURITY.md` | Aggiornato nomi |
| `CHANGELOG.md` | + entry v0.2.0 DevForge |
| `test/smoke.test.ts` | Aggiornare import |

---

## 7. Rischi

| # | Rischio | Impatto | Mitigazione |
|---|---------|---------|-------------|
| R-01 | Autocomplete VS Code per plugin esterni | UX degradata | Plugin esterno registra proprio ChatParticipant |
| R-02 | Parsing subcommand ambiguo | Confusione utente | Help plugin se subcommand non trovato |
| R-03 | Bundle size con i18n (10 lingue × 3 namespace) | Aumento bundle | Cataloghi sono oggetti JSON leggeri (~5KB totali) |
| R-04 | Config migration race condition | Sovrascrittura | Migrare solo se target ha default |
| R-05 | Publisher Marketplace naming | Naming conflict | Verificare disponibilità |
