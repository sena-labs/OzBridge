# feat(security): supply-chain gates (v1.0 deliverable Q)

## What

Ships **deliverable Q** of the v1.0 milestone — automated security
gates on every PR and every push to `main`.

- **`.github/workflows/codeql.yml`** — GitHub CodeQL on the
  `javascript-typescript` language pack with both `security-extended`
  and `security-and-quality` query suites. Findings publish to the
  repository's Security tab and block PRs at `error` severity. Weekly
  Monday 06:00 UTC cron picks up CVEs that land between releases.
  Permissions narrowed to `actions: read`, `contents: read`,
  `security-events: write`.
- **`.github/workflows/security.yml`** — two parallel jobs:
  - `audit`: `npm audit --omit=dev --audit-level=high` fails the PR on
    any high/critical advisory in the **production** dependency
    closure. Dev dependencies are excluded because they don't ship in
    the VSIX.
  - `secret-scan`: `gitleaks/gitleaks-action@v2` against the full git
    history (`fetch-depth: 0`) catches accidentally committed
    credentials before they reach `main`.
  - Weekly Monday 07:00 UTC cron + `concurrency` group prevent
    duplicate runs on rebased PRs.
- **`.github/dependabot.yml`** — schema v2 watching three ecosystems
  on a weekly Monday cadence (Europe/Rome timezone):
  - `npm` (root) with grouped updates for the TypeScript toolchain,
    Vitest, and `@vscode/*`. `@types/vscode` major bumps ignored.
  - `npm` (`packages/copilot-chat-toolkit` workspace).
  - `github-actions` with grouped `actions/*` + `github/codeql-action`
    bumps.
  - PR caps at 5/3/3, reviewer auto-assignment to
    `sena-labs/maintainers`, Conventional Commits prefixes
    (`chore(deps)`, `chore(toolkit-deps)`, `chore(actions)`).
- **`SECURITY.md`** rewrite:
  - Refreshed support matrix: `0.9.x` active LTS, `0.8.x` critical
    only, `≤ 0.7.x` EOL. v1.0 line will become active LTS at GA.
  - New "Automated Security Gates (v1.0 deliverable Q)" section
    enumerating each CI invariant.
  - Telemetry opt-out documented and linked to `PRIVACY.md`.
- **`test/securityGates.test.ts`** — 15 structural assertions parsing
  the actual workflow + dependabot YAMLs and `SECURITY.md`. Guards
  against drift: presence of CodeQL language + query suites + write
  permission, `npm audit` flags + `gitleaks` job + full-history
  checkout + weekly cron, dependabot v2 schema with all three
  ecosystems on a weekly cadence, refreshed supported-versions table.

## Verification

```
npm run compile     # → 0 TypeScript errors
npm test -- --run   # → 1069/1069 green (75 files; 15 new gate tests)
npm run build       # → dist/extension.js = 105,347 B (102.88 KB)
                    #   unchanged: deliverable Q is CI-only, no
                    #   runtime code path.
```

