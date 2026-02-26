# DEVFORGE — Specifica Tecnica v3.0

**Data**: 25 febbraio 2026
**Stato**: Approvata — pronta per Design Agent → Implement Agent

---

## 1. Contesto

### 1.1 Stato attuale

Il repository contiene un'estensione VS Code chiamata **"Warp Bridge"** (`warp-vsc-bridge`) che integra gli agenti Warp Oz nel pannello Copilot Chat tramite un Chat Participant `@warp` con 8 slash command (`/run`, `/cloud`, `/status`, `/schedule`, `/models`, `/mcp`, `/config`, `/init`).

Il codebase è stato ristrutturato in un **monorepo a 2 pacchetti**:

- `packages/copilot-chat-toolkit/` — SDK generico riusabile (12 file .ts, 0 riferimenti Warp/Oz)
- `src/` — Bridge Oz-specifico (14 file sorgente + thin wrapper) con **~660+ riferimenti** ai nomi "Warp", "Oz", "warp-vsc-bridge" in ~50 file

Lo stato funzionale è solido: 412/412 test passano, coverage 99.61%, TypeScript strict clean, bundle esbuild 25.4 KB, VSIX confezionato e installabile.

### 1.2 Motivazione del pivot

Decisione commerciale: creare un **toolkit di sviluppo per VS Code** generico a plugin, dove l'integrazione con Warp Oz diventa **soltanto uno dei plugin disponibili**. Questo permette:

- Distribuzione come prodotto generico sul VS Code Marketplace
- Aggiunta futura di integrazioni (Docker, Git avanzato, shell runner, agenti custom)
- Possibilità per terze parti di sviluppare plugin compatibili
- Revenue model basato su ecosistema, non legato a singolo vendor

### 1.3 Inventario riferimenti obsoleti

| Categoria | Occorrenze | Esempio |
|-----------|-----------|---------|
| `[NAME]` — nomi pacchetto/publisher/participant | ~35 | `"warp-vsc-bridge"`, `@warp` |
| `[TYPE]` — tipi TypeScript Oz-prefixed | ~120+ | `OzCliError`, `WarpBridgeConfig` |
| `[I18N]` — testi italiani hardcoded | ~50+ | `'Avvio agente Oz locale...'` |
| `[CONFIG]` — chiavi configurazione | ~20 | `warpBridge.ozPath` |
| `[UI_TEXT]` — testi visibili utente | ~40 | `'consuma crediti Warp'` |
| `[URL]` — URL warp.dev | ~10 | `https://www.warp.dev/download` |
| `[COMMENT]` — commenti JSDoc/inline | ~60+ | `* Wraps the Warp Oz CLI` |
| `[VARIABLE]` — costanti/variabili | ~25 | `WARP_FOLLOWUPS` |
| `[ICON]` / `[FILENAME]` | 4 | `media/warp-icon.png` |
| **TOTALE** | **~660+** | in **~50 file** |

---

## 2. Obiettivo

Trasformare il repository da estensione VS Code monolitica Warp-specifica a **DevForge: un toolkit di sviluppo modulare per VS Code** con architettura a plugin ibrida (built-in + esterni), dove l'integrazione Warp Oz diventa il primo plugin (`@dev /oz.*`) all'interno di un ecosistema espandibile.

---

## 3. Requisiti funzionali

### 3.1 Core — Plugin System

| ID | Requisito |
|----|-----------|
| FR-01 | L'estensione deve esporre un **Plugin API** (`IPlugin`) che permetta a moduli interni e a estensioni VS Code esterne di registrare integrazioni. |
| FR-02 | Ogni plugin deve dichiarare: namespace univoco (es. `oz`, `shell`), slash command, chiavi di configurazione, follow-up. |
| FR-03 | I plugin built-in (distribuiti nel VSIX principale) devono essere caricati automaticamente all'avvio. |
| FR-04 | I plugin esterni devono potersi connettere al core tramite `vscode.extensions.getExtension('devforge.devforge')?.exports`. |
| FR-05 | Il core deve gestire un **PluginRegistry** che tiene traccia dei plugin registrati, è attivo e emette eventi di cambio. |

### 3.2 Core — Chat Participant `@dev`

| ID | Requisito |
|----|-----------|
| FR-06 | Il Chat Participant deve registrarsi come `@dev` (participant ID: `devforge.dev`). |
| FR-07 | I comandi dei plugin devono essere accessibili tramite **namespace prefissato**: il command VS Code è il namespace (`/oz`), il primo token del prompt è il subcommand (`run prompt...`). |
| FR-08 | Comandi core (senza namespace): `/plugins` (lista plugin attivi), `/config` (configurazione globale), `/help` (guida comandi). |
| FR-09 | Il routing deve essere gerarchico: il `HierarchicalRouter` del core delega al router del plugin in base al namespace. |
| FR-10 | Ogni plugin può opzionalmente registrare un **proprio Chat Participant autonomo** (es. `@oz`). |

