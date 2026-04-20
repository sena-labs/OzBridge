# Changelog

All notable changes to **Warp Bridge for VS Code** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] — 2026-04-21

### Fixed
- **Out-of-credits detection.** When a Warp account has no credits
  left, the Oz CLI used to hang waiting for a backend response that
  never arrived, and the extension surfaced only a generic
  `⏰ Timeout. Operation exceeded the 300s limit.` after five minutes.
  The error pipeline now classifies stderr/stdout containing credit /
  quota / billing keywords (and HTTP 402/429 exit codes) as a new
  `INSUFFICIENT_CREDITS` error kind, surfaced in chat with an
  actionable “Open Warp billing” button instead of the timeout. The
  `TIMEOUT` message itself was also rewritten to call out
  out-of-credits as the most common cause when the CLI hangs without
  output. (`@warp /run` regression spotted in v1.0.0 GA.)

### Added
- New `OzCliErrorKind.INSUFFICIENT_CREDITS` enum value (re-exported
  from `copilot-chat-toolkit`).
- `isInsufficientCreditsError(stderr, exitCode)` helper exported from
  `src/services/ozCliService.ts` for unit testing and reuse.
- 18 unit tests covering the keyword detector, exit-code 402/429
  reclassification, and the end-to-end `agentRun` path.
- **Idle-timeout fail-fast.** New `OzCliErrorKind.STALLED` kind +
  `warpBridge.idleTimeoutMs` setting (default `90000` ms, also
  overridable per-workspace via `.warp/config.yaml`). When the Oz CLI
  produces no stdout/stderr for the configured window, the process is
  terminated and the error is raised immediately instead of waiting
  for the global `timeoutMs`. If the captured output matches the
  credit-keyword heuristic the error is reclassified as
  `INSUFFICIENT_CREDITS`; otherwise it surfaces as `STALLED` with an
  actionable hint. Set `idleTimeoutMs` to `0` to disable. Covered by
  4 new unit tests in `test/services/ozCliServiceIdleTimeout.test.ts`.

### Docs
- Updated `docs/DESIGN.md` `OzCliErrorKind` enum sample (now lists all
  8 kinds including `INSUFFICIENT_CREDITS` and `STALLED`).
- Fixed obsolete `5000 char` truncation note in `docs/DESIGN.md` risk
  matrix (actual cap is `15000`).
- Removed an accidental duplicated copy of `CONTRIBUTING.md` that
  appended an older generic guide after the canonical playbook.

## [1.0.0] — 2026-04-20
"GA" milestone. Promotes deliverables **P · Q · R · S · T** to the
v1.0.0 stable line: opt-in telemetry pipeline (doubly gated by
`vscode.env.isTelemetryEnabled` AND a configured connection string,
with a hard-coded deny-list that makes prompt content / run IDs /
output / paths / workspace paths untransmittable), supply-chain
security gates (CodeQL `security-extended`, npm audit blocking on
high/critical, full-history gitleaks, Dependabot on three ecosystems),
activation performance budget enforced in CI (p50 ≤ 800 ms, p95 ≤
1500 ms in the harness — ~5× faster on a real editor), WCAG 2.1 AA
accessibility pass on every UI surface (tree views + status bar +
walkthrough images, locked in by an invariant test), and an operator
kill-switch + formal 18-month LTS policy with `release/v<major>.<minor>.x`
maintenance branches. Bundle 104.46 KB / 125 KB; **1089 / 1089 tests
green**; **0 production CVEs**. Full deliverable list in
`docs/MILESTONE-v1.0.md`; release notes in
`docs/RELEASE-NOTES-v1.0.0.md`.

