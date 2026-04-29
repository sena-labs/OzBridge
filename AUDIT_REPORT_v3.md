# OzBridge — Audit Report v3 (multidisciplinare, multipassata)

**Branch**: `fix/insufficient-credits-detection` · **Commit base**: `9854d9d` · **Data**: 2026-04-29
**Suite**: 1243/1243 ✅ · `tsc --noEmit` ✅ · `npm audit` 0 vulns ✅ · CI matrix 2 Node × 3 OS ✅

Audit eseguito in 6 passate (codice / test / manifest+deps / build / docs+l10n / cross-cutting), con confronto incrociato vs `AUDIT_REPORT_v2.md` per **escludere finding già chiusi**. Tutti gli HIGH/MEDIUM del v2 risultano correttamente FIXED.

---

## Executive summary

| Severità | Count | Note |
|---|---|---|
| **HIGH** | 0 | Nessun blocker pre-release |
| **MEDIUM** | 7 | Hardening (security input, l10n, mock isolation, CI gate) |
| **LOW** | 7 | Cosmetici, manifest metadata, perf marginale |
| **TOTALE** | **14** | |

Postura complessiva: **molto buona**. Il codebase mostra disciplina su tipizzazione, dispose pattern, security webview, separazione runtime/types, l10n di prima linea (`vscode.l10n.t`). Le segnalazioni v3 sono di **rifinitura**, non di rischio.

---

## 1) Codice sorgente — `src/**`, `packages/copilot-chat-toolkit/src/**`

### MEDIUM