### 3.3 Plugin Oz (Warp Cloud) — v1

| ID | Requisito |
|----|-----------|
| FR-11 | Tutto il codice Oz deve essere nella struttura plugin `src/plugins/oz/`, con namespace `oz`. |
| FR-12 | Comandi Oz: `/oz run`, `/oz cloud`, `/oz status`, `/oz schedule`, `/oz models`, `/oz mcp`, `/oz config`, `/oz init`. |
| FR-13 | La configurazione Oz deve vivere sotto `devforge.oz.*` (es. `devforge.oz.cliPath`, `devforge.oz.defaultModel`). |
| FR-14 | Skills e rules Oz devono essere scaffoldate sotto `.devforge/plugins/oz/`. |

### 3.4 Plugin Shell Runner — v1

| ID | Requisito |
|----|-----------|
| FR-15 | Plugin `shell` che esegua comandi shell dal chat: `/shell exec <comando>`. |
| FR-16 | Configurazione: `devforge.shell.defaultShell`, `devforge.shell.timeout`. |
| FR-17 | Output streaming **line-buffered** nel chat stream (chunk by chunk, non attendere completamento). |

### 3.5 Config duale

| ID | Requisito |
|----|-----------|
| FR-18 | `/config` (core): panoramica globale DevForge + sommario per-plugin (1 riga). |
| FR-19 | `/oz config` (plugin): dettaglio completo plugin Oz (path, model, profile, environment, CLI status, profili, integrazioni). |
| FR-20 | Ogni plugin può esporre un `configSummary()` opzionale usato dal `/config` globale. |

### 3.6 i18n multilingua

| ID | Requisito |
|----|-----------|
| FR-21 | Tutte le stringhe UI devono passare per sistema i18n con chiavi namespaced (`t('oz.cli_not_found')`). |
| FR-22 | 10 lingue supportate: en (default/fallback), it, es, fr, de, pt, ja, zh, ko, ru. |
| FR-23 | Il locale deve essere rilevato automaticamente da `vscode.env.language`. |
| FR-24 | I cataloghi messaggi sono per-namespace (ogni plugin registra il proprio). |
| FR-25 | Fallback chain: locale attivo → en → chiave raw. |
| FR-26 | Package.json contributes (`description` dei settings/comandi) localizzate via `l10n/` bundle VS Code. |

### 3.7 Rinominazione e pulizia

| ID | Requisito |
|----|-----------|
| FR-27 | Zero occorrenze di "warp-vsc-bridge", "Warp Bridge", `@warp`, `warpBridge` nel codebase (escluso changelog storico). |
| FR-28 | Tabella rinominazione identità — vedi §8. |

---

## 4. Requisiti non funzionali

| ID | Requisito |
|----|-----------|
| NFR-01 | Caricamento plugin built-in: max +50ms rispetto all'attivazione attuale. |
| NFR-02 | Bundle VSIX (core + Oz + Shell): ≤100 KB. |
| NFR-03 | Migrazione automatica config `warpBridge.*` → `devforge.oz.*` al primo avvio. |
| NFR-04 | Ogni plugin testabile in isolamento dal core. Coverage ≥95%. |
| NFR-05 | Aggiungere plugin built-in: creare `src/plugins/<name>/`, implementare `IPlugin`, registrare in extension.ts. Zero modifiche al core. |
| NFR-06 | Plugin esterni non accedono a risorse (file system, rete, processi) se non tramite API del core. |
| NFR-07 | `/plugins` mostra tabella chiara dei plugin (nome, versione, stato). |
| NFR-08 | Nessuna dipendenza nativa. Windows, macOS, Linux. Node.js ≥20. |

---

## 5. Interfacce / API previste

### 5.1 IPlugin (toolkit)

```typescript
interface IPlugin {
  readonly id: string;           // namespace: 'oz', 'shell', 'docker'
  readonly displayName: string;  // "Warp Oz Cloud"
  readonly version: string;      // semver
  activate(ctx: PluginContext): Promise<PluginRegistration>;
  deactivate?(): Promise<void>;
}

interface PluginContext {
  readonly logger: IPluginLogger;
  readonly contextCollector: IContextCollector;
  readonly extensionContext: vscode.ExtensionContext;
  readonly i18n: II18nService;
}

interface IPluginLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

interface PluginRegistration {
  commands: Map<string, SlashCommandHandler>;
  followups?: FollowupMap;
  ownParticipant?: { id: string; name: string; iconSubPath?: string };
  disposables?: vscode.Disposable[];
  configSummary?: () => string;
}
```

### 5.2 PluginRegistry (core)