### Added
- **WCAG 2.1 AA accessibility pass (v1.0 deliverable S).** Every
  `TreeItem` produced by `WarpRunsTreeProvider` and
  `WarpDriveTreeProvider` now carries an explicit
  `accessibilityInformation` (label + `treeitem` role) so screen
  readers announce a meaningful semantic value instead of the raw
  display string (e.g. `"Run my-prompt, status INPROGRESS, active"`
  rather than `"my-prompt"`). Categories that previously lacked a
  hover tooltip now declare one. The status bar item exposes a
  plain-language label in both steady and error states (codicon
  glyphs like `$(cloud)` are not narrated by AT) with role
  `'button'` to match its click-to-focus behaviour. New
  `test/accessibility.test.ts` (13 tests) hard-blocks regressions:
  every node kind across both providers must carry a non-empty
  a11y label, walkthrough markdown files must declare alt text on
  every embedded image and contain at least one heading for the
  document outline. Pure-metadata change — zero runtime cost.
- **Kill-switch + LTS policy (v1.0 deliverable T).** Two new
  `machine-overridable` settings ship the operator escape hatch:
  `warpBridge.killSwitch.enabled` (boolean, default `false`) and
  `warpBridge.killSwitch.reason` (string, default `""`). When the
  switch is on, `activate()` short-circuits before any wiring step
  (no commands, tools, MCP server, chat participant or trees are
  registered) and surfaces a single warning notification including
  the optional reason text. The extension stays installed; flipping
  the boolean back to `false` re-enables it for new windows without
  a reload. `SECURITY.md` now documents the kill-switch playbook
  and a formal LTS policy table (18-month active LTS, 6-month
  critical-only window, `release/v<major>.<minor>.x` maintenance
  branches, 14-day patch cadence for confirmed vulnerabilities,
  one-minor-release deprecation notice). 6 new tests in
  `test/killSwitchLts.test.ts` cover both activation paths
  (short-circuit vs full wiring), the package.json contributions and
  the SECURITY.md doc invariants.
- **Activation performance budget (v1.0 deliverable R).** New
  `test/activationPerf.test.ts` measures `activate()` over 25
  iterations on a fresh state (warm-up excluded), prints a
  `[perf] activate()` summary line and asserts both p50 and p95
  against the published budget (`BUDGETS.p50Ms = 800`,
  `BUDGETS.p95Ms = 1500`). The envelope is calibrated for the
  vitest harness with the mocked `vscode` host — real editor
  activation is ~5× faster — so the gate trips on a 2× regression of
  the synchronous path. New CI workflow
  `.github/workflows/perf.yml` (`activation-budget` job) runs the
  perf suite in isolation on every PR + main push, with a 60 s test
  timeout and concurrency cancellation.
- **Security gates (v1.0 deliverable Q).** New CI workflows
  `.github/workflows/codeql.yml` (CodeQL `security-extended` +
  `security-and-quality` query suites for JavaScript/TypeScript, weekly
  Monday cron, results published to the Security tab) and
  `.github/workflows/security.yml` (two jobs: `npm audit
  --omit=dev --audit-level=high` blocks PRs on high/critical CVEs in
  the production closure; `gitleaks` scans full git history for
  committed credentials). New `.github/dependabot.yml` watches root
  npm, the `packages/copilot-chat-toolkit` workspace and GitHub
  Actions on a weekly cadence with grouped updates and reviewer
  auto-assignment. `SECURITY.md` rewritten with the v0.9 LTS support
  matrix, a documented opt-out path linking to `PRIVACY.md`, and a
  dedicated "Automated Security Gates" section enumerating the new
  CI invariants. 15 new tests in `test/securityGates.test.ts` parse
  the actual workflow / dependabot YAMLs and `SECURITY.md` to assert
  the gates remain wired (CodeQL languages + suites + permissions,
  npm-audit flags, gitleaks job + full-history checkout, weekly
  cadence on every ecosystem, supported-versions table refresh).
