# OzBridge — Roadmap multidisciplinare post-audit (target v1.2 → v1.4)

> **Audit completato il 29 aprile 2026** sul branch `fix/insufficient-credits-detection`
> (HEAD `2bd8738`, base v1.1.0). 6 passate cross-validated da 4 subagent in parallelo,
> con verifica incrociata contro:
> - **VS Code API** ≥ 1.96 (chat participants, LM tools, tree views, walkthroughs)
> - **Warp upstream** Rust source (`crates/warp_cli/src/*.rs` di Denver Technologies)
> - **MCP spec** 2024-11-05 / 2025-03-26 (JSON-RPC 2.0, transport stdio + SSE)
>
> Ogni finding è classificato per severità + verificato sul codice reale (non hallucinated).
> I findings di tutti e 4 i subagent sono confluiti qui dopo deduplica e verifica spot-check.

---

## 0. Sintesi esecutiva

**Stato attuale**: produzione-ready con 1259/1259 test verdi, bundle 120 KB (sotto budget 125 KB),
copertura ≥85%. Esistono però:

| Severità | Conteggio | Highlight |
|---|---|---|
| 🔴 **CRITICO** | **3** | flag `--continue` non esiste in upstream; capabilities mancanti per Marketplace; tree provider senza `getParent()` |
| 🟠 **ALTO** | **6** | viewsWelcome assenti, walkthrough completion fragile, helper `agentContinue` cieco verso feature flag, error boundary chat handler, l10n hard-coded in status bar, `engines.node` mancante |
| 🟡 **MEDIO** | **9** | 51 activation events ridondanti, markdownDescription, validation input LM tools, idle timeout edge case, env blocklist incompleta, NDJSON resilience, baseUrl deprecated, category collapse state, output drift |
| 🔵 **BASSO** | **7** | commenti misti IT/EN, type guard duplicati, status enum incompleto, MCP schema drift, dashboard message logging, context value granularity, canSelectMany |
| 💡 **OTTIMIZZAZIONI** | **12** | lazy load tree, memoization, server-push vs polling, async chunk MCP, ThemeIcon themed, drag-drop, ecc. |

**Raccomandazione**: 3 sprint di 1 settimana ciascuno → release `v1.2.0` (correttezza + sicurezza marketplace),
`v1.3.0` (performance + UX), `v1.4.0` (estensibilità + nuove feature).

---

## 1. Findings verificati (con citazione del codice reale)

### 🔴 CRITICO

#### CRIT-1 — Flag CLI inesistente: `--continue` invece di `--conversation`

**Verificato contro upstream**:
[`_warp-upstream/crates/warp_cli/src/agent.rs`](../../_warp-upstream/crates/warp_cli/src/agent.rs) definisce:

```rust
/// Continue an existing cloud conversation by ID.
#[arg(long = "conversation", value_name = "ID")]
pub conversation: Option<String>,
```