#### D-M1 — Synchronous I/O residuo in `WorkspaceConfigResolver.reload()`
- **File**: [src/services/workspaceConfigResolver.ts](src/services/workspaceConfigResolver.ts#L178)
- **Categoria**: Performance / coerenza con B-H4 (migrazione `fs.promises`)
- **Problema**: `reload()` fa `fs.readFileSync(filePath, 'utf8')`. È l'unico residuo `*Sync` sopravvissuto a B-H4. Viene invocato all'attivazione + a ogni cambio config — su drive di rete lenti può bloccare l'event loop dell'extension host per centinaia di ms.
- **Fix**: convertire `reload()` in `async reload(): Promise<void>` e usare `await fsp.readFile(filePath, 'utf8')`. Aggiornare i call site (binder del watcher e activation).
- **Confidence**: Certain

### LOW

_Nessun finding LOW di codice oltre a quelli già coperti dal v2._ Codebase pulito: command injection, path traversal, webview CSP, telemetry deny-list, SSE DoS, MCP bearer non-loopback, dispose pattern — tutti correttamente protetti.

---

## 2) Test — `test/**`

### MEDIUM

#### T-M1 — `vi.resetModules()` mancante con dynamic import di `src/extension.js`
- **File**: [test/extensionEdge.test.ts](test/extensionEdge.test.ts#L41), [test/extensionRefactoring.test.ts](test/extensionRefactoring.test.ts#L36), [test/activationPerf.test.ts](test/activationPerf.test.ts#L82-L95)
- **Categoria**: Mock leak / flake risk
- **Problema**: I tre file mockano `node:child_process` a livello file con stato mutabile (`spawnBehavior`) e poi fanno `await import('../src/extension.js')` in più test, ma usano solo `vi.clearAllMocks()` nel `beforeEach`, non `vi.resetModules()`. La cache ESM trattiene l'istanza di `extension.ts` tra test → state globale (subscriber, listener) può sopravvivere e mascherare/causare flake. Pattern corretto già usato in [test/killSwitchLts.test.ts](test/killSwitchLts.test.ts#L19).
- **Fix**: aggiungere `vi.resetModules()` in `beforeEach` (o subito prima di ogni `await import('../src/extension.js')`) nei tre file.
- **Confidence**: Likely

#### T-M2 — `console.info()` in `activationPerf.test.ts` inquina output runner
- **File**: [test/activationPerf.test.ts](test/activationPerf.test.ts#L88)
- **Categoria**: Lint quality
- **Problema**: `console.info()` con `eslint-disable` per loggare distribuzione percentile. In CI verbose noise; viola "no console output" implicita.
- **Fix**: gate dietro `if (process.env.OZBRIDGE_PERF_LOG)` o usare `vi.spyOn(console, 'info').mockImplementation(() => {})` per silenziarlo dopo aver verificato che è stato chiamato.
- **Confidence**: Likely

### LOW

#### T-L1 — Asserzioni weak su `accessibilityInformation`
- **File**: [test/accessibility.test.ts](test/accessibility.test.ts#L65-L161)
- **Categoria**: Asserzioni deboli
- **Problema**: 6 occorrenze di `expect(item.accessibilityInformation).toBeDefined()` senza verificare struttura interna (label/role).
- **Fix**: `toMatchObject({ label: expect.any(String), role: expect.stringMatching(/^(treeitem|button)$/) })`.
- **Confidence**: Possible

#### T-L2 — Asserzioni "negative-only" senza positive sibling
- **File**: [test/commands/cloudCommand.test.ts](test/commands/cloudCommand.test.ts#L35) (e pattern simile in altri router test)
- **Categoria**: Asserzioni deboli
- **Problema**: `expect(cli.agentRun).not.toHaveBeenCalled()` senza asserzione positiva su quale alternativa è stata chiamata (es. `cli.modelList`). Refactor che cambia il branch positivo passa il test.
- **Fix**: aggiungere asserzione positiva esplicita dopo il guard.
- **Confidence**: Possible

#### T-L3 — `disposeAll()` non in try/finally con `useFakeTimers`
- **File**: [test/services/runPoller.test.ts](test/services/runPoller.test.ts#L13-L18), [test/services/activeRunsTracker.test.ts](test/services/activeRunsTracker.test.ts#L9-L14)
- **Categoria**: Flake risk
- **Problema**: `afterEach` fa `poller.disposeAll(); vi.useRealTimers();` in sequenza. Se `disposeAll()` lancia, `useRealTimers()` non viene chiamato e i fake timer leakano nel test successivo.
- **Fix**: `afterEach(() => { try { poller?.disposeAll(); } finally { vi.useRealTimers(); } })`.
- **Confidence**: Possible

---

## 3) Manifest, dipendenze, LM Tools

### MEDIUM

#### M-M1 — `inputSchema` dei 4 LM tools senza `additionalProperties: false`
- **File**: [package.json](package.json#L128-L223) (oz_run_local, oz_run_cloud, oz_get_run, oz_list_runs)
- **Categoria**: Security / input validation (whitelist over blacklist)
- **Problema**: Gli schema JSON consentono campi arbitrari oltre quelli dichiarati. Un agent LM (o un MCP client) può inviare proprietà non previste senza rifiuto schema-side; la sanitizzazione cade sull'implementazione.
- **Fix**: aggiungere `"additionalProperties": false` a ciascuno dei 4 `inputSchema`.
- **Confidence**: Certain

#### M-M2 — `extensionKind` non dichiarato
- **File**: [package.json](package.json#L1)
- **Categoria**: Manifest VS Code (Remote/Web compatibility)
- **Problema**: Nessun `extensionKind`. OzBridge ha sia UI (sidebar/dashboard) che workspace concerns (CLI spawn locale, MCP server su loopback). Su VS Code Remote/Codespaces VS Code deve indovinare il kind, e la scelta automatica può forzare il caricamento sul lato sbagliato (es. UI side senza accesso al filesystem).
- **Fix**: dichiarare `"extensionKind": ["workspace"]` (richiede accesso processo locale per `spawn(oz)` e bind socket loopback).
- **Confidence**: Likely

### LOW

#### M-L1 — `keywords` mancante a livello manifest principale
- **File**: [package.json](package.json#L1)
- **Categoria**: Marketplace discoverability
- **Problema**: Solo il sub-package toolkit ha `keywords`. Il manifest pubblicato sul Marketplace non ha keyword → discoverability ridotta per query "MCP", "Warp", "agent", "LLM".
- **Fix**: aggiungere `"keywords": ["chat", "copilot", "agent", "AI", "LLM", "Warp", "Oz", "MCP", "model-context-protocol"]`.
- **Confidence**: Likely

---

## 4) Build, release, CI

### MEDIUM

#### B-M1 — CI non esegue `vitest --coverage`, i thresholds non sono enforced
- **File**: [.github/workflows/ci.yml](.github/workflows/ci.yml) (step "Run tests")
- **Categoria**: Quality gate
- **Problema**: C-M5 ha aggiunto `coverage.thresholds` in `vitest.config.ts`, ma il CI esegue `npm test -- --run` senza `--coverage`. La regression detection è quindi affidata al run locale dello sviluppatore — in PR la soglia non scatta mai.
- **Fix**: aggiungere step "Run coverage gate" su un solo job (es. `node 22 / ubuntu`) con `npx vitest run --coverage` dopo "Run tests"; opzionalmente uploadare `coverage/lcov.info` come artifact per code-scanning.
- **Confidence**: Certain

### LOW

#### B-L1 — CI non ha step `npm audit --audit-level=high`
- **File**: [.github/workflows/ci.yml](.github/workflows/ci.yml)
- **Categoria**: Supply chain
- **Problema**: Oggi `npm audit` torna 0 vuln, ma nessun gate lo rileva quando una transitive dep verrà flaggata. CodeQL copre source ma non advisory npm.
- **Fix**: aggiungere step `npm audit --audit-level=high --omit=dev` su un job (warning-only se troppo rumoroso, blocking ideale).
- **Confidence**: Likely

#### B-L2 — Nessun verifier che `dist/extension.js.map` non finisca nel VSIX
- **File**: [.vscodeignore](.vscodeignore)
- **Categoria**: Privacy / pacchetto
- **Problema**: `.vscodeignore` esclude `dist/**/*.map`, ma non c'è un test che verifichi a packaging-time. Una modifica futura al ignore può sbloccare i source map nel VSIX (rivelando struttura interna).
- **Fix**: aggiungere test in `test/publishingReadiness.test.ts` che esegue `vsce ls` (o legge `.vscodeignore`) e assert su assenza di `*.map`.
- **Confidence**: Possible

---

## 5) Docs / L10n / a11y

### MEDIUM

#### L-M1 — Stringhe utente-facing hardcoded in `outputFormatter.ts`
- **File**: [src/parsers/outputFormatter.ts](src/parsers/outputFormatter.ts#L60), [src/parsers/outputFormatter.ts](src/parsers/outputFormatter.ts#L118), [src/parsers/outputFormatter.ts](src/parsers/outputFormatter.ts#L127), [src/parsers/outputFormatter.ts](src/parsers/outputFormatter.ts#L143)
- **Categoria**: L10n
- **Problema**: 4 button title (`'🌐 Open in browser'`, `'📥 Install Warp'`, `'🔑 Login Warp'`, `'💳 Manage Warp billing'`) e diversi blocchi `stream.markdown(...)` di errore (es. "**Oz CLI not found.**", "**Out of Warp credits.**") sono hardcoded in inglese. Le 5 lingue di `bundle.l10n.*.json` non li coprono.
- **Fix**: estrarre in `vscode.l10n.t(...)` con chiavi tipo `formatter.openInBrowser`, `formatter.installWarp`, ecc., e propagare alle 6 bundle.
- **Confidence**: Certain

#### L-M2 — Titolo QuickPick `/init` hardcoded
- **File**: [src/commands/initV2Command.ts](src/commands/initV2Command.ts#L133)
- **Categoria**: L10n
- **Problema**: `title: 'OzBridge · /init templates'` non passa per `l10n.t`.
- **Fix**: `l10n.t('quickpick.initTemplates.title')` + nuova chiave nelle 6 bundle.
- **Confidence**: Certain

---

## 6) Cross-cutting

_Nessun finding aggiuntivo._ Architettura modulare (commands/services/tools/ui), boundary tipi tra `packages/copilot-chat-toolkit` e `src` rispettati, telemetry con kill-switch e deny-list, SSE keepalive condiviso (post v2 fix), single source of truth per config (`getConfig()` cached). Test di consistenza manifest (`manifestActivationConsistency`, `activationEventsExtended`) garantiscono che il manifesto resti allineato.

---

## Priorità di rework consigliate (top 10)

| # | ID | Sev | Effort | Razionale |
|---|---|---|---|---|
| 1 | M-M1 | MED | 5min | Security hardening LM tools — fix banale, alto valore |
| 2 | B-M1 | MED | 10min | Senza coverage gate in CI, C-M5 non protegge nulla in PR |
| 3 | L-M1 | MED | 30min | UX 5 lingue: utenti non-EN vedono inglese sui pulsanti d'errore |
| 4 | T-M1 | MED | 15min | Flake silente prima o poi morde su Windows-CI |
| 5 | L-M2 | MED | 5min | Coerenza l10n con il resto di `/init` |
| 6 | M-M2 | MED | 2min | Predicibilità su Remote/Codespaces |
| 7 | D-M1 | MED | 15min | Coerenza B-H4 — chiude l'ultimo `*Sync` |
| 8 | T-M2 | MED | 5min | Pulizia output CI |
| 9 | M-L1 | LOW | 2min | Marketplace SEO |
| 10 | B-L1 | LOW | 5min | Supply chain gate |

**Stima totale**: ~90 minuti di lavoro per chiudere tutti i 7 MEDIUM.

---

## Cosa NON è un problema (esplicitato per evitare re-segnalazioni)

- `npm audit` → 0 vulnerabilità (prod 3 / dev 423).
- `tsc --noEmit` → 0 errori dopo downgrade `@types/node@^20`.
- Suite 1243/1243, coverage 88.59 / 81.11 / 92.03 / 89.77 (sopra thresholds).
- CodeQL workflow attivo (weekly cron + PR).
- Bundle budget 125 KB enforced in CI.
- CI matrix coverage: ubuntu/windows/macos × node 20.19/22.12.
- Telemetry: kill-switch via setting + AppInsights conn-string opzionale + deny-list chiavi.
- Webview `dashboardPanel`: `localResourceRoots: []`, message validation strict (post B-H1).
- MCP server: bearer obbligatorio non-loopback, SSE session cap, max-lifetime per sessione, keepalive condiviso (post B-H5).
- Cancellation: `extensionLifetimeCts` propagato (post A-H3).