- **Telemetry opt-in pipeline (v1.0 deliverable P).** New
  `src/services/telemetry.ts` ships an `ITelemetryReporter` contract
  with two implementations: a default `NoopReporter` (zero network
  code path) and an `HttpAppInsightsReporter` that batches events to
  the AppInsights ingestion endpoint via the host's global `fetch`
  (no new runtime dependency). The reporter is **doubly gated**:
  active only when **both** `vscode.env.isTelemetryEnabled === true`
  **and** the new setting `warpBridge.telemetry.connectionString`
  carries a valid `InstrumentationKey=...;IngestionEndpoint=...`
  string; either gate closed ⇒ noop. A hard-coded deny-list
  (`prompt|content|output|path|workspace|runid|message|stack|email|user|token`)
  is enforced both at the type level (closed `TelemetryEventMap`) and
  at runtime, so prompt content, run IDs, output, file paths and
  workspace paths can never be transmitted. The activation flow now
  emits a single `extensionActivated { version }` event; availability
  failures emit `errorRaised { kind: 'availabilityCheck' }`. The
  privacy contract is documented in the new `PRIVACY.md` at the repo
  root and linked from the Get-Started walkthrough's MCP step. 18
  new tests in `test/services/telemetry.test.ts` cover the deny-list
  invariant, both opt-in gates, the malformed-connection-string
  fallback, the AppInsights envelope shape, transport-failure
  resilience and the dispose-flushes-pending-batch contract.
  `test/mocks/vscode.ts` now exposes `env.isTelemetryEnabled` (false
  by default in tests) so suites can exercise both code paths.

### Changed
- **v1.0 bootstrap.** Documented the "GA" milestone (deliverables
  P–T: telemetry opt-in, security gates, performance budgets,
  accessibility, kill-switch + LTS) in `docs/MILESTONE-v1.0.md` and
  `docs/NEXT-STEPS-v1.0.md`. 8 new tests
  (`test/milestoneV1Bootstrap.test.ts`) guard the planning invariants
  (deliverable list, telemetry deny-list, performance budgets,
  release-ceremony playbook).

## [0.9.0] — 2026-04-20
"Reach" milestone. Ships the official `vscode.l10n` localization
pipeline (en/it/es), a four-step Get-Started walkthrough, dual-registry
publishing (Marketplace + Open VSX) with soft-fail on missing secrets,
a 2 × 3 cross-platform CI matrix (Node `20.19` / `22.12` × ubuntu /
windows / macos) plus a dedicated 125 KB bundle-budget workflow, and
a contributor-docs rewrite around the deliverable-PR playbook.
Delivers the full v0.9 scope (deliverables K–O) defined in
`docs/MILESTONE-v0.9.md`.
### Changed
- **Contributor docs rewrite (`v0.9` deliverable O).** Rewrote
  `CONTRIBUTING.md` around the **deliverable-PR playbook** used by the
  maintainers: branch naming, Conventional Commits squash title, the
  three-section PR body template (**What / Verification / Next**),
  `gh pr merge --squash --delete-branch --auto` flow, the 2 × 3 CI
  matrix baseline (Node `20.19` / `22.12`), the 125 KB bundle budget,
  and the l10n bundle layout. 8 new tests
  (`test/contributingDocs.test.ts`) guard these invariants so the doc
  cannot silently drift from the pipeline.

### Added
- **CI matrix + bundle budget (`v0.9` deliverable N).** Rewrote
  `.github/workflows/ci.yml` as a 2 × 3 matrix (Node **20.19** / **22.12**
  × **ubuntu-latest** / **windows-latest** / **macos-latest**) with
  `fail-fast: false` and cancel-in-progress concurrency, so a single
  flaky platform no longer aborts the entire run. Added
  `.github/workflows/bundle-budget.yml` that fails the PR whenever
  `dist/extension.js` exceeds **125 KB** and renders a size summary in
  the GitHub job summary. 9 new tests
  (`test/ciMatrix.test.ts`) assert the matrix shape, concurrency
  policy, test invocation and budget enforcement.