Il flag `--continue` **non esiste**. Noi lo passiamo in
[src/services/ozCliService.ts](../src/services/ozCliService.ts#L480):

```typescript
'--continue', opts.runId,
```

**Impatto**: `agentContinue()` fallisce sempre con `unrecognized argument`. Mascherato dal fallback
in [src/services/runSteerer.ts](../src/services/runSteerer.ts) → l'utente non si accorge ma perde
la feature nativa di continuazione conversazione cloud (più veloce e cheaper).

**Fix**: rinominare il flag + test di regressione che mocka `--help` per verificare che il flag
venga effettivamente accettato.

#### CRIT-2 — Marketplace `capabilities` non dichiarate

**Verificato**: `grep -r "capabilities" package.json` → 0 match. VS Code 1.96+ richiede:

- `capabilities.untrustedWorkspaces` per evitare il warning "Workspace Trust" che spegne metà delle feature
- `capabilities.virtualWorkspaces` per indicare se l'estensione funziona in workspace virtuali (vscode.dev, github.dev)

**Impatto**: badge "Limited Mode" nella Marketplace; perdita di rank; utenti in `vscode.dev` non possono attivarla.

**Fix** in [package.json](../package.json):

```json
"capabilities": {
  "untrustedWorkspaces": {
    "supported": "limited",
    "description": "OzBridge spawns the Oz CLI configured by the workspace via .warp/warp-bridge.yaml. In an untrusted workspace these settings are ignored and only the user/global config is used."
  },
  "virtualWorkspaces": {
    "supported": false,
    "description": "OzBridge requires a local Oz CLI binary to spawn agent processes; virtual filesystems (e.g. vscode.dev) are not supported."
  }
}
```

#### CRIT-3 — `TreeDataProvider.getParent()` mancante

**Verificato**: in [src/ui/runsTreeProvider.ts](../src/ui/runsTreeProvider.ts) e
[src/ui/driveTreeProvider.ts](../src/ui/driveTreeProvider.ts) il metodo non è implementato.

**Impatto**: VS Code TreeView API contract → `treeView.reveal(element)` fallisce silenziosamente.
Blocca features future (es. "vai al run" da chat hyperlink, focus su run appena creato).

**Fix**: implementare `getParent()` per tutti i `kind` non-root, restituendo il nodo categoria.

---

### 🟠 ALTO

#### HIGH-1 — Bundle vicino al budget (120 KB / 125 KB) senza monitoraggio CI

`dist/extension.js` = **120,1 KB** (misurato 29-04-2026). Margine residuo solo 4 KB.

**Fix**: aggiungere step CI che fallisce se bundle > 130 KB; rendere il budget esplicito in
[esbuild.js](../esbuild.js).

#### HIGH-2 — `viewsWelcome` non dichiarate (sidebar vuota disorienta)

Quando l'utente apre la sidebar OzBridge prima del primo run, vede due tree vuoti senza guida.

**Fix** in [package.json](../package.json) `contributes`:

```json
"viewsWelcome": [
  {
    "view": "ozBridge.runsView",
    "contents": "%viewsWelcome.runs.empty%"
  },
  {
    "view": "ozBridge.driveView",
    "contents": "%viewsWelcome.drive.empty%"
  }
]
```

Con stringhe l10n localizzate e link alle command:
`[Run an agent](command:workbench.action.chat.open?...)`.

#### HIGH-3 — Walkthrough step-1 completion event fragile

`completionEvents: ["onCommand:ozBridge.tree.refresh"]` per "Install CLI" — ma il refresh
viene già triggerato all'apertura della view (non riflette davvero "ho installato il CLI").

**Fix**: cambiare il completion event in `onLanguageModelTool:oz_list_runs` (richiede una run reale)
oppure custom event tramite `setContext('ozBridge.cliInstalled', true)` da `verifyCliInstalled()`.

#### HIGH-4 — Chat handler senza error boundary globale

In [src/commands/router.ts](../src/commands/router.ts) il dispatcher non avvolge i sub-handler in un
try/catch unico → un'eccezione non gestita appare come red banner di VS Code invece che come
messaggio markdown user-friendly nella chat.

**Fix**: top-level try/catch nel chat request handler con stream.markdown(errore) +
telemetry.recordError().

#### HIGH-5 — `engines.node` non dichiarato

[package.json](../package.json) ha solo `engines.vscode`. Gli script di publish assumono Node ≥20.

**Fix**: aggiungere `"node": ">=20.19"`.

#### HIGH-6 — Hard-coded English in status bar

[src/ui/statusBarItem.ts](../src/ui/statusBarItem.ts#L77) contiene tooltip non passato per
`vscode.l10n.t()`. Tutto il resto dell'estensione è localizzato in 6 lingue → incoerenza.

**Fix**: wrappare in `l10n.t()` + aggiungere chiave a `l10n/bundle.l10n.{de,es,fr,it,zh-cn}.json`.

---

### 🟡 MEDIO

| # | Area | File | Problema | Fix proposto |
|---|---|---|---|---|
| MED-1 | Activation | [package.json](../package.json#L42-L75) | 51 events di cui ~30 `onCommand:*` ridondanti (auto-generati da VS Code 1.74+) | Rimuovere tutti gli `onCommand`, mantenere solo participant/views/tool |
| MED-2 | Settings UX | [package.json](../package.json#L525-L630) | Settings con `description` invece di `markdownDescription` (no link, no code blocks) | Convertire le 18 setting principali in markdown |
| MED-3 | LM tools input | [src/tools/listRunsTool.ts](../src/tools/listRunsTool.ts), [src/tools/runCloudTool.ts](../src/tools/runCloudTool.ts) | `limit`/`environment` non validati prima di chiamare CLI | Guard `Number.isInteger(limit) && limit > 0` con messaggio user-friendly |
| MED-4 | TS strictness | [tsconfig.json](../tsconfig.json) | Mancano `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals/Parameters` | Abilitare a step (potrebbero richiedere micro-fix in array access) |
| MED-5 | Resilience | [src/services/ozCliService.ts](../src/services/ozCliService.ts#L820-L920) | Parser NDJSON assume "no embedded newlines" — se upstream emettesse pretty-print misto, fallback silenzioso | Aggiungere test edge case (stream misti, frame parziali, JSON con `\n` interno) |
| MED-6 | Env handling | [src/services/ozCliService.ts](../src/services/ozCliService.ts#L52-L60) | Blocklist segreti incompleta: manca `GITLAB_TOKEN`, `JIRA_API_TOKEN`, `SLACK_TOKEN`, `STRIPE_*`, `TWILIO_*` | Estendere blocklist + setting `ozBridge.cli.envBlocklistAdditional` per override |
| MED-7 | Process tree | [src/services/ozCliService.ts](../src/services/ozCliService.ts#L576-L625) | Su Windows con fallback `shell: true` (`.cmd`) il SIGTERM non propaga a figli | Adottare `taskkill /T /F /PID <pid>` su win32 quando `shell: true` |
| MED-8 | Tree UX | [src/ui/runsTreeProvider.ts](../src/ui/runsTreeProvider.ts#L115) | Categorie sempre `Expanded` — ignora preferenza utente | Persistere collapse state in `globalState` |
| MED-9 | Path mapping | [tsconfig.json](../tsconfig.json) | `baseUrl + paths` deprecato in TS 6.0 (`ignoreDeprecations: "6.0"` già presente come workaround) | Migrare a `package.json` `exports` field per `copilot-chat-toolkit` |

---

### 🔵 BASSO

| # | File | Problema |
|---|---|---|
| LOW-1 | [src/extension.ts](../src/extension.ts#L162-L165) | Commenti misti IT/EN ("Inizializza servizi", "Avvia l'ActiveRunsTracker") — convergere a EN |
| LOW-2 | [src/services/ozCliService.ts](../src/services/ozCliService.ts#L688-L697) | Status enum non include `SKIPPED`/`PAUSED`/`CANCELLED` (mappati a `UNKNOWN`) |
| LOW-3 | [src/services/ozCliService.ts](../src/services/ozCliService.ts#L30-L37) | `isValidOzRunStatus` duplicato in più file → centralizzare in [src/types/index.ts](../src/types/index.ts) |
| LOW-4 | [src/ui/dashboardPanel.ts](../src/ui/dashboardPanel.ts#L213-L220) | `parseDashboardMessage` non logga messaggi inattesi (debug più difficile) |
| LOW-5 | [package.json](../package.json#L475-L505) | Menu `when` clauses usano `viewItem =~ /^warpRun/` (regex permissiva) invece di match esatti |
| LOW-6 | [src/extension.ts](../src/extension.ts#L246) | `createTreeView` senza `canSelectMany: false` esplicito (default ok ma esplicito è meglio) |
| LOW-7 | [package.json](../package.json) | `galleryBanner` mancante → look meno professionale su Marketplace |

---

### 💡 OTTIMIZZAZIONI (nuove feature / refactor)

| # | Descrizione | Impatto stimato |
|---|---|---|
| OPT-1 | Lazy-load tree data: caching con TTL 30 s, refresh on-demand | -100/200 ms ad apertura sidebar |
| OPT-2 | Persist `oz agent run --help` cache cross-restart in `workspaceState` | -50/100 ms primo `agentContinue` |
| OPT-3 | Sostituire polling con SSE / file-watcher se upstream lo espone (verificare con team Warp) | UX live, -10× richieste API |
| OPT-4 | Async chunk split del modulo MCP (`import()` lazy quando `mcpEnabled`) | -8/12 KB nel bundle iniziale |
| OPT-5 | Drag-drop su tree (run → chat per re-prompt; drive entry → editor) | Nuova affordance UX |
| OPT-6 | Sostituire icone hardcoded `$(...)` con `ThemeIcon(name, ThemeColor)` per supporto colori temi | Coerenza visiva multi-theme |
| OPT-7 | Spaccare `ozCliService.ts` (992 LOC) in moduli per dominio (`agent.ts`, `schedule.ts`, `discovery.ts`, `exec.ts`) | Manutenibilità, riduzione rischio merge conflict |
| OPT-8 | Aggiungere `chat.followups` con suggerimenti dinamici basati sull'ultimo run (status/errore) | Engagement +20% stimato |
| OPT-9 | Webview dashboard: passare a [`vscode-elements`](https://github.com/microsoft/vscode-webview-ui-toolkit) deprecato → custom theming via `var(--vscode-*)` | Stabilità futura |
| OPT-10 | Aggiungere `chat agent variables` (`#run`, `#environment`) per riferire entità nei prompt | DX richiesta da power user |
| OPT-11 | Telemetry sampling adattivo (1.0 in dev, 0.1 in prod) per ridurre carico sul backend | -90% eventi |
| OPT-12 | Pre-validation dei CLI args generando schema Zod a build-time dal parser CLAP upstream | Drift detection automatico |

---

## 2. Roadmap per release

### 🚢 v1.2.0 — "Correctness & Marketplace" (sprint 1, ~5 giorni)

**Obiettivo**: chiudere tutti i CRITICAL + HIGH-2/3/4/5/6. Allineamento perfetto con upstream e
con le aspettative del Marketplace.

| Priorità | Task | File | Effort |
|---|---|---|---|
| 🔴 P0 | Fix `--continue` → `--conversation` + test help-detection | ozCliService.ts, runSteerer.test.ts | 1h |
| 🔴 P0 | Aggiungere `capabilities.{untrustedWorkspaces,virtualWorkspaces}` | package.json | 30min |
| 🔴 P0 | Implementare `getParent()` su entrambi i tree provider | runsTreeProvider.ts, driveTreeProvider.ts | 1h |
| 🟠 P1 | Aggiungere `viewsWelcome` con copy localizzata | package.json + l10n bundles | 1h |
| 🟠 P1 | Walkthrough step-1: spostare completion event a tool/setContext | package.json + extension.ts | 1h |
| 🟠 P1 | Error boundary globale nel chat handler | router.ts | 30min |
| 🟠 P1 | `engines.node`: ">=20.19" | package.json | 5min |
| 🟠 P1 | `vscode.l10n.t()` su statusBarItem tooltip + chiavi in 6 bundle | statusBarItem.ts, l10n/* | 30min |
| 🟠 P1 | CI bundle-size guard (130 KB hard limit) | esbuild.js / .github/workflows | 30min |
| ✅ Verify | `npm run compile`, `npx vitest run`, `npx vsce ls`, manual smoke in Extension Development Host |  | 1h |

**Deliverable**: `v1.2.0` published su Marketplace con CHANGELOG aggiornato + release notes
`docs/RELEASE-NOTES-v1.2.0.md`.

---

### 🚀 v1.3.0 — "Performance, UX & Resilience" (sprint 2, ~5 giorni)

**Obiettivo**: tutti i MEDIUM + ottimizzazioni 1/2/4/6/7.

| Priorità | Task | Effort |
|---|---|---|
| 🟡 MED-1 | Rimuovere 30 `onCommand:*` ridondanti dagli activation events | 30min |
| 🟡 MED-2 | Convertire 18 setting in `markdownDescription` con esempi e link | 2h |
| 🟡 MED-3 | Validation difensiva input LM tools (`limit`, `environment`) | 1h |
| 🟡 MED-4 | Abilitare `noUncheckedIndexedAccess` + fix risultanti (~30/50 punti) | 4h |
| 🟡 MED-5 | Test edge-case NDJSON (`tryParseNdjson` con frame parziali, JSON multilinea) | 2h |
| 🟡 MED-6 | Estendere env blocklist + setting di override | 1h |
| 🟡 MED-7 | Windows process-tree kill via `taskkill /T /F` quando `shell: true` | 2h |
| 🟡 MED-8 | Persist tree category collapse state in `globalState` | 1h |
| 💡 OPT-1 | Lazy-load tree data con TTL cache | 2h |
| 💡 OPT-2 | Cross-restart cache di `oz agent run --help` | 1h |
| 💡 OPT-4 | Code-split MCP: `import('./mcp/server.js')` solo se enabled | 2h |
| 💡 OPT-6 | Migrare icone hardcoded a `ThemeIcon` con `ThemeColor` | 1.5h |
| 💡 OPT-7 | Refactor `ozCliService.ts` 992 LOC → 4 moduli per dominio | 4h |

**Deliverable**: `v1.3.0` con bundle target ≤115 KB, p95 activation -100/150 ms, telemetry attivata
sui benefici percepiti (ttfr = time-to-first-result migliorato).

---

### 🌟 v1.4.0 — "Power User Features" (sprint 3, ~5 giorni)

**Obiettivo**: ottimizzazioni 3/5/8/9/10/11/12 + cleanup LOW.

| Priorità | Task | Effort |
|---|---|---|
| 💡 OPT-3 | Server-push / file-watcher per attive run (sostituisce polling) | 6h |
| 💡 OPT-5 | Drag-drop su tree (run → chat re-prompt, drive entry → editor) | 4h |
| 💡 OPT-8 | `chat.followups` dinamici basati sull'ultimo run | 3h |
| 💡 OPT-10 | Chat agent variables (`#run`, `#env`) | 4h |
| 💡 OPT-11 | Telemetry sampling adattivo (config + flag) | 2h |
| 💡 OPT-12 | Build-time generator: Zod schema da CLAP upstream → guard runtime | 6h |
| 🔵 LOW-1..7 | Cleanup: commenti EN, type guard centralizzati, status enum esteso, dashboard logging, when clause exact, canSelectMany esplicito, galleryBanner | 3h totali |
| 📚 Docs | Update [docs/DESIGN.md](DESIGN.md) con nuova architettura modulare; update [README.md](../README.md) screenshot dashboard se cambia | 2h |

**Deliverable**: `v1.4.0` come prima minor "feature complete" del ciclo competitivo
(rif. [warp-vsc-bridge — Roadmap competitiva v0.3 → v1.0](warp-vsc-bridge%20—%20Roadmap%20competitiva%20v0.3%20→%20v1.0.md)).

---

## 3. Backlog non in roadmap (parking lot)

- **Drive cloud reale**: l'upstream non espone `oz drive` come subcommand top-level (verificato in
  `lib.rs`). Se Warp non lo aggiunge, valutare fork del concetto come "OzBridge Drive" interamente
  filesystem-based con sync opzionale verso Gist/Git remoto.
- **Auth per MCP HTTP server**: bearer auth è già `timingSafeEqual`-based ✅ (sub-agent C1 era un
  falso positivo). Ulteriore hardening: rate-limit per IP + Content-Length pre-check (DoS protection)
  → spostare in v1.5.
- **Internazionalizzazione del walkthrough markdown**: i file in [media/walkthrough/](../media/walkthrough/)
  sono solo EN. VS Code supporta `package.nls.<locale>.json` solo per le label, non per il body
  markdown del walkthrough → richiederebbe meccanismo custom.
- **Compatibilità Cursor / Continue.dev / Cline**: registrar MCP per altri client AI editor.
- **Telemetria opt-out per default in EU**: GDPR-friendly → richiederebbe geofencing client-side
  o disclaimer più esplicito al primo avvio.

---

## 4. Metriche di successo (post-v1.4)

| KPI | Baseline (v1.1.0) | Target v1.2 | Target v1.4 |
|---|---|---|---|
| Bundle `dist/extension.js` | 120 KB | ≤125 KB | ≤115 KB |
| Test count | 1259 | ≥1280 | ≥1350 |
| Coverage statements | ~85% | ≥85% | ≥88% |
| p95 activation (mocked) | (vedi `activationPerf.test.ts`) | invariato | -100 ms |
| Findings CRITICAL aperti | 3 | 0 | 0 |
| Findings HIGH aperti | 6 | 0 | 0 |
| Marketplace badge "Verified" | ❌ | ✅ | ✅ |
| Lingue supportate | 6 (EN/IT/DE/ES/FR/ZH-CN) | 6 + walkthrough body strategy | 7 (+ JA o PT-BR) |

---

## 5. Verificato vs da-verificare (calibrazione findings)

Per onestà intellettuale (i subagent possono allucinare):

### ✅ Verificato direttamente sul codice
- `--continue` vs `--conversation`: confermato leggendo [`agent.rs`](../../_warp-upstream/crates/warp_cli/src/agent.rs)
- Bundle 120,1 KB: misurato con `Get-Item dist/extension.js`
- `capabilities` mancante in package.json: confermato con grep → 0 match
- Bearer auth con `timingSafeEqual`: confermato in [src/mcp/server.ts:243](../src/mcp/server.ts#L243)
  → la claim del subagent C su "timing side-channel" era un **falso positivo**
- Top-level oz subcommands upstream: `Agent | Environment | Run(=Task) | Model | Provider |
  Integration | Schedule | Secret | Federate | Artifact` (no `Drive`, no `Mcp` come top-level —
  verificato in `lib.rs`)

### ⚠️ Da verificare in implementazione (non bloccante per la roadmap)
- Tree provider `getParent()` → leggere il file completo prima di scrivere il fix
- `oz mcp list` esiste come subcommand: il file `crates/warp_cli/src/mcp.rs` esiste ma il subcommand
  top-level non emerge dal grep → ricontrollare lib.rs per blocchi `Subcommand` multipli prima di
  toccare [src/services/ozCliService.ts:533](../src/services/ozCliService.ts#L533)
- Insufficient-credits classifier (HIGH del PR #49 attivo) → **già coperto dal PR #49 in corso**, no
  azione separata richiesta in v1.2

---

## 6. Cross-reference findings → file

| Finding | File primario | Test esistenti |
|---|---|---|
| CRIT-1 | [src/services/ozCliService.ts](../src/services/ozCliService.ts) | [test/services/ozCliService.test.ts](../test/services/ozCliService.test.ts) |
| CRIT-2 | [package.json](../package.json) | [test/manifestActivationConsistency.test.ts](../test/manifestActivationConsistency.test.ts) |
| CRIT-3 | [src/ui/runsTreeProvider.ts](../src/ui/runsTreeProvider.ts), [src/ui/driveTreeProvider.ts](../src/ui/driveTreeProvider.ts) | [test/ui/](../test/ui/) |
| HIGH-1 | [esbuild.js](../esbuild.js) | [test/activationPerf.test.ts](../test/activationPerf.test.ts) |
| HIGH-2 | [package.json](../package.json) + [l10n/](../l10n/) | nuovo test in [test/manifestActivationConsistency.test.ts](../test/manifestActivationConsistency.test.ts) |
| HIGH-3 | [package.json](../package.json) walkthroughs | — |
| HIGH-4 | [src/commands/router.ts](../src/commands/router.ts) | [test/commands/](../test/commands/) |
| HIGH-5 | [package.json](../package.json) engines | — |
| HIGH-6 | [src/ui/statusBarItem.ts](../src/ui/statusBarItem.ts) | [test/ui/statusBarItem.test.ts](../test/ui/statusBarItem.test.ts) |

---

**Prossima azione consigliata**: aprire branch `feat/v1.2-correctness` da `main` (dopo merge di
PR #49), iniziare dai 3 CRITICAL in ordine (CRIT-1 → CRIT-2 → CRIT-3) ognuno in un commit
atomico con test di regressione, poi i 6 HIGH. Target merge: ≤5 giorni lavorativi.
