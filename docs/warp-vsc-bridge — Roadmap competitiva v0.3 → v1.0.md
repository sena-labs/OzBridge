# warp-vsc-bridge — Roadmap competitiva v0.3 → v1.0
## Obiettivo strategico
Trasformare `warp-vsc-bridge` da "Chat Participant che wrappa il CLI Oz" (v0.2.0 appena rilasciata) nell'**estensione VS Code de-facto per Warp/Oz**, superando — per ciascun asse di valore — le estensioni già presenti sul Marketplace. La roadmap è organizzata in 7 milestone tematiche: ogni milestone porta un "messaggio di destinazione" competitivo e un insieme di feature concrete che sottraggono terreno a uno o più concorrenti identificati.
## Stato di partenza (v0.2.0)
* Chat Participant `@oz` con 9 slash command (`/run`, `/cloud`, `/status`, `/history`, `/schedule`, `/models`, `/mcp`, `/config`, `/init`).
* 561/561 test verdi, TSC strict clean, bundle esbuild 28.8 KB, VSIX 30.5 KB.
* Oz CLI coverage completa (local, cloud, schedule, env, integration, profile, mcp, model).
* Posizionamento unico confermato dall'analisi di ~40 estensioni simili sul Marketplace: nessuno wrappa Oz in un Chat Participant.
## Principi di roadmap
* **Ogni milestone aggredisce una nicchia concorrente specifica.** Non "feature per feature" ma "posizionamento per posizionamento".
* **Compatibilità all'indietro.** Il flow `@oz /run ...` del v0.2.0 deve continuare a funzionare in tutte le release successive.
* **Bundle size budget.** Mantenere `dist/extension.js` sotto 125 KB fino a v1.0 (100 KB extension + 25 KB l10n bundle aggiunti in v0.9). Baseline attuale 28.8 KB, headroom ~4×.
* **Test-to-code ratio ≥ 2:1** sul codice nuovo, con vitest come framework.
* **Windows‑first, cross-platform.** Ogni feature testata su Windows (env primario dell'autore), macOS, Linux.
* **Zero runtime dependency oltre `vscode`** mantenuto per l'extension; nuove dipendenze ammesse solo via `copilot-chat-toolkit` workspace o bundle esbuild.
## v0.3.0 — "Agent-Native": Language Model Tools
### Messaggio di destinazione
*Non devi più scrivere `@oz` — Copilot Agent mode chiama Oz da solo quando serve.*
### Concorrenti superati
* `sbluemin.github-copilot-cli-agents` (1.787 installs, `@claude`/`@codex`/`@gemini`) — richiede `@`-mention esplicito, noi no.
* Tutti i wrapper CLI (`RyanReynolds.agent-terminal`, `Agent Terminal`, `Agent Grid`) — forniscono REPL separati, noi integriamo nell'agent loop.
### Deliverable
* Registrare 4 tool via `vscode.lm.registerTool` + `contributes.languageModelTools` in `package.json`:
    * `oz_run_local` — wrappa `agentRun()` con schema JSON per `prompt`, `model?`, `profile?`, `skill?`.
    * `oz_run_cloud` — wrappa `agentRunCloud()` con conferma consumo crediti come `ToolInvocationConfirmation`.
    * `oz_get_run` — wrappa `runGet(runId)`.
    * `oz_list_runs` — wrappa `runList()` con filtro opzionale `status`.
* Ogni tool dichiara `tags: ["warp", "oz", "agent"]` per il tool picker.
* `prepareInvocation` implementato con preview markdown della chiamata e conferma solo per `oz_run_cloud` (consumo crediti).
* Registrare un **custom agent** "Warp Oz" via `contributes.chatAgents` (API VS Code 1.115+) che pre-abilita i tool Warp.
* Test vitest con mock di `vscode.lm.registerTool` e `LanguageModelToolResult`.
### Metriche di successo
* In Agent mode, una prompt come "run the unit tests locally via Oz" invoca `oz_run_local` senza `@oz`.
* Tempo attivazione extension +≤ 50 ms rispetto a v0.2.0.
## v0.4.0 — "Surfaces": Sidebar, Status Bar, Cloud Run Monitor
### Messaggio di destinazione
*Non vivi più solo nella Chat view: Warp ha il suo pannello laterale e il suo indicatore di stato.*
### Concorrenti superati
* `s-hiraoku.vscode-sidebar-terminal` (900 installs) — sidebar terminal generico, noi sidebar Warp-specifica.
* `apoqgin.agent-snitch` (107 installs), `proliminal.agent-lens` (68 installs) — visualizzano sessioni agent *locali*, noi visualizziamo anche *cloud* con steering.
* `formulahendry.acp-client` (~1K) — sidebar ACP ma senza live run streaming.
### Deliverable
* **Activity Bar view** `ozBridge.sidebar` con icona Warp dedicata. 5 collezioni via `TreeDataProvider`:
    * Active Runs (QUEUED + INPROGRESS, auto-refresh 10 s)
    * History (SUCCEEDED + FAILED, paginato)
    * Schedules
    * Environments
    * MCP Servers
* Context menu per nodo: `Open in Browser`, `Copy ID`, `Cancel` (per run attivi), `Pause`/`Unpause`/`Delete` (per schedule).
* **Status Bar item** `$(cloud) Warp: N active` che cambia colore (verde = 0, giallo = 1-2, rosso = 3+). Click → focus sidebar.
* **Cloud Run Monitor webview** (nuova feature blue-ocean) per singola run:
    * Timeline eventi NDJSON (agent text / tool_call / tool_result) renderizzata con syntax highlight.
    * Pulsanti `Cancel`, `Open in Warp`, `Copy ID`.
    * Auto-scroll + filtri per tipo evento.
    * Pannello "Changes" con diff view dei file modificati (integrato con `vscode.diff` command).
* `RunPoller` refactored per emettere `onDidUpdate` event consumabile anche dalla sidebar/status bar.
### Metriche di successo
* Sidebar rendering ≤ 200 ms all'apertura workspace.
* Memory footprint +≤ 5 MB rispetto a v0.2.0.
## v0.5.0 — "Context & Handoff": Chat Variables + URI handoff
### Messaggio di destinazione
*Porta il contesto Warp dentro qualsiasi prompt, e porta qualsiasi run fuori in un terminale Warp reale con un click.*
### Concorrenti superati
* `azmolla.warp-terminal-launcher` (369 installs), `CaffeineCat.warp-terminal` (4.039 installs) — solo launcher stateless, noi facciamo handoff con contesto.
* `sbluemin.github-copilot-cli-agents` — il suo `/handoff` apre un terminale per CLI già avviate; noi facciamo handoff continuazione sessione Oz.
### Deliverable
* **Chat Variables** via `contributes.chatVariables`:
    * `#warp.env` → nome dell'environment cloud configurato.
    * `#warp.skill` → skill auto-rilevata dal testo selezionato.
    * `#warp.profile` → profilo Oz attivo.
    * `#oz.run/<id>` → payload `runGet(<id>)` come JSON nel prompt.
    * `#oz.history` → ultimi 10 run come tabella markdown.
* **Inline chat location** (`request.location === vscode.ChatLocation.Editor`): selezione codice + `@oz` → `selection` iniettata automaticamente come `[CONTEXT]` nel prompt e `skill` auto-rilevata da linguaggio file.
* Comando `ozBridge.handoffToWarp`:
    * Apre URI `warp://action/new_tab?path=<workspacePath>&command=<urlencoded>`.
    * Pre-popola il comando `oz run get <id>` per run terminate o `oz agent run --prompt "<continua da runId>"` per nuove sessioni derivate.
    * Disponibile da: Cloud Run Monitor webview, Sidebar context menu, Command Palette.
* Fallback per piattaforme senza URI handler: mostra comando da copiare/incollare.
### Metriche di successo
* Handoff funzionante su Windows, macOS, Linux con Warp ≥ 0.2024.x.
* Chat variable `#oz.run/<id>` risolvibile in ≤ 500 ms cache‑hit.
## v0.6.0 — "MCP Server Export"
### Messaggio di destinazione
*Anche Claude Code, Cursor e Codex possono guidare Oz via MCP — diventiamo l'integration layer Warp per tutto l'ecosistema.*
### Concorrenti superati
* `mercurial.warp-bridge` (3 installs) — fa guidare Warp via AppleScript, macOS only. Noi offriamo Oz-via-MCP cross-platform.
* `SemanticWorkbenchTeam.mcp-server-vscode` (20.499 installs), `jhamama.vscode-mcp-bridge-ext` (39 installs) — espongono VS Code, noi Oz.
* `LadislavSopko.mcpserverforvs` (1.620 installs) — stesso pattern per Visual Studio/Roslyn; confermata domanda di mercato.
### Deliverable
* Embedded **MCP server HTTP SSE** ascoltante su porta configurabile (default 3847):
    * Tool `oz_agent_run`, `oz_agent_run_cloud`, `oz_run_get`, `oz_run_list`, `oz_schedule_*` (stessi del v0.3 ma via MCP JSON-RPC).
    * Endpoint `/health`, `/sse`, `/messages`.
    * Bearer token opzionale configurabile in settings per ambienti condivisi.
* **Auto-registrazione** opt-in (prompt al primo avvio):
    * `~/.claude.json` per Claude Code.
    * `~/.cursor/mcp.json` per Cursor.
    * `~/.codex/config.toml` per Codex.
    * Undo del registration via comando `ozBridge.mcp.unregister`.
* Extension separata opzionale `warp-mcp-standalone` (package npm `warp-vsc-bridge-mcp`) per chi non usa VS Code ma vuole il bridge da riga di comando.
* Documentazione dedicata `docs/MCP.md` con esempi di integrazione per ciascun client.
### Metriche di successo
* MCP server esposto da estensione VS Code risponde a `tools/list` in ≤ 100 ms.
* Claude Code può chiamare `oz_agent_run_cloud` e ricevere l'output finale.
## v0.7.0 — "Team & Drive": Warp Drive browser, Skills & Rules UI
### Messaggio di destinazione
*La tua organizzazione Warp (Drive, Rules, Skills condivisi) è navigabile, editabile e applicabile dentro VS Code.*
### Concorrenti superati
* `AbelMak.skills-sh` (202 installs) — package manager skills multi-agent. Noi integriamo con lo skill system Warp nativo + gli stessi skill Oz del CLI.
* `Swarmify.swarm-ext` (211 installs) — team orchestration con MCP. Noi offriamo team config Warp-native via Drive.
### Deliverable
* Comando `ozBridge.drive.browse` con TreeView dedicato:
    * Listing dei Warp Drive prompts/rules/skills (via endpoint Oz CLI se disponibile, altrimenti parse `.warp/` e `.agents/skills/`).
    * Copia/incolla di un prompt Drive come contenuto di `/run` o `/cloud`.
* **Editor skill/rules** integrato Monaco:
    * Webview panel con Markdown live preview + frontmatter YAML validator.
    * Azioni: `Save as global skill` (`~/.agents/skills/<name>/SKILL.md`), `Save as project skill` (`.agents/skills/<name>/SKILL.md`), `Promote to Warp Drive`.
* `/init` v2: dialog quickpick per scegliere quali skill scaffoldare (non più tutti i 7), con preview del template.
* **Settings per-workspace** `.warp/warp-bridge.yaml` con override di profilo/environment/timeout a livello progetto, commitabile in Git.
### Metriche di successo
* Editor skill apre file `SKILL.md` con frontmatter in ≤ 300 ms.
* Settings per-workspace risolte prima di quelle globali (doc comprovante in CHANGELOG).
## v0.8.0 — "Observability": Cloud Run Analytics & Steering
### Messaggio di destinazione
*Metriche, costi, steering mid-run e dataset curation delle cloud agent run Warp — zero concorrenti.*
### Concorrenti superati
* `agentstats.agentstats` (114 installs) — tracker token/costi per Claude/Codex, noi aggiungiamo Oz cloud agent credits.
* `apoqgin.agent-snitch` (107 installs), `proliminal.agent-lens` (68 installs) — session graph per agent locali, noi anche per cloud agent + steering.
### Deliverable
* **Dashboard webview** `ozBridge.dashboard`:
    * Timeline 30 giorni con run count, durata media, success rate.
    * Breakdown credit consumption per environment / skill / model.
    * Top 10 prompts più lenti con link al detail.
    * Export CSV/JSON.
* **Steering mid-run**: dentro Cloud Run Monitor webview (v0.4), pulsante `Send follow-up` che invoca un'API Warp (se disponibile) o fallback a `oz agent continue <runId> --prompt <text>`.
* **Failure triage**: auto-analisi dell'output quando `status === 'FAILED'` — extract stack trace / error class / suggerisce fix con `vscode.lm.sendRequest()`.
* **Dataset export** da run history: seleziona N run → export come JSONL per eval/fine-tuning dataset.
### Metriche di successo
* Dashboard carica 100 run in ≤ 1 s.
* Steering invia prompt aggiuntivo a run in corso con latency ≤ 2 s.
## v0.9.0 — "Reach": Open VSX, Walkthroughs, l10n bundles
### Messaggio di destinazione
*Installabile ovunque giri VS Code-like (Cursor, VSCodium, Gitpod, Windsurf, Antigravity). Onboarding in 3 clic. 10 lingue.*
### Concorrenti superati
* `AbelMak.skills-sh`, `Swarmify.swarm-ext`, `s-hiraoku.vscode-sidebar-terminal` — tutti pubblicati Open VSX + Marketplace.
* Estensioni senza walkthrough perdono utenti al primo "cosa faccio ora".
### Deliverable
* Pubblicazione contestuale su:
    * VS Code Marketplace (publisher `sena-labs`, PAT Azure DevOps).
    * Open VSX (publisher `sena-labs`, token ovsx).
* `contributes.walkthroughs` con 4 step:
    1. Install Warp + `oz login`.
    2. Configure `ozBridge.defaultEnvironment`.
    3. Run `@oz /run hello`.
    4. Try Agent mode tools (v0.3).
* GIF animate nel README per ogni feature major (Sidebar, Cloud Run Monitor, Dashboard, Chat Variables).
* **`vscode.l10n` bundle** per 10 locale (en, it, es, fr, de, pt, ja, zh, ko, ru) — questa volta via l'API ufficiale VS Code invece di custom i18n service (delta minimo rispetto a v0.2.0).
* `CONTRIBUTING.md` completo + Release Notes automation via `semantic-release`.
* **GitHub Actions** CI matrix Node 20/22 su ubuntu + windows + macOS; job separato `release.yml` che pubblica su entrambi i registry al tag `v*.*.*`.
### Metriche di successo
* Install-to-first-successful-run rate ≥ 60 % via funnel walkthrough.
* Bundle VSIX resta sotto 80 KB nonostante l10n.
## v1.0.0 — "GA": Telemetria opt-in, Security, Performance
### Messaggio di destinazione
*Enterprise-ready. Telemetria rispettosa della privacy, security audit completo, performance budget garantiti.*
### Concorrenti superati
* `agentstats.agentstats`, `Agent Stats`, `s-hiraoku.vscode-sidebar-terminal` — hanno telemetria ma spesso invasiva. Noi seguiamo rigorosamente `telemetry.telemetryLevel`.
### Deliverable
* **Telemetria opt-in** con rispetto di `vscode.env.isTelemetryEnabled`:
    * Eventi: `extensionActivated`, `commandInvoked{command}`, `runStarted{kind:'local'|'cloud'}`, `runCompleted{status,durationMs}`, `errorRaised{kind}`.
    * MAI: prompt content, run ID, output, file path, workspace path.
    * Endpoint collector self-hosted (Azure Application Insights o auto-hosted ClickHouse) sotto controllo Sena Labs.
    * Privacy policy esposta in `PRIVACY.md` + linkata dal walkthrough.
* **Security audit** esterno (contract) + scansione CodeQL su ogni PR.
* **Performance budget enforcement** in CI:
    * Activation ≤ 200 ms (benchmark con `performance.now()`).
    * Sidebar first-paint ≤ 300 ms.
    * Bundle ≤ 100 KB.
    * Memory steady-state ≤ 50 MB.
* **Error telemetry** con stack trace anonimizzati per debug production.
* **Kill switch** via feature flag remoto (Azure App Configuration o simili) per disabilitare feature buggy senza rilasciare nuova versione.
* **Accessibility compliance**: screen reader, keyboard navigation, high-contrast themes, ARIA labels su tutte le webview (WCAG 2.1 AA).
* **LTS commitment**: v1.0 supportata 12 mesi con patch security; nuove feature vanno su v1.x minor.
### Metriche di successo
* Marketplace badge ≥ 4.5/5 con almeno 50 review.
* Zero issue aperte con label `security` al momento del tag `v1.0.0`.
* DAU (daily active users) misurato via telemetria opt-in ≥ 500 entro 90 giorni dal rilascio.
## Cosa NON c'è in roadmap (decisioni consapevoli)
* **UI grafica tipo Warp Terminal dentro VS Code**: impraticabile (vedi issue warpdotdev/Warp#257), fuori scope.
* **Supporto Slack/Linear integrations dirette**: esistono via cloud agent triggers Oz, non serve UI dedicata VS Code.
* **Agent marketplace proprio**: duplicherebbe `skills.sh`; ci integriamo con loro invece.
* **Provider LLM alternativi (Ollama local, ecc.)**: Oz CLI lo gestisce internamente, non serve UI VS Code.
* **Terminal UI alternativa tipo vmux / Agent Grid**: fuori scope, competerebbe con estensioni consolidate senza vero differenziale.
## Timeline indicativa
* v0.3.0 — 3 settimane (LM Tools + test)
* v0.4.0 — 5 settimane (Sidebar + Status bar + Webview Monitor è il pezzo più grande)
* v0.5.0 — 2 settimane (variabili chat + handoff)
* v0.6.0 — 4 settimane (MCP server + auto-registration)
* v0.7.0 — 3 settimane (Drive browser + skill editor)
* v0.8.0 — 4 settimane (dashboard + steering + triage)
* v0.9.0 — 2 settimane (publish + walkthrough + l10n)
* v1.0.0 — 3 settimane (telemetry + security + performance)
Totale: ~26 settimane (6 mesi) di sviluppo sequenziale per raggiungere v1.0 GA, assumendo 1 dev full-time. Parallelizzabile se team.
## Dipendenze tra milestone
* v0.4 (Sidebar) consuma eventi aggiunti dal `RunPoller` refactor (nessuno blocca).
* v0.6 (MCP export) riusa gli stessi handler registrati nel v0.3 (LM Tools) — v0.3 deve arrivare prima.
* v0.8 (Dashboard) consuma dati dal `RunPoller` + sidebar del v0.4.
* v1.0 (telemetry) deve arrivare dopo tutte le feature per coprirne gli eventi.
## Decisioni prese (2026-04-20)
* **Publisher Marketplace**: `sena-labs` da creare subito su VS Code Marketplace e Open VSX. Procedura documentata in `docs/PUBLISHING.md`, workflow CI `.github/workflows/publish.yml` predisposto per publish automatico al tag `v*.*.*`.
* **Endpoint collector telemetria (v1.0)**: Azure Application Insights nel workspace Sena Labs. SDK: `@vscode/extension-telemetry` (ufficiale Microsoft, rispetta nativamente `telemetry.telemetryLevel`). Migrabile a ClickHouse/PostHog via `ITelemetryReporter` thin wrapper senza breaking change.
* **Budget bundle per l10n**: accettato **+15–25 KB** per 10 locale via `vscode.l10n` bundle ufficiale. Nuovo bundle budget effettivo: 125 KB (da 100 KB baseline).
* **Cloud Run Steering (v0.8)**: **progressive fallback** con astrazione `IRunSteerer`.
    * Primario: `oz agent run --continue <runId> --prompt "<text>"` se/quando Warp esporrà il flag.
    * Fallback disponibile subito: `oz agent run-cloud --prompt "[CONTINUING <runId>] <text>"` con contesto in-lined.
    * Migrabile a API REST Warp dedicata quando pubblicata, senza breaking change lato codice.
