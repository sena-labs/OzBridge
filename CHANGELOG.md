# Changelog

All notable changes to **Warp Bridge for VS Code** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
_No changes yet._
## [0.5.0] — 2026-04-20
First public release cycle under the `sena-labs` publisher. Combines the
work originally scoped across the v0.3 / v0.4 / v0.5 milestones into a
single ship.
### Added
#### Agent-Native integration (originally v0.3)
- Four **Language Model Tools** registered via `vscode.lm.registerTool`, so GitHub Copilot **Agent mode** can invoke Warp Oz directly without typing `@warp`:
  - `warp_run_local` (`#warpRunLocal`) — runs an Oz agent locally with IDE context injection.
  - `warp_run_cloud` (`#warpRunCloud`) — launches a cloud Oz agent with a credit-consumption confirmation dialog; polls to terminal state unless `wait: false` is passed.
  - `warp_get_run` (`#warpGetRun`) — fetches status/output of a run by id (read-only).
  - `warp_list_runs` (`#warpListRuns`) — lists recent runs with `all` / `active` / `completed` / raw `OzRunStatus` filters and an optional `limit`.
- Each tool declares a strict JSON `inputSchema`, `modelDescription`, `userDescription`, `tags`, `canBeReferencedInPrompt: true` and `toolReferenceName` under `contributes.languageModelTools` in `package.json`.
- Graceful fallback in `activate()` when running on a VS Code build that does not expose `vscode.lm.registerTool`: the `@warp` Chat Participant keeps working, only the LM tools are skipped.
- 39 new unit tests under `test/tools/` covering each tool's `prepareInvocation`, happy paths, missing-input validation, CLI-unavailable fallback, error hints (`NOT_FOUND`, `NOT_AUTHENTICATED`, `TIMEOUT`), polling and filter semantics.
#### UI Surfaces (originally v0.4)
- Dedicated **Activity Bar view** `warpBridge.runsView` with five categories (`ActiveRuns`, `History`, `Schedules`, `Environments`, `MCP Servers`). Each category renders live data from the Oz CLI via the new `ActiveRunsTracker` (Active Runs / History) or direct CLI calls (Schedules / Environments / MCP).
- **Status Bar indicator** `$(cloud) Warp: N active` (right-aligned, priority 100) that colour-codes the active-run count (default / `warningBackground` for 1–2 / `errorBackground` for 3+) and falls back to `$(cloud-outline) Warp: unavailable` when the tracker fires an error. Clicking focuses the Warp Bridge sidebar.
- Context-menu commands on tree nodes: `warpBridge.tree.refresh`, `.copyId`, `.openInBrowser` (run nodes → `app.warp.dev/agents/<id>`), `.pauseSchedule`, `.unpauseSchedule`, `.deleteSchedule` (with modal confirmation), plus `.showRun` to pre-fill `@warp /status <runId>` in Copilot chat.
- `contributes.viewsContainers`, `contributes.views`, `contributes.commands`, `contributes.menus` entries in `package.json` wiring the sidebar and its context menus.
- New service `ActiveRunsTracker` (10 s default cadence) with `onDidChange` / `onDidError` events, consumed by both the status bar and the tree provider.
- 32 new unit tests across `test/services/activeRunsTracker.test.ts` and `test/ui/*` covering the tracker lifecycle (start/stop/dispose/idempotency), status bar rendering & colour thresholds, tree categories and every context-menu command.
#### Context & Handoff (v0.5)
- **Prompt-variable expander** (`src/participant/promptExpander.ts`) resolves `#warp.env`, `#warp.profile`, `#warp.model`, `#oz.history` and `#oz.run/<id>` before the prompt is sent to the Oz CLI. Tokens not recognised are passed through unchanged; CLI failures during resolution are inlined as `_error resolving <token>: <msg>_` so the user's intent is never dropped. Each unique token is resolved at most once per expansion.
- Integrated `expandPromptVariables` into the `/run` and `/cloud` command handlers. When at least one token is substituted the chat stream emits `_Expanded N prompt variables_` before the run starts.
- Commands `warpBridge.handoff` (Command Palette) and `warpBridge.tree.handoff` (sidebar context menu on run nodes) open a real Warp terminal via the `warp://action/new_tab?path=…&command=…` URI scheme. POSIX-safe shell quoting for all embedded strings (`"`, `\`, `$`, `` ` ``). Graceful fallback modal with a Copy button when the URL scheme isn't registered on the platform.
- 28 new unit tests: `test/ui/handoff.test.ts` (15) and `test/participant/promptExpander.test.ts` (13) covering URI building, shell quoting, the palette/tree command flows, fallback modal, static token resolution, dynamic history/run tokens, empty-list fallback, output truncation, CLI error handling and token deduplication.
#### Test infrastructure
- `vscode` mock extended with: `lm`, `MarkdownString`, `LanguageModelTextPart`, `LanguageModelToolResult`, `StatusBarAlignment`, `StatusBarItem`, `ThemeColor`, `ThemeIcon`, `TreeItem`, `TreeItemCollapsibleState`, `window.createStatusBarItem`, `window.registerTreeDataProvider`, `window.createTreeView`, `window.showInputBox`, `env.clipboard`, and a functional `commands.executeCommand` that dispatches to registered handlers.
#### Publishing infrastructure
- `docs/PUBLISHING.md` documents the publisher setup (VS Code Marketplace + Open VSX), token management, and manual / CI publishing flows.
- `.github/workflows/publish.yml` publishes the VSIX to both registries on every tag matching `v*.*.*`.
- `scripts/publish.ps1` and `scripts/publish.sh` cover manual publishing on Windows and Unix shells.
### Changed
- `RunCloudTool` normalises an empty `warpBridge.defaultEnvironment` to `undefined` before calling the CLI, so a misconfigured default cannot yield a bogus `--environment ''` argument.
- `.vscodeignore` excludes `scripts/**` from VSIX packaging (publishing helpers are not shipped to end-users).
### Fixed
- Tree view `when`-clauses now use `viewItem =~ /^warp(Run|Schedule|Environment|Mcp)/` so generic commands (copy id, open in browser) only appear on the right node kinds.
### Compatibility
- Requires **VS Code ≥ 1.96.0** (stable Chat Participant API). Language Model Tools additionally require `vscode.lm.registerTool` which ships with VS Code 1.96+; older hosts degrade gracefully to Chat Participant only.
- Runs on macOS, Linux and Windows. Warp handoff requires Warp ≥ 0.2024.x (or a shell fallback via the Copy-command modal).
### Metrics
- 41 test files, **660** unit tests, all green.
- `dist/extension.js` bundled at **≈ 50 KB** (esbuild, minified, `vscode` external).
## [0.2.0] — 2026-04-19

