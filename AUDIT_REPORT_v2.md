# OzBridge — Audit Report v2 (multidisciplinare, multi-passata)

**Repository**: `sena-labs/OzBridge` — branch `fix/insufficient-credits-detection`
**Versione**: 1.1.0
**Data**: 29 aprile 2026
**Perimetro**: `src/**/*.ts`, `packages/copilot-chat-toolkit/src/**/*.ts`, `package.json`, `package.nls*.json`, `l10n/*.json`, `tsconfig.json`, `vitest.config.ts`, `esbuild.js`. Esclusi `test/` (analizzato a parte), `coverage/`, `node_modules/`, `docs/`.
**Baseline**: 1207/1207 test verdi; `tsc --noEmit` pulito; `npm audit` 0 vulnerabilità.

---

## Executive Summary

| Pass | Area | HIGH | MEDIUM | LOW |
|---|---|---:|---:|---:|
| A | Type-safety, Error Handling, Concurrency | 3 | 6 | 6 |
| B | Security, VS Code API, Performance | 5 | 8 | 7 |
| C | Tests, Build, Deps, L10n | 0 | 5 | 7 |
| **Totale** | | **8** | **19** | **20** |

**Verdetto globale**: **REWORK** — codebase matura e disciplinata (zero `any` reali eccetto 2 in `mcp/server.ts`, nessun `@ts-ignore`, type predicates ben usati, error narrowing sistematico, spawn senza shell, telemetria con deny-list, atomic-write, kill-switch). I blocker reali sono concentrati su **3 aree**:

1. **Resource lifecycle** — `CancellationTokenSource` mai disposta, `forceKillHandle` riarmato senza clear, child process Oz orfani al `deactivate()`.
2. **VS Code UX/Security** — `localResourceRoots` mancante, uso scorretto di `showInformationMessage` su path di errore, mancanza `scope: machine` su settings sensibili.
3. **MCP server hardening** — nessun cap sulle sessioni SSE, timer non puliti se `res.end()` throw, possibile DoS locale.

L'unica sezione clean è la C (Tests/Build/Deps/L10n) — 0 HIGH, suite robusta, l10n al 100%.

---

## PASS A — Type-safety, Error Handling, Concurrency

### HIGH