```typescript
interface IPluginRegistry {
  register(
    plugin: IPlugin,
    source: 'builtin' | 'external',
    ctx: PluginContext
  ): Promise<void>;
  get(pluginId: string): PluginInfo | undefined;
  getAll(): ReadonlyMap<string, PluginInfo>;
  onDidChange: vscode.Event<PluginRegistryChangeEvent>;
  disposeAll(): Promise<void>;
}

interface PluginInfo {
  readonly plugin: IPlugin;
  readonly registration: PluginRegistration;
  readonly source: 'builtin' | 'external';
  status: 'active' | 'error' | 'disabled';
  readonly error?: string;
}
```

### 5.3 HierarchicalRouter (core)

```typescript
interface IHierarchicalRouter {
  handleRequest(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<vscode.ChatResult>;
}
// Nota: il router riceve il PluginRegistry nel costruttore.
// I plugin vengono scoperti dinamicamente dal registry, senza registerPlugin/unregisterPlugin espliciti.
```

### 5.4 i18n (toolkit)

```typescript
type MessageCatalog = Record<string, string>;
type LocaleBundle = Record<string, MessageCatalog>;

interface II18nService {
  readonly locale: string;
  registerCatalog(namespace: string, bundle: LocaleBundle): void;
  t(key: string, ...args: Array<string | number>): string;
}
```

### 5.5 DevForge API (extension exports)

```typescript
interface DevForgeAPI {
  readonly apiVersion: string;  // es. '1.0.0'
  registerPlugin(plugin: IPlugin): Promise<void>;
  readonly plugins: ReadonlyMap<string, PluginInfo>;
}
```

### 5.6 Shell service (plugin shell)

```typescript
interface ShellExecOptions {
  command: string;
  cwd?: string;
  shell?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  cancellation?: vscode.CancellationToken;
  onChunk?: (chunk: string, source: 'stdout' | 'stderr') => void;
}

interface ShellExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

interface IShellService {
  exec(opts: ShellExecOptions): Promise<ShellExecResult>;
}
```

---

## 6. Modelli di dati principali

### 6.1 Core

```typescript
interface DevForgeCoreConfig {
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

interface PluginManifest {
  id: string;
  displayName: string;
  version: string;
  description: string;
  source: 'builtin' | 'external';
  commands: string[];
  configSection: string;
}
```

### 6.2 Plugin Oz (spostati da `src/types/index.ts` a `src/plugins/oz/types.ts`)

```typescript
interface OzPluginConfig {
  cliPath: string;
  defaultModel: string;
  defaultProfile: string;
  defaultEnvironment: string;
  pollingIntervalMs: number;
  pollingTimeoutMs: number;
  timeoutMs: number;
  maxOutputChars: number;
}

// OzModel, OzMcpServer, OzProfile, OzEnvironment,
// OzIntegration, OzSchedule — invariati nella sostanza
// IOzCliService — invariato
// AGENT_SKILL_MAP — invariato
```

### 6.3 Plugin Shell

```typescript
interface ShellPluginConfig {
  defaultShell: string;  // '' = auto-detect, oppure 'powershell', 'bash', etc.
  timeoutMs: number;
  maxOutputChars: number;
}

// ShellExecResult definito in §5.6
```

---

## 7. Edge case ed errori

| # | Scenario | Comportamento atteso |
|---|----------|---------------------|
| E-01 | Plugin esterno registra namespace già in uso | `PluginConflictError: namespace 'oz' already registered` |
| E-02 | Plugin esterno si disattiva durante esecuzione comando | Comandi in volo completano o falliscono gracefully, rimozione post-completamento |
| E-03 | `@dev /foo bar` dove `foo` non è plugin registrato | `❓ Plugin 'foo' non trovato. Usa /plugins per vedere i plugin disponibili.` |
| E-04 | `@dev /oz baz` dove `baz` non è subcommand | `❓ Comando '/oz baz' non riconosciuto. Comandi: /oz run, /oz cloud, ...` |
| E-05 | Plugin Oz attivato ma CLI non installato | Warning con bottone install. Plugin rimane attivo, comandi ritornano `CliError.NOT_FOUND` |
| E-06 | Migrazione config: `warpBridge.*` presente | Migrare a `devforge.oz.*` solo se `devforge.oz.*` è tutto default. Mostrare notifica |
| E-07 | Plugin crasha in `activate()` | Catturare, loggare, status `'error'`, proseguire con altri plugin |
| E-08 | `/plugins` senza plugin | `Nessun plugin attivo.` |
| E-09 | `@dev` senza comando | Help contestuale con lista plugin e comandi |
| E-10 | Locale sconosciuto (`xx-XX`) | Fallback a inglese |

---

## 8. Criteri di accettazione

### 8.1 Rinominazione (MUST)