- **Open VSX publishing & release pipeline (`v0.9` deliverable M).**
  Refactored `.github/workflows/publish.yml` into four stages with a
  shared VSIX artifact:
  1. `build` — install, type-check, test, package.
  2. `publish-marketplace` — `@vscode/vsce publish` using `VSCE_PAT`.
  3. `publish-openvsx` — `ovsx publish` using `OVSX_PAT`.
  4. `github-release` — attaches the VSIX to the tagged release.
  Each publish job soft-fails when the corresponding secret is missing
  (`::warning::`), so partial registry access never blocks the release.
  README gains install snippets and direct links for both registries;
  7 new tests (`test/publishingReadiness.test.ts`) guard manifest
  fields, icon existence, workflow job graph, secret wiring and README
  copy.
- **Get-Started walkthrough (`v0.9` deliverable L).** Contributes a
  four-step `warpBridge.gettingStarted` walkthrough (install Warp CLI,
  run `@warp`, explore the Warp views, enable the MCP bridge) under
  `media/walkthrough/*.md`. The walkthrough opens automatically on the
  first activation, gated by the `warpBridge.walkthrough.shown` key in
  `context.globalState`; users can re-open it anytime from
  **Help → Get Started**. Titles/descriptions are fully localised via
  `package.nls{,.it,.es}.json`. 12 new tests
  (`test/ui/walkthroughGating.test.ts`,
  `test/ui/walkthroughManifest.test.ts`) assert gating behaviour, step
  ids, completion events, markdown asset existence and sanitisation.
- **Localization pipeline (`v0.9` deliverable K).** Wired the official
  `vscode.l10n` API end-to-end:
  - `l10n/bundle.l10n{,.it,.es}.json` — 51 runtime message keys (English
    source as identity map, Italian, Spanish).
  - `package.nls{,.it,.es}.json` — 32 manifest keys (display name,
    description, command palette categories and titles).
  - `package.json` declares `"l10n": "./l10n"` and references commands
    via `%key%` placeholders.
  - All 43 `vscode.window.show*Message` call sites across nine source
    files now go through `vscode.l10n.t(...)` with positional `{N}`
    placeholders.
  - 15 new tests (`test/l10n/bundleConsistency.test.ts`,
    `test/l10n/manifestConsistency.test.ts`) validate key parity,
    placeholder counts, manifest references, and bundle declaration.
  - Bundle: **99.58 KB** (well under the 125 KB budget).
### Changed
- **v0.9 bootstrap.** Documented the "Reach" milestone (deliverables
  K–O) in `docs/MILESTONE-v0.9.md` and `docs/NEXT-STEPS-v0.9.md`.
- **Bundle budget raised to 125 KB.** v0.8 burned 99 % of the previous
  100 KB cap; the v0.9 l10n bundle migration needs the headroom. Per-PR
  size reporting remains mandatory.

## [0.8.0] — 2026-04-20
"Observability" milestone. Adds run steering, statistics aggregation, a
dashboard webview, AI-assisted failure triage, and dataset export.
Delivers the full v0.8 scope (deliverables F–J) defined in
`docs/MILESTONE-v0.8.md`.
### Added
- **Run dataset export (`v0.8` deliverable J, stretch).** New
  `DatasetExportService` + `warpBridge.exportDataset` command (`Warp:
  Export Run Dataset…`) that serialises terminal runs to **JSON
  Lines** or **RFC 4180 CSV**:
  - Pure helpers `csvQuote` (correct quoting of comma/quote/newline),
    `toCsv`, `toJsonl`, `truncateOutput` (line-boundary aware).
  - `terminalOnly` filter on by default; configurable `limit` (default
    200) and `maxOutputChars` (default 4 KB) caps keep the export
    bounded.
  - QuickPick prompt for format selection; result rendered as a
    non-preview text document tagged with the right language id.
  - 16 new tests (`test/services/datasetExport.test.ts`).