### Added

- **`/history` slash command** — lists completed runs (SUCCEEDED / FAILED) with optional filter (`succeeded`, `failed`, `all`) and run-ID detail lookup
- `bugs.url` and `homepage` fields in `package.json`

### Changed

- **Differentiated `/status` vs `/history`**:
  - `/status` now focuses on **active** runs only (`QUEUED` / `INPROGRESS`) and points to `/history` when none are active
  - `/history` focuses on **completed** runs and accepts a status filter
- `DEFAULT_CONFIG.maxOutputChars` aligned to `15000` to match `package.json` declared default (was `5000` in code only)
- `publisher` updated to `sena-labs` and `repository.url` to `https://github.com/sena-labs/warp-vsc-bridge`
- `dependencies.copilot-chat-toolkit` pinned to the bundled workspace package via `file:./packages/copilot-chat-toolkit`
- `package.json` bumped to `0.2.0`

### Removed

- **DevForge plugin-system infrastructure** (`src/core/`, `test/core/`): `HierarchicalRouter`, `PluginRegistry`, `AggregatedFollowupProvider`, `/plugins` / `/help` / `/config` core handlers and 10 locale catalogs. None of this code was wired into the live `@warp` Chat Participant and it carried dead-code risk for the release.
- **i18n subsystem** (`I18nService`, `MessageCatalog`, `LocaleBundle` and `src/core/locales/`): the extension is now shipped in English only with hard-coded strings, simplifying maintenance. The toolkit (`copilot-chat-toolkit`) no longer exports i18n symbols or `IPlugin`/`PluginContext` plugin types.
- `docs/ARCHITECTURE-DEVFORGE.md`, `docs/SPEC-DEVFORGE.md`, `docs/IMPLEMENTATION-PLAN.md`, `docs/BRIEFING-IMPLEMENT-AGENT.md` — stale design documents no longer relevant to the shipped product.
- Stale VSIX artifacts checked into the working tree (`*.vsix` already in `.gitignore`; release VSIX is now a build artifact, not a commit).

### Fixed

- JSDoc typo `per-commandC` → `per-command` in `OzCliService`
- Stale `decisione Q3 = 5000` comment in `OutputFormatter.truncate()`

### Notes on publishing