| ID | Criterio |
|----|----------|
| AC-01 | Zero occorrenze di "warp-vsc-bridge", "Warp Bridge", `@warp`, `warpBridge` nel codebase |
| AC-02 | `package.json` → `name: "devforge"`, `displayName: "DevForge"`, participant `devforge.dev` |
| AC-03 | Tutte le chiavi config sotto `devforge.*` |
| AC-04 | `media/devforge-icon.png` referenziato correttamente |
| AC-05 | README, CONTRIBUTING, SECURITY, CHANGELOG, LICENSE aggiornati |

### 8.2 Architettura Plugin (MUST)

| ID | Criterio |
|----|----------|
| AC-06 | `IPlugin` definita nel toolkit ed esportata |
| AC-07 | `PluginRegistry` con register/getAll/get/disposeAll |
| AC-08 | `HierarchicalRouter` con parsing `/<namespace> <subcommand> <prompt>` |
| AC-09 | Plugin Oz funzionante con tutti gli 8 comandi originali |
| AC-10 | Plugin Shell funzionante con `/shell exec` e output streaming line-buffered |
| AC-11 | `/plugins` mostra tabella plugin attivi |
| AC-12 | `/help` mostra comandi aggregati |

### 8.3 API esterna (MUST)

| ID | Criterio |
|----|----------|
| AC-13 | `activate()` restituisce `DevForgeAPI` |
| AC-14 | Un plugin esterno mock può registrarsi e i suoi comandi appaiono sotto `@dev` |

### 8.4 Config duale (MUST)

| ID | Criterio |
|----|----------|
| AC-15 | `/config` mostra panoramica globale + plugin summary. `/oz config` mostra dettaglio Oz |

### 8.5 i18n (MUST)

| ID | Criterio |
|----|----------|
| AC-16 | `vscode.env.language = 'it'` → UI in italiano |
| AC-17 | `vscode.env.language = 'fr'` → UI in francese |
| AC-18 | Locale sconosciuto → fallback a inglese |
| AC-19 | Ogni chiave di ogni catalogo esiste in tutte le 10 lingue (test automatico) |
| AC-20 | Package.json strings localizzate via `l10n/` |
| AC-21 | Plugin esterno può registrare catalogo i18n via `PluginContext.i18n.registerCatalog()` |

### 8.6 Shell streaming (MUST)

| ID | Criterio |
|----|----------|
| AC-22 | `/shell exec echo hello` mostra output line-buffered nel chat |
| AC-23 | Timeout interrompe il processo e mostra messaggio i18n |

### 8.7 Qualità (MUST)

| ID | Criterio |
|----|----------|
| AC-24 | `tsc -noEmit` → 0 errori |
| AC-25 | Tutti i test passano (target ≥450, aggiornati per nuovi nomi) |
| AC-26 | Coverage ≥95% |
| AC-27 | `npm run build` → bundle ≤100 KB |
| AC-28 | VSIX confezionabile e installabile |

### 8.8 Migrazione (SHOULD)

| ID | Criterio |
|----|----------|
| AC-29 | Se `warpBridge.*` presente nelle settings, migrazione automatica a `devforge.oz.*` |
| AC-30 | Notifica utente della migrazione |

---

## 9. Tabella rinominazione identità

| Prima | Dopo |
|-------|------|
| `warp-vsc-bridge` | `devforge` |
| `Warp Bridge` | `DevForge` |
| `@warp` | `@dev` |
| `warp-vsc-bridge.warp` (participant ID) | `devforge.dev` |
| `warpBridge.*` (config section) | `devforge.*` (core) + `devforge.oz.*` (plugin Oz) |
| `media/warp-icon.png` | `media/devforge-icon.png` |
| `.warp/rules/` | `.devforge/plugins/oz/rules/` |
| `.agents/skills/` | `.devforge/plugins/oz/skills/` |
| `[warp-vsc-bridge]` (log prefix) | `[devforge]` |
| `WarpBridgeConfig` | `OzPluginConfig` (nel plugin) |
| `WARP_FOLLOWUPS` | `OZ_FOLLOWUPS` |
| `WARP_DEFAULTS` | `OZ_DEFAULTS` |
| `WARP_INSTALL_URL` | gestito da i18n / config del plugin |

---

## 10. Assunzioni esplicite

| # | Assunzione | Rischio se errata |
|---|-----------|-------------------|
| A-01 | Publisher Marketplace sarà `devforge` | Impatta solo `package.json` |
| A-02 | Plugin Shell v1 è minimale (solo `/shell exec`) | Se più complesso, richiede spec dedicata |
| A-03 | Plugin esterni non necessitano bundling separato | Standard VS Code |
| A-04 | Toolkit `copilot-chat-toolkit` mantiene il nome attuale | Se rinominato, impatta npm |
| A-05 | Il file icona `devforge-icon.png` va creato (placeholder accettabile per v1) | Solo cosmetico |