- **Failure triage (`v0.8` deliverable I).** New
  `FailureTriageService` + `warpBridge.triageFailure` command (`Warp:
  Triage Failed Run…`):
  - Pure helpers `extractStackFrames` (Node, Python, generic
    file:line:col), `tailLines` (line-boundary aware), `buildTriagePrompt`,
    `parseTriageResponse` (`SUMMARY:` / `ACTIONS:` protocol, ≤3
    bullets, tolerant of missing markers).
  - Pluggable `ILanguageModelClient` abstraction; default adapter wires
    `vscode.lm.selectChatModels({ vendor: 'copilot' })` with graceful
    fallback when the host lacks the language-model API.
  - Output cap (4 KB tail) + cancellation-token honoured before model
    request to keep cost predictable.
  - Result rendered as a markdown preview tab (run id, summary,
    actionable bullet list).
  - 21 new tests (`test/services/failureTriage.test.ts`).
- **Observability dashboard (`v0.8` deliverable H).** New webview panel
  surfaced via the `warpBridge.dashboard.open` command (`Warp: Open
  Dashboard`):
  - Default 14-day window, summary cards (total runs, success rate),
    inline SVG sparkline, and per-day breakdown table.
  - Strict CSP (`default-src 'none'`) with per-render nonce; refresh
    button posts a message that invalidates the `RunStatsService`
    cache and recomputes.
  - Singleton panel (`createOrShow` reveals the existing tab); error
    page rendered when `computeSummary()` fails.
  - 20 new tests (`test/ui/dashboardPanel.test.ts`); the shared
    `vscode` mock now supports `createWebviewPanel` and `ViewColumn`.
- **Run statistics aggregator (`v0.8` deliverable G).** New
  `RunStatsService` + pure helpers (`bucketByDate`, `successRate`,
  `extractCreatedAt`, `formatLocalDate`, `isTerminalStatus`) that
  produce a dashboard-ready `RunStatsSummary` from `runList()` +
  `runGet()` payloads:
  - In-memory cache keyed by `runId` for **terminal** runs only;
    non-terminal runs are always re-fetched so status transitions are
    picked up on the next `computeSummary()` call.
  - Public `invalidate(runId?)` for explicit cache busting.
  - Local-time bucketing with TZ-safe day boundaries; pre-seeded zero
    buckets for the full window so missing days render as gaps in the
    upcoming dashboard.
  - 27 new tests (`test/services/runStats.test.ts`).
- **Run steering abstraction (`v0.8` deliverable F).** New
  `IRunSteerer` contract + `ProgressiveRunSteerer` implementation with
  the documented progressive fallback (decision log 2026-04-20):
  primary path uses `oz agent run --continue <runId> --prompt <text>`
  when the CLI exposes the flag, otherwise inlines the run id into a
  fresh `oz agent run-cloud` prompt. Capability probe via
  `oz agent run --help` is cached per-instance.
  - New `OzCliService.agentContinue()` and `helpAgentRun()`.
  - New module `src/services/runSteerer.ts` with exported
    `hasContinueFlag()` helper for unit tests.
  - `IOzCliService` extended with the two methods; `createMockCli()`
    updated.
- **Roadmap docs.** `docs/MILESTONE-v0.8.md` + `docs/NEXT-STEPS-v0.8.md`
  bootstrap the v0.8 "Observability" milestone (deliverables F-J).

## [0.7.1] — 2026-04-20
Hardening release on top of v0.7.0. Wires the Warp Drive sidebar to the
Oz CLI behind a graceful filesystem fallback and adds the first MCP
HTTP+SSE end-to-end smoke tests.
### Added
- **Warp Drive — Oz CLI source wired (`v0.7.1` RF-5).** The
  `WarpDriveTreeProvider` now consumes a `CompositeDriveSource` that
  prefers the Oz CLI and transparently falls back to the existing
  filesystem source when the binary lacks the `drive` subcommand. No
  user-visible change until the CLI ships the endpoints — the fallback
  path is identical to v0.7.0 production behaviour.
  - New `OzCliService.driveList(category)` and `driveGet(id)` methods
    (sanitised id, JSON parsing, raw markdown body).
  - New module `src/drive/ozCliDriveRunner.ts` — thin adapter
    implementing `CliDriveRunner` over `IOzCliService`. Errors propagate
    unchanged so `CliDriveSource.isNotAvailableError` can convert
    "unknown command" stderr into the graceful filesystem fallback.