The two new workflows and the dependabot config will activate on the
next push to `main` (this PR's merge). Findings, CVE alerts and
weekly Dependabot PRs will flow into the Security and Pull Requests
tabs from then on.

## Next

- **Deliverable R (v1.0):** activation perf budgets enforced in CI
  (`activate < 200 ms` on a perf-bench harness). Will likely add a
  third job to `ci.yml` and a vitest perf suite.
- **Deliverable S (v1.0):** WCAG 2.1 AA pass on tree views, status
  bar, walkthrough.
- **Deliverable T (v1.0):** kill-switch setting + 18-month LTS
  policy formalisation (the support matrix in `SECURITY.md` is the
  first half).
- **v1.0.0 release ceremony:** bump → CHANGELOG promote → release
  notes → tag `v1.0.0` → `release/v1.0.x` branch → ship to
  Marketplace + Open VSX (pending external blockers in
  `docs/NEXT-STEPS-v1.0.md`).
# feat(telemetry): opt-in reporter (v1.0 deliverable P)

## What

Ships **deliverable P** of the v1.0 milestone — the opt-in telemetry
pipeline — defined in `docs/MILESTONE-v1.0.md` and
`docs/NEXT-STEPS-v1.0.md`.

- `src/services/telemetry.ts` introduces the `ITelemetryReporter`
  contract with two implementations:
  - **`NoopReporter`** — default; literal no-op `track`, no buffer,
    no timer, no network code path.
  - **`HttpAppInsightsReporter`** — batches typed events and POSTs
    them to the AppInsights ingestion endpoint via the host's global
    `fetch` (Node ≥ 18). **Zero new runtime dependency.**
- The reporter is **doubly gated**: active only when **both**
  `vscode.env.isTelemetryEnabled === true` **and**
  `warpBridge.telemetry.connectionString` is a valid
  `InstrumentationKey=...;IngestionEndpoint=...` string. Either gate
  closed ⇒ noop transport. Malformed strings ⇒ noop fallback (warning
  logged, extension keeps running).
- New setting `warpBridge.telemetry.connectionString` (default `""`,
  scope `machine-overridable`) declared in `package.json`, documented
  with a `markdownDescription` linking to `PRIVACY.md`.
- Hard-coded deny-list `FORBIDDEN_KEY_REGEX =
  /prompt|content|output|path|workspace|runid|message|stack|email|user|token/i`
  enforced both at the type level (closed `TelemetryEventMap`) and at
  runtime in `HttpAppInsightsReporter.sanitise`. Prompt content, run
  IDs, output, file paths, workspace paths, stack traces and tokens
  cannot leave the process.
- `src/extension.ts#activate` instantiates the reporter immediately
  after logger init, emits `extensionActivated { version }`, and
  registers `dispose()` on `context.subscriptions`. The
  `cli.checkAvailability` failure path now also emits
  `errorRaised { kind: 'availabilityCheck' }`.
- New top-level `PRIVACY.md` documents the contract: TL;DR, the closed
  event map, the deny-list, the opt-out matrix, the endpoint and the
  retention policy. The Get-Started walkthrough's MCP step
  (`media/walkthrough/enable-mcp.md`) now links to it.
- `test/mocks/vscode.ts` extends the `env` mock with
  `isTelemetryEnabled: false` so existing suites exercise the noop
  path by default and new tests can flip the gate explicitly.

## Verification

```
npm run compile     # → no TypeScript errors
npm test -- --run   # → 1054/1054 green (74 files), incl. 18 new
                    #   telemetry tests covering: deny-list invariant,
                    #   both opt-in gates, malformed-string fallback,
                    #   AppInsights envelope shape, transport-failure
                    #   resilience, dispose-flushes-buffered-batch.
npm run build       # → dist/extension.js = 105,347 B (102.88 KB)
                    #   ≈ 102.88 / 125 KB budget (~22 KB headroom).
```

## Privacy contract (enforced by code + tests)

| Layer            | Mechanism                                                              |
| ---------------- | ---------------------------------------------------------------------- |
| Off by default   | Both `isTelemetryEnabled === true` *and* non-empty connection string   |
| Closed event set | `type TelemetryEventName` = 5 literal events                           |
| Closed payload   | Strict `TelemetryEventMap`, no `Record<string, unknown>` ever exposed  |
| Deny-list        | `FORBIDDEN_KEY_REGEX` (12 banned tokens), runtime-checked, drops batch |
| Crash-safety     | `try/catch` swallows transport errors; reporter never crashes the host |
| Opt-out          | Any one of: `telemetry.telemetryLevel = off`, empty conn string, disable extension |

## Next

- **Deliverable Q (v1.0):** security gates — CodeQL workflow, npm
  audit gate, Dependabot baseline, secret scanning, `SECURITY.md`
  refresh.
- **Deliverable R (v1.0):** activation perf budgets enforced in CI
  (`activate < 200 ms` on the perf-bench suite).
- **Deliverable S (v1.0):** WCAG 2.1 AA pass on tree views, status
  bar, walkthrough.
- **Deliverable T (v1.0):** kill-switch setting + 18-month LTS policy.
- **v1.0.0 release ceremony:** bump → CHANGELOG promote → release
  notes → tag `v1.0.0` → `release/v1.0.x` branch → ship to Marketplace
  + Open VSX (pending VSCE_PAT rotation + OVSX namespace claim, see
  `docs/NEXT-STEPS-v1.0.md` "External blockers").
# v1.0 bootstrap — "GA" milestone planning

Plans the path from `v0.9.0` to `v1.0.0` ("Enterprise-ready") with the same deliverable-PR cadence used through v0.7 / v0.8 / v0.9.

## What
- Added `docs/MILESTONE-v1.0.md` describing the 5 deliverables P–T (telemetry opt-in, security gates, performance budgets, WCAG 2.1 AA accessibility, kill-switch + LTS), with contracts, risk log and out-of-scope list.
- Added `docs/NEXT-STEPS-v1.0.md` operational sequence (one PR per deliverable + release ceremony), referencing the deliverable-PR playbook in `CONTRIBUTING.md`.
- Prepended a `[Unreleased]` Changed entry to `CHANGELOG.md`.
- Added `test/milestoneV1Bootstrap.test.ts` (8 tests) guarding deliverable enumeration, telemetry deny-list invariant, performance budget table, and the step ordering.

## Verification
- `npm run compile` — clean.
- `npm test -- --run` — **1037 / 1037** green (+8 vs main).
- No source/runtime changes → bundle untouched (≤ 125 KB budget).

## Next
- **Deliverable P** (`feat/v1.0-telemetry`): wire `@vscode/extension-telemetry` with the documented event set + deny-list test, ship `PRIVACY.md`.
# Release v0.9.0 — "Reach"

Promotes deliverables **K · L · M · N · O** to the v0.9.0 stable line.

## What
- Bumped `package.json` and `EXTENSION_VERSION` to `0.9.0`.
- Promoted `[Unreleased]` to `## [0.9.0] — 2026-04-20` in `CHANGELOG.md` with a milestone summary.
- Added `docs/RELEASE-NOTES-v0.9.0.md` covering all 5 deliverables, footprint table, install snippets (Marketplace + Open VSX), known issues (`VSCE_PAT` rotation pending), and v1.0 outlook.

## Verification
- `npm run compile` — clean.
- `npm test -- --run` — **1029 / 1029** green.
- `npm run build` — `dist/extension.js` = **102,388 B (99.99 KB)** · budget 125 KB.
- `npm run package` — VSIX produced (~149 KB).

## Next
After merge:
1. `git tag v0.9.0 -m "v0.9.0 — Reach"` and `git push --tags`.
2. `publish.yml` runs the four-job pipeline (build → marketplace → openvsx → github-release). Marketplace job will warn-skip until `VSCE_PAT` is rotated.
3. Cut `release/v0.9.x` maintenance branch from the tag.
# v0.9 deliverable O — Contributor docs rewrite

## What
- Rewrote `CONTRIBUTING.md` around the **deliverable-PR playbook** (branch → implement → tests → CHANGELOG → PR body **What/Verification/Next** → `gh pr merge --squash --delete-branch --auto`).
- Documented the 2 × 3 CI matrix (Node `20.19` / `22.12`), the non-watch `npm test -- --run` invocation, the **125 KB** bundle budget, and the l10n bundle layout (`package.nls*.json`, `l10n/bundle.l10n*.json`).
- Added `test/contributingDocs.test.ts` (8 regex-guarded tests) to prevent the doc from drifting away from the pipeline.

## Verification
- `npm run compile` — clean.
- `npm test -- --run` — **1029 / 1029** green (+8 vs main).
- No runtime/source changes → bundle size unchanged (≤ 125 KB budget).

## Next
- v0.9.0 release ceremony (version bump, CHANGELOG promote, `docs/RELEASE-NOTES-v0.9.0.md`, tag, release).
# v0.9 deliverable N — CI matrix & bundle-budget workflow

## What
- Rewrote `.github/workflows/ci.yml` as a **2 × 3 matrix** (Node `20.19` / `22.12` × `ubuntu-latest` / `windows-latest` / `macos-latest`) with `fail-fast: false` and `concurrency.cancel-in-progress: true`.
- Added `.github/workflows/bundle-budget.yml`: on every push/PR builds the production bundle, asserts `dist/extension.js` ≤ **125 KB**, and emits a size summary to `$GITHUB_STEP_SUMMARY`. Cancel-in-progress enabled.
- Added `test/ciMatrix.test.ts` (9 tests) asserting matrix shape, OS coverage, fail-fast flag, concurrency policy, test invocation and the 125 KB threshold.

## Verification
- `npm run compile` — clean.
- `npm test -- --run` — **1021 / 1021** green (+9 vs main).
- Workflow YAMLs inspected via regex-based tests (no extra deps).

## Next
- Deliverable O — CONTRIBUTING rewrite (stretch).
- v0.9.0 release ceremony (version bump, CHANGELOG promote, tag).
# Deliverable M — Open VSX publishing & release pipeline

Third deliverable of the v0.9 "Reach" milestone
(`docs/NEXT-STEPS-v0.9.md`).

## What

Refactors the publish workflow into a proper multi-stage pipeline and
documents the Open VSX registry as a first-class install source.

### `.github/workflows/publish.yml`

Four jobs with a shared VSIX artifact:

| Job | Purpose | Secret |
|---|---|---|
| `build` | install → compile → test → build → `vsce package` → upload artifact | — |
| `publish-marketplace` | `@vscode/vsce publish --packagePath` | `VSCE_PAT` |
| `publish-openvsx` | `npx ovsx publish` | `OVSX_PAT` |
| `github-release` | attach VSIX to tag via `softprops/action-gh-release@v2` | — |

Highlights:

- Each registry job **soft-fails** (`::warning::`) when its secret is
  missing, so partial access never blocks a release.
- `concurrency: publish-${{ github.ref }}` prevents overlapping tag
  runs from racing.
- Single `npm test -- --run` invocation in `build`; publish jobs only
  re-download the artifact (no rebuild).

### README install section

Added a "From a registry" subsection above the VSIX instructions with
copy-pasteable `code --install-extension` / `codium --install-extension`
commands plus direct Marketplace and Open VSX URLs.

### Tests (+7) — `test/publishingReadiness.test.ts`

- Mandatory publisher/marketplace fields (`publisher`, `name`,
  `displayName`, `description`, `license`, `icon`, `categories`).
- Canonical `repository.url` / `bugs.url` / `homepage` point at
  `sena-labs/warp-vsc-bridge`.
- Icon referenced in `package.json` exists on disk with non-zero size.
- `engines.vscode` is a pinned semver and `main` is the esbuild output.
- Workflow declares `build`, `publish-marketplace`, `publish-openvsx`,
  `github-release` and the three publish jobs depend on `build`.
- `VSCE_PAT` / `OVSX_PAT` secrets are wired in the right step envs.
- README documents both registries with the `sena-labs.warp-vsc-bridge`
  extension id.

### Walkthrough helper hardening

Made `maybeOpenGettingStartedWalkthrough` no-op when
`context.globalState` is unavailable (e.g. in the smoke-test harness
that bypasses the full extension host).

## Verification

- `npm run compile` — no TypeScript errors.
- `npm test -- --run` — **1012/1012** (1005 baseline + 7 new tests).
- `npm run build` — bundle **99.99 KB** (budget 125 KB).

## Next

Deliverable N (`docs/NEXT-STEPS-v0.9.md`) — CI matrix (Node 20/22 ×
ubuntu/windows/macos) + bundle-budget gate.
# Deliverable L — Get-Started walkthrough

Second deliverable of the v0.9 "Reach" milestone
(`docs/NEXT-STEPS-v0.9.md`).

## What

Contributes a first-class **Get Started with Warp Bridge** walkthrough
that appears automatically the first time the extension activates and
can be reopened from **Help → Get Started** at any time.

### Manifest
- `package.json#contributes.walkthroughs[0]` — `warpBridge.gettingStarted`
  with four steps:
  1. **Install the Warp CLI** (completion: `warpBridge.tree.refresh`).
  2. **Run your first `@warp` prompt** (completion: chat participant
     invocation).
  3. **Explore the Warp views** (completion: opening `warpBridge.runsView`).
  4. **Enable the MCP bridge (optional)** (completion: toggling
     `warpBridge.mcpEnabled` or running `warpBridge.mcp.start`).
- All titles/descriptions localised through
  `package.nls{,.it,.es}.json` (10 new `walkthrough.*` keys per locale).

### Markdown content
- `media/walkthrough/install-cli.md`
- `media/walkthrough/first-agent.md`
- `media/walkthrough/explore-views.md`
- `media/walkthrough/enable-mcp.md`

### First-activation gate
- `src/ui/walkthrough.ts` exposes `maybeOpenGettingStartedWalkthrough`
  which reads/writes the `warpBridge.walkthrough.shown` key on
  `context.globalState` so the wizard auto-opens at most once per
  install. Failures from `workbench.action.openWalkthrough` are
  swallowed (activation must never block on UX).
- `src/extension.ts` wires the helper into `activate()` after logger
  init and before the background CLI availability check.

### Tests (+12)
- `test/ui/walkthroughGating.test.ts` (7 tests): first-run opens, gate
  flip is idempotent, re-activation skips, falsy stored values still
  open once, qualified id is correct, rejected `executeCommand` does
  not throw, `showProgress=false` is forwarded.
- `test/ui/walkthroughManifest.test.ts` (5 tests): single walkthrough
  contributed, exactly four ordered step ids, non-empty
  `completionEvents`, markdown assets exist and are free of
  `<script>` / `javascript:` URIs, every `%key%` resolves in
  `package.nls.json`.

## Verification
- `npm run compile` — no TypeScript errors.
- `npm test -- --run` — **1005/1005** (993 baseline + 12 new tests).
- `npm run build` — bundle **99.93 KB** (budget 125 KB).

## Next
Deliverable M (`docs/NEXT-STEPS-v0.9.md`) — Open VSX publishing.
# Deliverable K — `vscode.l10n` localization pipeline

Closes the first item of the v0.9 "Reach" milestone defined in
`docs/MILESTONE-v0.9.md` / `docs/NEXT-STEPS-v0.9.md`.

## What

Wires the official **`vscode.l10n`** API end-to-end with two starter
locales (Italian, Spanish) on top of the English source.

### Runtime message bundles
- `l10n/bundle.l10n.json` — 51 English source keys (identity map).
- `l10n/bundle.l10n.it.json` — Italian translations.
- `l10n/bundle.l10n.es.json` — Spanish translations.
- `package.json` declares `"l10n": "./l10n"`.

### Manifest localization
- `package.nls.json` — 32 keys (displayName, description, 4 categories,
  25 command titles).
- `package.nls.it.json`, `package.nls.es.json` — full translations.
- All `contributes.commands[]` entries now use `%key%` references.

### Source migrations (43 call sites · 9 files)
`src/extension.ts`, `src/commands/cloudCommand.ts`,
`src/commands/initV2Command.ts`, `src/mcp/lifecycle.ts`,
`src/ui/treeCommands.ts`, `src/ui/driveCommands.ts`,
`src/ui/handoff.ts`, `src/ui/skillEditor.ts` — every
`vscode.window.show*Message`/quickpick/inputbox/withProgress label now
flows through `vscode.l10n.t(...)` with positional `{N}` placeholders.

### Tests
- `test/l10n/bundleConsistency.test.ts` — verifies `it`/`es` bundles
  share the source key set, preserve `{N}` placeholder counts, and
  contain non-empty translations.
- `test/l10n/manifestConsistency.test.ts` — parses `package.json`,
  collects every `%key%` reference, asserts presence in all three
  manifest bundles, and confirms the `l10n` field declaration.

### Test mock
- `test/mocks/vscode.ts` — added a faithful `vscode.l10n` namespace
  (`t()` with positional `{N}` interpolation, supporting both string
  and object-form signatures).

## Verification
- `npm run compile` — no TypeScript errors.
- `npm test -- --run` — **993/993** (978 baseline + 15 new l10n tests).
- `npm run build` — bundle **99.58 KB** (budget 125 KB).

## Next
Deliverable L (`docs/NEXT-STEPS-v0.9.md`) — Get-Started walkthrough.
# v0.7.0 — Team & Drive (remaining deliverables + release)

Closes the v0.7 milestone by merging deliverables **A-UI**, **B**, **C** and **E** on top of the partial integration already in `main` (PR #6), and finalizes the `v0.7.0` release.

## What's in this PR

| Commit | Deliverable |
| --- | --- |
| `8931e08` | **A-UI** — `WarpDriveTreeProvider` + 4 `warpBridge.drive.*` commands, `warpBridge.driveView` view entry, provider + commands wired into `extension.ts`. 15 new tests. |
| `9a6ea09` | **B** — Built-in skill / rule editor: 4 commands (`warpBridge.skill.edit` / `.new` / `.saveGlobal` / `.saveWorkspace`), atomic write, strict name validator, overwrite protection. 11 new tests. |
| `cb95091` | **C** — `/init` v2 QuickPick with per-file `[new]` / `[exists]` badges and per-file overwrite confirmation; `@warp /init all` preserves legacy bulk behaviour. New `src/scaffold/skillTemplates.ts` registry. Legacy `initCommand.ts` + its 2 test files removed. 19 new tests. |
| `4f4b8b0` | **E** — MCP client auto-registration: `IMcpClientRegistrar` contract + `ClaudeCodeRegistrar` / `CursorRegistrar` (JSON via shared `JsonMcpRegistrar` base) / `CodexRegistrar` (minimal line-based TOML). Two new commands (`warpBridge.mcp.registerClient` / `.unregisterClient`). 38 new tests. |
| `82a92c8` | **Release finalization** — version bump `0.7.0-dev → 0.7.0` across `package.json`, `package-lock.json` and `EXTENSION_VERSION`. CHANGELOG `[Unreleased]` consolidated into `[0.7.0] — 2026-04-20`. RELEASE-NOTES finalised (WIP callout / progress tracker / `(pending)` markers dropped; VSIX SHA256 + metrics filled in). |

## Metrics

- **Tests:** 860 / 860 green across 57 files (baseline 790, +70). `vitest` runs deterministic under `fileParallelism: false`.
- **Bundle:** `dist/extension.js` = 84.7 KB (v0.7 budget 90 KB).
- **VSIX:** `warp-vsc-bridge.vsix` = 60.05 KB.
- **Runtime deps:** 0 new (unchanged since v0.2.0).
- **TSC strict:** clean.

## Back-compat

- `@warp /init` users get the new QuickPick immediately; `@warp /init all` retains the v0.2.0 bulk semantics.
- MCP server remains opt-in (`warpBridge.mcpEnabled`). Client auto-registration is manual and reversible; no file is written at activation.
- All v0.2.0-era slash commands, Language Model Tools, tree views and settings untouched.

## Follow-ups (not in this PR)

- `RF-3`: in-memory caching for the sidebar (current refresh re-reads disk / CLI every time).
- `RF-5`: `OzCliDriveRunner` adapter to switch the drive factory to the CLI path when Oz ships `drive`.

## Validation plan

- [x] `npm run compile` (tsc strict) — clean.
- [x] `npm test` — 860/860 green.
- [x] `npm run build` — 84.7 KB.
- [x] `npm run package` — 60.05 KB VSIX.

After merge: tag `v0.7.0` on the merge commit, push tag, `gh release create v0.7.0 warp-vsc-bridge.vsix --title "v0.7.0 - Team and Drive" --notes-file docs/RELEASE-NOTES-v0.7.0.md`, then archive `release/v0.7.x` from the tag.