- First publish to the VS Code Marketplace requires creating the `sena-labs` publisher (`vsce create-publisher sena-labs`) and an Azure DevOps Personal Access Token with Marketplace “Manage” scope. See [publishing docs](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

## [0.1.1-unreleased] — superseded by 0.2.0

### Added

- `CONTRIBUTING.md` with development setup, coding standards, and PR guidelines
- `CODE_OF_CONDUCT.md` (Contributor Covenant v2.0)
- `SECURITY.md` with vulnerability reporting policy and security practices
- GitHub Issue Templates (Bug Report, Feature Request)
- Pull Request template with checklist
- `CODEOWNERS` and `FUNDING.yml` for repository governance
- Comprehensive JSDoc on all exported functions, classes, and interfaces
- Shared `skillDetector.ts` module used by both `/run` and `/cloud` commands

### Changed

- Refactored skill detection logic from inline duplicated code to shared `detectSkill()` utility
- `OutputFormatter` refactored to lazy-load config via `IConfigManager` instead of snapshot
- Logger now writes to both `OutputChannel` and developer console for all log levels
- Logger buffers pre-`initLogger()` messages and flushes them on initialization
- `.vscodeignore` updated to exclude `.github/**`, `test/**`, and `vitest.config.ts` from VSIX

### Fixed

- `OzCliService.exec()` double-reject race condition — added `settled` flag guard
- `/cloud` command now performs skill detection (was missing, unlike `/run`)
- Test helpers use `as unknown as IOzCliService` instead of `as any` for type safety
- `parseOrThrow()` error messages now include first 200 chars of raw output for debugging

## [0.1.0] — 2026-02-25

### Added

- **Chat Participant**: `@warp` Chat Participant for VS Code Copilot Chat, fully registered via the stable `vscode.chat` API
- **Slash Commands**:
  - `/run` — execute a local Warp Oz agent in the current workspace with IDE context injection
  - `/cloud` — start a cloud agent run with interactive credit confirmation and async polling
  - `/status` — display run list or single run detail by ID
  - `/schedule` — manage Warp cron jobs (create, list, pause, unpause, delete) with regex validation
  - `/models` — list available AI models in the Oz platform
  - `/mcp` — list configured MCP servers
  - `/config` — show active Warp Bridge configuration, Oz CLI status, profiles, environments, and integrations
  - `/init` — scaffold `.agents/skills/<skill>/SKILL.md` (7 files) and `.warp/rules/PROJECT.md`
- **Oz CLI Integration**: `OzCliService` wraps `child_process.spawn` with `--output-format json`, per-command timeout, VS Code `CancellationToken` support, and input sanitization (`sanitizeId()`)
- **Context Injection**: `ContextCollector` gathers workspace path, active file, selection (capped at 2000 chars), and diagnostics; formats as `[CONTEXT]...[/CONTEXT]` block
- **Agent Skill Detection**: Automatic skill mapping from prompt keywords to 7 agent skills via `AGENT_SKILL_MAP`
- **Cloud Polling**: `RunPoller` implements exponential backoff (5s → 30s, ×1.5 factor) with 30-minute timeout and `AbortController` integration
- **JSON Parsing**: 5-level robust parser (`parse<T>`, `parseOrThrow<T>`) handles plain text, direct JSON, multi-line JSON blocks, and single-line JSON extraction
- **Output Formatting**: `OutputFormatter` renders Markdown with truncation (configurable `maxOutputChars`), action buttons, and error-specific guidance (install, login, syntax)
- **Configuration**: `ConfigManager` wraps `vscode.workspace.getConfiguration('warpBridge')` with in-memory cache, `onConfigChanged` event, and 8 configurable settings
- **Contextual Follow-ups**: `FollowupProvider` suggests relevant next commands based on the command just executed
- **Logging**: Centralized `logger.ts` with `initLogger()`, `logInfo()`, `logWarn()`, `logError()` — all write to `OutputChannel` and developer console
- **Test Suite**: 256 tests across 17 files (1.5:1 test-to-code ratio), using Vitest with interface-based mocks
- **CI/CD**: GitHub Actions workflow with Node.js 18/20/22 matrix — type-check, test, and build on every push/PR
- **Build**: esbuild CJS bundle with tree-shaking, external `vscode`, minified output in `dist/extension.js`

## [0.0.2] — 2026-02-20

### Added

- Cloud-run polling implementation (`RunPoller`) with exponential backoff
- Agent skill auto-detection from prompt keywords (`AGENT_SKILL_MAP`)
- `/cloud` slash command with credit warning confirmation dialog
- `/schedule` command with 5 sub-commands and cron expression validation
- `ContextCollector` with selection + diagnostics gathering

### Fixed

- JSON parser now handles multi-line JSON blocks spanning multiple lines
- `OzCliService.exec()` properly rejects on spawn error events

## [0.0.1] — 2026-02-15

### Added

- Initial project scaffolding with TypeScript strict mode and esbuild
- `@warp` Chat Participant registration via `vscode.chat` API
- `/run` slash command for local agent execution
- `/status`, `/models`, `/mcp`, `/config` read-only commands
- `OzCliService` wrapping `child_process.spawn` with JSON output parsing
- 5-level robust JSON parser (`parse<T>`, `parseOrThrow<T>`)
- `OutputFormatter` with Markdown rendering and truncation
- `ConfigManager` with caching and `onConfigChanged` event
- Vitest test suite with vscode module mock