- **MCP HTTP+SSE end-to-end smoke** (`test/mcp/integration.test.ts`):
  3 new tests walking the full client handshake (open `/sse` →
  consume the `endpoint` frame → POST a `tools/call` JSON-RPC
  request → assert the SSE `message` frame carries the response),
  plus rejection of unknown sessionId and malformed JSON body.
### Changed
- `IOzCliService` extended with `driveList` / `driveGet`. All test
  helpers (`createMockCli()`) updated accordingly.
### Metrics
- 58 test files, **868** unit tests, all green.
- `dist/extension.js` bundled at **86.22 KB** (esbuild, minified,
  `vscode` external) — within the 90 KB performance budget.
- VSIX packaged at **60.67 KB**.

## [0.7.0] — 2026-04-20
Third public release under the `sena-labs` publisher. Ships the
**Team & Drive** milestone: a navigable Warp Drive sidebar, a built-in
skill / rule editor, an interactive `/init` v2 QuickPick, team-shared
per-workspace YAML overrides, and one-command MCP auto-registration
for Claude Code, Cursor and Codex.
### Added
- **Warp Drive sidebar** (`v0.7` deliverable A):
  - Backend abstraction `src/drive/warpDriveSource.ts`
    (`IWarpDriveSource` contract, `parseDriveEntry` / `…Strict` type
    guards) with two implementations:
    `src/drive/cliDriveSource.ts` (wraps a future Oz CLI `drive`
    subcommand via the `CliDriveRunner` abstraction, surfacing
    `CliDriveNotAvailableError` as a soft fallback; enforces a
    `LIST_SOFT_LIMIT = 200` per category) and
    `src/drive/fileSystemDriveSource.ts` (reads `~/.warp/drive/`,
    `~/.agents/rules/`, `~/.agents/skills/*/SKILL.md` with YAML
    frontmatter parsing and a path-traversal guard).
  - `src/drive/driveSourceFactory.ts` composes both into a
    `CompositeDriveSource` that falls back only on
    `CliDriveNotAvailableError`; every other error bubbles up.
  - `src/ui/driveTreeProvider.ts` — `WarpDriveTreeProvider` with 3
    categories (Prompts / Rules / Skills), per-category cache that
    drops on `refresh()`, error branches surfaced as message nodes.
  - `src/ui/driveCommands.ts` — four new commands
    (`warpBridge.drive.refresh`, `.insertIntoChat`, `.copyContent`,
    `.openInEditor`). Filesystem entries open via `Uri.file`; CLI
    entries open as untitled markdown documents.
  - New view container entry `warpBridge.driveView` contributed under
    the existing `warpBridgeSidebar` Activity Bar container.
  - Context-menu entries gated on the `warpDrive(Prompt|Rule|Skill)`
    `viewItem` kinds.
  - **67 backend tests** (drive/ source, factory, filesystem,
    CLI wrapper) plus **15 UI tests** (tree provider + commands).
- **Built-in skill & rule editor** (`v0.7` deliverable B):
  - `src/ui/skillEditor.ts` with four commands:
    `warpBridge.skill.edit` (opens any skill / rule in the built-in
    VS Code editor), `.skill.new` (prompts for a name and target —
    Project or Global — then scaffolds `SKILL.md`),
    `.skill.saveGlobal` / `.skill.saveWorkspace` (save the active
    editor's content into `~/.agents/skills/<name>/SKILL.md` or
    `<workspace>/.agents/skills/<name>/SKILL.md` respectively).
  - Scoped to the native VS Code editor (Markdown preview via
    `Ctrl+K V` is first-class there); a richer Monaco + webview
    editor remains a v0.8 stretch item.
  - Shared `atomicWrite` helper (`.tmp` + `fs.renameSync`) and a
    strict `^[a-z0-9][a-z0-9-]*$` skill-name validator.
  - Overwrite protection via a modal confirmation prompt.
  - 11 new tests in `test/ui/skillEditor.test.ts`.