#### A-H1 — `CancellationTokenSource` mai disposta in `languageModelClient`
- **File**: [src/services/languageModelClient.ts](src/services/languageModelClient.ts#L22-L24)
- **Categoria**: Resource lifecycle / Concurrency
- **Descrizione**: ogni `sendRequest` senza cancellation crea `new vscode.CancellationTokenSource()` ma il riferimento alla source è perso e mai disposto. Listener interni accumulati ad ogni triage/LM call.
- **Fix**: tenere la source in una const, registrare `dispose()` nel `finally` dopo il `for await`.

#### A-H2 — `forceKillHandle` riarmato senza `clearTimeout`
- **File**: [src/services/ozCliService.ts](src/services/ozCliService.ts#L589-L606)
- **Categoria**: Concurrency
- **Descrizione**: `terminateProcess()` può essere chiamato 2-3 volte (idle / global timeout / cancellation). Ogni chiamata sovrascrive `forceKillHandle` senza clear: vecchi timer restano schedulati ~1.5s e tengono vivo il loop.
- **Fix**: `if (forceKillHandle) clearTimeout(forceKillHandle);` prima del nuovo `setTimeout`, o flag `terminating`.

#### A-H3 — Child process Oz orfani al `deactivate()`
- **File**: [src/extension.ts](src/extension.ts#L138-L141)
- **Categoria**: Resource lifecycle
- **Descrizione**: `OzCliService` non è in `subscriptions` e i child sono killati solo via cancellation o timeout. Al `deactivate()` non c'è broadcast: i process in-flight (es. `cli.runList()` da `tracker.tick()`) restano orfani fino al timeout.
- **Fix**: `CancellationTokenSource` "extension lifetime" passata come fallback in `exec()` e cancellata in `deactivate()` prima di `disposeAll()`.

### MEDIUM

| ID | File | Issue | Fix | Stato |
|---|---|---|---|---|
| A-M4 | [src/mcp/server.ts](src/mcp/server.ts#L299-L301) | Doppio `as any` in `isJsonRpcRequest` | Usare `Record<string, unknown>` come fa `extractToolCallParams` | ✅ FIXED |
| A-M5 | [src/mcp/server.ts](src/mcp/server.ts#L230-L244) | Timer SSE `keepalive`/`maxLifetime` non puliti se `res.end()` throw | Tracciare per-session in `Map` e clear in `stop()` prima di `res.end()` | ✅ FIXED (in B-H5) |
| A-M6 | [src/mcp/registrars/jsonRegistrarBase.ts](src/mcp/registrars/jsonRegistrarBase.ts#L115-L125) | Tmp file orfano se `renameSync` fallisce | `try { fs.unlinkSync(tmp); } catch {}` nel catch prima del rethrow | ✅ FIXED |
| A-M7 | [src/services/ozCliService.ts](src/services/ozCliService.ts#L160) | Triple `try { onLine/onProgress } catch {}` muti | Degradare a `logWarn` per tracciare bug in OutputFormatter | ✅ FIXED |
| A-M8 | [packages/copilot-chat-toolkit/src/parsers/jsonParser.ts](packages/copilot-chat-toolkit/src/parsers/jsonParser.ts#L31) | `JSON.parse() as T` triplice senza validazione runtime | Cambiare firma a `unknown`, validazione al call site | pending |
| A-M9 | [src/commands/cloudCommand.ts](src/commands/cloudCommand.ts#L139) | Floating Promise su `showInformationMessage` | Prefissare `void` | ✅ FIXED (in B-H3) |

### LOW

| ID | File | Issue |
|---|---|---|
| A-L10 | [src/services/ozCliService.ts](src/services/ozCliService.ts#L108) | `checkAvailability` empty catch senza log |
| A-L11 | [src/services/ozCliService.ts](src/services/ozCliService.ts#L866-L915) | Cache `_resolvedOzPath` non invalidata su config change |
| A-L12 | [src/extension.ts](src/extension.ts#L165) | `isWarpUri` guard incompleto, richiede cast esplicito |
| A-L13 | [src/ui/runsTreeProvider.ts](src/ui/runsTreeProvider.ts#L328-L345) | `switch` su union senza `assertNever` exhaustiveness |
| A-L14 | [src/extension.ts](src/extension.ts#L392-L396) | `Promise.allSettled` over-engineered nel `deactivate` |
| A-L15 | [src/mcp/server.ts](src/mcp/server.ts#L343) | `params.arguments as Record<string,unknown>` accetta array |

---

## PASS B — Security, VS Code API, Performance

### HIGH

#### B-H1 — Webview senza `localResourceRoots`
- **File**: [src/ui/dashboardPanel.ts](src/ui/dashboardPanel.ts#L168-L173)
- **Categoria**: Security + VS Code
- **Descrizione**: `createWebviewPanel` con `enableScripts: true, retainContextWhenHidden: true` ma senza `localResourceRoots`. CSP stretta presente, ma raccomandazione VS Code richiede restrizione esplicita. Il pannello è self-contained.
- **Fix**: aggiungere `localResourceRoots: []`.

#### B-H2 — `showInformationMessage` su failure path MCP
- **File**: [src/mcp/lifecycle.ts](src/mcp/lifecycle.ts#L168-L175)
- **Categoria**: VS Code / UX
- **Descrizione**: `ozBridge.mcp.start` mostra sempre `showInformationMessage` anche quando `lifecycle.endpoint === undefined` (server fallito a partire). Toast informativo blu su contenuto di errore.
- **Fix**: branchare su `ep === undefined` e usare `showErrorMessage`.

#### B-H3 — `showInformationMessage` su risultato cloud FAILED
- **File**: [src/commands/cloudCommand.ts](src/commands/cloudCommand.ts#L135-L139)
- **Categoria**: VS Code / UX
- **Descrizione**: notifica sempre informativa anche quando `finalResult.status === 'FAILED'`.
- **Fix**: `showErrorMessage` su `FAILED`, helper `notifyByStatus(status, msg)`.

#### B-H4 — I/O sincrono filesystem nel main thread
- **File**: [src/commands/initV2Command.ts](src/commands/initV2Command.ts#L60-L100), [src/ui/skillEditor.ts](src/ui/skillEditor.ts#L83-L191), [src/mcp/registrars/codexRegistrar.ts](src/mcp/registrars/codexRegistrar.ts#L46-L174), [src/mcp/registrars/jsonRegistrarBase.ts](src/mcp/registrars/jsonRegistrarBase.ts#L84-L125), [src/drive/fileSystemDriveSource.ts](src/drive/fileSystemDriveSource.ts#L116-L175)
- **Categoria**: Performance
- **Descrizione**: scaffold/skill-editor/MCP-registrars/drive usano `existsSync`, `readFileSync`, `readdirSync`, `mkdirSync`, `writeFileSync`, `renameSync`, `realpathSync`, `statSync`. Bloccano l'extension host su filesystem lenti / network drive / cartelle grandi.
- **Fix**: migrazione `fs.promises.*` o `vscode.workspace.fs.*`.

#### B-H5 — Nessun cap sulle sessioni SSE del server MCP (DoS)
- **File**: [src/mcp/server.ts](src/mcp/server.ts#L217-L249)
- **Categoria**: Security + Performance
- **Descrizione**: `openSseStream` non limita `this.sessions`. Ogni sessione apre 2 timer (15s + 30min). Con `mcpBindAddress` overridable e `mcpBearerToken` default vuoto, un client che apre `GET /sse` in loop esaurisce loop/descrittori.
- **Fix**: (1) cap configurabile (`maxSseSessions`, default 16) → HTTP 503 oltre soglia; (2) richiedere bearer quando `bindAddress !== '127.0.0.1'`; (3) documentare in `package.json`.

### MEDIUM

| ID | File | Issue | Fix | Stato |
|---|---|---|---|---|
| B-M1 | [src/ui/statusBarItem.ts](src/ui/statusBarItem.ts#L91) | `MarkdownString(undefined, true)` `isTrusted` non giustificato | Rimuovere il secondo arg | ⚠ FALSE-POSITIVE: secondo arg è `supportThemeIcons`, necessario per `$(clock)` icons |
| B-M2 | [src/mcp/tools.ts](src/mcp/tools.ts#L233-L246), [src/extension.ts](src/extension.ts#L84-L91) | `getConfig()` chiamato 2-3 volte nello stesso callback | Cache locale `const cfg = ...` | ✅ FIXED (defaultsFor helper) |
| B-M3 | [package.json](package.json#L506-L510) | `ozBridge.ozPath` (e `mcpEnabled/Port/BindAddress`) senza `scope: machine` | Aggiungere `"scope": "machine"` | ✅ FIXED |
| B-M4 | [src/ui/dashboardPanel.ts](src/ui/dashboardPanel.ts#L146-L155) | `onDidReceiveMessage` senza validazione struttura | `parseDashboardMessage(): DashboardMessage \| null` | ✅ FIXED |
| B-M5 | [src/ui/driveTreeProvider.ts](src/ui/driveTreeProvider.ts#L200-L214) | Frontmatter YAML utente in `appendMarkdown` non escapato | `appendText` o escape `*_[]()<>` | ✅ FIXED |
| B-M6 | [package.json](package.json#L27-L62) | `onStartupFinished` + 33 eventi granulari = duplicazione | Tenere uno solo dei due (vedi C-M4) | ✅ FIXED (rimosso onStartupFinished) |
| B-M7 | [src/extension.ts](src/extension.ts#L54) | `EXTENSION_VERSION = '1.1.0'` hard-coded | `context.extension.packageJSON.version` | ✅ FIXED |
| B-M8 | [src/mcp/registrars/codexRegistrar.ts](src/mcp/registrars/codexRegistrar.ts#L46-L66) | TOCTOU `existsSync` + `readFileSync` | `fs.promises.readFile` + gestire `ENOENT` | ✅ FIXED (in B-H4) |

### LOW

| ID | File | Issue |
|---|---|---|
| B-L1 | [src/extension.ts](src/extension.ts#L353) | `logInfo("Oz CLI path: ...")` espone homedir completo |
| B-L2 | [src/mcp/server.ts](src/mcp/server.ts#L230-L240) | 2 timer per-session — possibile interval globale condiviso |
| B-L3 | [src/services/ozCliService.ts](src/services/ozCliService.ts#L805-L840) | `tryParseNdjson` re-parsing di stdout già consumato in streaming |
| B-L4 | [src/services/ozCliService.ts](src/services/ozCliService.ts#L981-L988) | `validateCliArg` permissivo per `model/profile/skill/environment` |
| B-L5 | [src/commands/cloudCommand.ts](src/commands/cloudCommand.ts#L72-L74) | `env.name`/`env.id` in code-span senza escape backtick |
| B-L6 | Vari registrars/scaffold | `mkdirSync(recursive)` ridondante per write atomic |
| B-L7 | [src/extension.ts](src/extension.ts#L57-L66) | `isWarpUri` non valida `authority`/`path`, accetta `warp://attacker.com/...` |

---

## PASS C — Tests, Build, Deps, L10n

### HIGH

_Nessuna._ 0 missing translation, 0 `it.skip`/`it.only`, 0 test failure, 0 vuln npm, l10n 100% complete (52 chiavi `bundle.l10n` × 6 lingue, 42 chiavi `package.nls` × 6 lingue, 0 placeholder mismatch).

### MEDIUM

#### C-M1 — Moduli source senza test diretti
- **Categoria**: Test
- **Moduli**: [src/utils/error.ts](src/utils/error.ts), [src/services/languageModelClient.ts](src/services/languageModelClient.ts) (factory non testata), [src/tools/baseTool.ts](src/tools/baseTool.ts) (solo indirettamente), tutto [packages/copilot-chat-toolkit/src/](packages/copilot-chat-toolkit/) **escluso da coverage** via `vitest.config.ts:23`.
- **Fix**: aggiungere `test/utils/error.test.ts`, `test/services/languageModelClient.test.ts`, `test/tools/baseTool.test.ts`. Includere il package toolkit in coverage o spostarlo in suite separata.

#### C-M2 — Asserzioni deboli (`toBeDefined()` su oggetti non triviali)
- **File**: [test/commands/router.test.ts](test/commands/router.test.ts#L41), [test/commands/routerEdge.test.ts](test/commands/routerEdge.test.ts#L59), [test/commands/initV2Command.test.ts](test/commands/initV2Command.test.ts#L278), [test/edgeCasesErrorHandling2.test.ts](test/edgeCasesErrorHandling2.test.ts#L667), [test/audit/activationEventsExtended.test.ts](test/audit/activationEventsExtended.test.ts#L32).
- **Fix**: `toMatchObject({...})`, `toEqual(...)`, `toHaveProperty(...)`.

#### C-M3 — `flushMicrotasks` con `setTimeout(50)` reale (potenziale flake)
- **File**: [test/extensionEdge.test.ts](test/extensionEdge.test.ts#L69), [test/extensionRefactoring.test.ts](test/extensionRefactoring.test.ts#L63), [test/ui/dashboardPanel.test.ts](test/ui/dashboardPanel.test.ts#L155).
- **Fix**: `await new Promise<void>((r) => setImmediate(r))` o `vi.waitFor(...)`.

#### C-M4 — `activationEvents` ridondanti
- **File**: [package.json](package.json#L26-L60). `onStartupFinished` + 33 eventi granulari.
- **Fix**: scegliere una strategia (preferibile: rimuovere `onStartupFinished`, mantenere granulari per cold-start cost).

#### C-M5 — Coverage thresholds assenti in `vitest.config.ts`
- **File**: [vitest.config.ts](vitest.config.ts#L18-L21).
- **Fix**: `thresholds: { lines: 85, functions: 85, branches: 75, statements: 85 }` calibrato sui valori attuali.

### LOW

| ID | File | Issue |
|---|---|---|
| C-L1 | [package.json](package.json#L386) | `@types/node@^25` vs esbuild `target: node20` — drift type API |
| C-L2 | [package.json](package.json#L380) | `@vscode/vsce` invocato via `npx`, non pinnato in devDeps |
| C-L3 | [tsconfig.json](tsconfig.json#L17-L18) | `declaration`/`declarationMap` set ma `compile` è `--noEmit` (config morta) |
| C-L4 | [test/services/runStats.test.ts](test/services/runStats.test.ts#L71) | Date locali senza TZ pin (potenziale flake su CI agent diversi) |
| C-L5 | [l10n/](l10n/) | Voci intenzionalmente identiche (brand names) — solo cosmetica |
| C-L6 | [.vscodeignore](.vscodeignore#L31) | `*.ts` blanket exclude — ordine fragile |
| C-L7 | [test/audit/activationEventsExtended.test.ts](test/audit/activationEventsExtended.test.ts) | Coverage parziale sugli eventi `onLanguageModelTool:oz_*` |

---

## Top 10 priorità di rework

| # | ID | Severità | File | Effort | Stato |
|---|---|---|---|---|---|
| 1 | B-H1 | HIGH | `dashboardPanel.ts` — `localResourceRoots: []` | 5min | ✅ FIXED |
| 2 | A-H1 | HIGH | `languageModelClient.ts` — dispose `CancellationTokenSource` | 10min | ✅ FIXED |
| 3 | A-H2 | HIGH | `ozCliService.ts` — clear `forceKillHandle` prima di riarmo | 5min | ✅ FIXED |
| 4 | B-H2 | HIGH | `mcp/lifecycle.ts` — `showErrorMessage` su MCP fail | 5min | ✅ FIXED |
| 5 | B-H3 | HIGH | `cloudCommand.ts` — `showErrorMessage` su FAILED | 5min | ✅ FIXED |
| 6 | B-H5 | HIGH | `mcp/server.ts` — cap SSE + bearer obbligatorio non-loopback | 30min | ✅ FIXED |
| 7 | A-H3 | HIGH | `extension.ts` — extension-lifetime cancellation token | 30min | ✅ FIXED |
| 8 | B-H4 | HIGH | Migrazione `fs.promises` (5 file) | 2-4h | ✅ FIXED |
| 9 | B-M3 | MED | `package.json` — `scope: machine` su settings sensibili | 5min | pending |
| 10 | C-M4 + B-M6 | MED | `activationEvents` cleanup | 10min | pending |

**Stima totale "blocker pre-release"**: tutti gli 8 HIGH risolti — suite 1207/1207 verde dopo applicazione. Restano solo MEDIUM/LOW non bloccanti.

---

## Note finali

### Punti di forza confermati
- **Spawn senza shell** quando il path non è `.cmd` su Windows.
- **Env deny-list** (`SENSITIVE_ENV_KEYS`) e **timing-safe equality** sui bearer token.
- **`readBody` con `maxBytes = 1MB`** su `POST /messages`.
- **`realpathSync` + `isInside`** in `FileSystemDriveSource.read` (anti-symlink-escape).
- **Telemetria** con doppio gate (host + connection string) e deny-list di chiavi sensibili.
- **Atomic-write pattern** (`.tmp` + `renameSync`).
- **Nessun `eval` / `new Function`** nel perimetro.
- **Nessun pattern prototype pollution** (no `Object.assign({}, userInput)`, no `_.merge`).
- **ReDoS**: tutti i pattern (`STACK_PATTERNS`, `validateJqFilter`, `^Bearer\s+(.+)$`) sono lineari/anchored.
- **Test suite stabile**: 1207/1207, fake timers usati correttamente, tmp filesystem cleanup affidabile, `fileParallelism: false` documentato.
- **L10n al 100%** con 0 placeholder mismatch.

### Falsi positivi esclusi
- Tutti i `as Record<string, unknown>` preceduti da guard `typeof === 'object' && !== null` (warpDriveSource, outputFormatter, fileSystemDriveSource, jsonRegistrarBase).
- `as NodeJS.ErrnoException` per accesso a `.code` (idiomatico Node).
- `catch { /* ignore */ }` documentati su `res.end()`/`res.write()`/`proc.kill()` post-cleanup.
- `HttpAppInsightsReporter.dispose()` fire-and-forget — by-design (PRIVACY.md).

### Confronto con audit v1
Tutti gli ISSUE numerati di `AUDIT_REPORT.md` v1 sono **chiusi** (verificati 1207/1207 verde dopo Phase 7). I finding di v2 sono **regressioni latenti emerse da nuovo perimetro analizzato** (MCP server SSE, webview hardening, scope settings, I/O sincrono multi-file) o **categorie non coperte da v1** (activationEvents redundancy, coverage thresholds, asserzioni deboli, l10n cross-bundle).

**VERDETTO**: **REWORK** — bloccanti per il prossimo tag: B-H1, B-H2, B-H3, B-H5, A-H1, A-H2. A-H3 e B-H4 pianificabili come PR dedicati.