- **`/init` v2** (`v0.7` deliverable C):
  - New `src/scaffold/skillTemplates.ts` registry of 8 templates
    (7 `AGENT_SKILL_MAP` skills + `.warp/rules/PROJECT.md`) with a
    data-only layout shared with future editors.
  - New `src/commands/initV2Command.ts` drives a QuickPick that marks
    each item as `[new]` or `[exists]`, pre-picks only missing
    templates, and asks for per-file confirmation before overwriting.
    Reports a rich `created / overwritten / skipped / errored` summary
    in the chat transcript. `@warp /init all` preserves the legacy
    bulk behaviour (never overwrites).
  - All writes go through the shared `atomicWrite` helper.
  - 19 new tests in `test/commands/initV2Command.test.ts`.
  - Legacy `src/commands/initCommand.ts` and its two test files
    removed; router swapped to the v2 factory.
- **Per-workspace YAML config** (`v0.7` deliverable D) — an optional
  `.warp/warp-bridge.yaml` file committed to the repo overrides the
  `warpBridge.*` VS Code settings for every contributor. The override is
  reloaded automatically via `vscode.workspace.createFileSystemWatcher`
  on create/change/delete and fires `onConfigChanged` so downstream
  services (MCP lifecycle, status bar, tree view) pick it up without
  requiring a reload.
  - New module `src/services/yamlParser.ts` — hand-rolled, safe,
    flat-only YAML reader (scalars, quoted strings, comments, null/~).
    Zero runtime dependencies.
  - New module `src/services/workspaceConfigResolver.ts` — typed
    resolver with an allow-list of 10 overridable keys. Rejects unknown
    keys and type mismatches with a warning. Deliberately excludes
    `ozPath` (platform-specific) and `mcpBearerToken` (secret).
  - `ConfigManager` accepts an optional `WorkspaceConfigResolver` and
    merges `overrides > VS Code settings > compiled-in defaults` on
    every `getConfig()` call.
  - `vscode` mock extended with `RelativePattern` and
    `createFileSystemWatcher` surfaces.
  - 29 new unit tests across `yamlParser`, `workspaceConfigResolver`
    and `configManagerPrecedence` suites.
- **MCP auto-registration** (`v0.7` deliverable E):
  - New module `src/mcp/clientRegistration.ts` defining
    `IMcpClientRegistrar`, `McpClientEndpoint`, `McpRegistrationStatus`
    — a narrow, uniform contract for register / unregister / status.
  - `src/mcp/registrars/jsonRegistrarBase.ts` — shared base class +
    `atomicWriteJson` helper for the two JSON-backed clients.
    Preserves every unrelated top-level key in the target file.
  - `src/mcp/registrars/claudeCodeRegistrar.ts` writes to
    `~/.claude.json`.
  - `src/mcp/registrars/cursorRegistrar.ts` writes to
    `~/.cursor/mcp.json`.
  - `src/mcp/registrars/codexRegistrar.ts` — minimal line-based TOML
    writer targeting only `[[mcp.servers]]` array-of-tables; every
    other byte of `~/.codex/config.toml` is preserved verbatim.
  - Two new commands (`warpBridge.mcp.registerClient`,
    `.unregisterClient`) QuickPick among the three registrars and
    call the selected one with an endpoint derived from the running
    MCP server (or the user's configured bind address / port when
    stopped).
  - **38 new tests** across `test/mcp/{claudeCode, cursor, codex,
    clientRegistrationOrchestration}.test.ts`.
### Changed
- `package.json` version bumped to `0.7.0`.
- `EXTENSION_VERSION` in `src/extension.ts` bumped to `0.7.0`; it is
  now baked into every MCP `serverInfo.version` payload.
- `CommandRouter` routes `/init` to the new v2 factory.
### Compatibility
- Requires **VS Code ≥ 1.96.0** (same floor as v0.5 / v0.6).
- All v0.2.0-era settings, slash commands and Language Model Tools
  remain supported.
- MCP server is still **opt-in** via `warpBridge.mcpEnabled`; MCP
  client auto-registration is a manual command (never runs on
  activation) and is idempotent + reversible.
- Zero new runtime dependencies; `dist/extension.js` stays within
  the v0.7 bundle budget.
### Metrics
- 57 test files, **860** unit tests, all green.
- `dist/extension.js` bundled at **≈ 85 KB** (esbuild, minified,
  `vscode` external; v0.7 budget: 90 KB).
## [0.6.0] — 2026-04-20
Second public release under the `sena-labs` publisher. Ships the
**MCP Server Export** milestone: any Model Context Protocol client
(Claude Code, Cursor, Codex…) can now drive Warp Oz through the same
tool surface Copilot sees inside VS Code.
### Added
- **MCP server export** (opt-in):
  - New module `src/mcp/server.ts` implementing the MCP JSON-RPC 2.0 protocol (protocol versions `2025-03-26` and `2024-11-05`) with `initialize`, `ping`, `tools/list`, `tools/call`. Transport layout: `GET /sse`, `POST /messages?sessionId=<uuid>`, plus `GET /health`. Zero third-party dependencies — uses Node's built-in `http` / `crypto` modules only.
  - New module `src/mcp/tools.ts` exposing 4 tools (`oz_agent_run`, `oz_agent_run_cloud`, `oz_run_get`, `oz_run_list`) with strict JSON input schemas and structured text results. Tool handlers route errors as `{ isError: true }` content blocks per the MCP spec.
  - New lifecycle controller `src/mcp/lifecycle.ts` (`McpLifecycle`) with idempotent `start()` / `stop()`, optional config-driven auto-start, and graceful disposal on `deactivate()`.
  - Four new commands: `warpBridge.mcp.start`, `warpBridge.mcp.stop`, `warpBridge.mcp.status`, `warpBridge.mcp.copyEndpointUrl`, under the `Warp MCP` Command Palette category.
  - Four new settings: `warpBridge.mcpEnabled` (opt-in, default `false`), `warpBridge.mcpPort` (default `3847`, `0` = ephemeral), `warpBridge.mcpBindAddress` (default `127.0.0.1` — loopback), `warpBridge.mcpBearerToken` (default empty; when set, every request must carry `Authorization: Bearer <token>`, validated in constant time via `crypto.timingSafeEqual`).
  - New documentation `docs/MCP.md` covering quick start, endpoints, protocol, tool surface, bearer auth, per-client integration examples (`~/.claude.json`, `~/.cursor/mcp.json`, `~/.codex/config.toml`), raw `curl` cheatsheet, troubleshooting, security posture and known limitations.
  - 34 new unit tests across `test/mcp/{server,tools,lifecycle}.test.ts` covering JSON-RPC dispatch, initialize/version negotiation, `tools/list`, `tools/call` happy and error paths, malformed requests, bearer auth match/mismatch, `/health` response, lifecycle `start`/`stop`/`restart` idempotency, and command-palette wiring.
### Changed
- `package.json` version bumped to `0.6.0`.
### Compatibility
- Requires **VS Code ≥ 1.96.0** (same as v0.5.0).
- MCP server is **opt-in**; existing users upgrading from v0.5.0 see no behavioural change until they flip `warpBridge.mcpEnabled = true`.
- Zero new runtime dependencies; `dist/extension.js` remains under the 100 KB performance budget.
### Metrics
- 44 test files, **694** unit tests, all green.
- `dist/extension.js` bundled at **≈ 59 KB** (esbuild, minified, `vscode` external).
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
