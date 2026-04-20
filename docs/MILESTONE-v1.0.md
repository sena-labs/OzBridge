# Milestone v1.0 — "GA"

**Target version:** `1.0.0`
**Integration branch:** none (incremental PRs into `main`)
**Release branch (after ship):** `release/v1.0.x`
**Depends on:** `v0.9.0` (Reach — l10n, walkthrough, dual publish, CI matrix, contrib docs) on `main`.
**Latest snapshot:** [`v0.9.0`](https://github.com/sena-labs/warp-vsc-bridge/releases/tag/v0.9.0)

## Strategic message

> **Enterprise-ready.** Privacy-respecting telemetry (`telemetry.telemetryLevel`
> aware), security audit + CodeQL on every PR, performance budgets
> enforced in CI, accessibility compliance (WCAG 2.1 AA) on every
> webview, and a **12-month LTS commitment** on the v1.0 line.

v0.9 made the extension **reachable**; v1.0 makes it **trustworthy**.
Deliverables are non-functional but mandatory for enterprise adoption:
no telemetry without explicit opt-in, no merged PR without CodeQL +
performance gates, no webview without keyboard navigation and
high-contrast support.

## Progress tracker

| Id  | Deliverable                                              | Status         | Sub-branch                         | PR  |
| --- | -------------------------------------------------------- | -------------- | ---------------------------------- | --- |
| P   | Telemetry opt-in (`@vscode/extension-telemetry`)         | 🟡 **Planned** | `feat/v1.0-telemetry`              | —   |
| Q   | Security gates (CodeQL + dependency scanning + PRIVACY)  | 🟡 **Planned** | `feat/v1.0-security`               | —   |
| R   | Performance budgets enforced in CI                       | 🟡 **Planned** | `feat/v1.0-perf-budgets`           | —   |
| S   | Accessibility pass (WCAG 2.1 AA) on every webview        | 🟡 **Planned** | `feat/v1.0-a11y`                   | —   |
| T   | Kill-switch + LTS commitment + release ceremony          | 🟡 **Planned** | `feat/v1.0-killswitch-lts`         | —   |

Current metrics at integration HEAD (`main` @ `v0.9.0`):

- `tsc --noEmit` strict: clean.
- `vitest`: **1029 / 1029** deterministic.
- `dist/extension.js`: **99.99 KB** (125 KB v0.9 budget — **80 % used**).
- VSIX: ~149 KB.
- Locales: en, it, es.

> ⚠️ **Bundle pressure.** Telemetry SDK (`@vscode/extension-telemetry`)
> adds ~6 KB minified, accessibility helpers ~2 KB, kill-switch reader
> ~1 KB. Combined headroom against the 125 KB cap is ~16 KB —
> sufficient but tight. Every PR continues to report bundle size in
> the description.

## Deliverable P — Telemetry opt-in

### Goal

Ship privacy-respecting telemetry that **never** transmits prompt
content, run IDs, output, file paths or workspace paths, and that is
**off by default** unless the user has explicitly enabled VS Code
telemetry (`telemetry.telemetryLevel === 'all' | 'usage'`).

### Contract

- New service `ITelemetryReporter` thin-wrapping
  `@vscode/extension-telemetry` (Microsoft official SDK).
- Events emitted (no PII):
  - `extensionActivated` — `{ version }`.
  - `commandInvoked` — `{ command }`.
  - `runStarted` — `{ kind: 'local' | 'cloud' }`.
  - `runCompleted` — `{ status, durationMs }`.
  - `errorRaised` — `{ kind }` (no message, no stack).
- Hard-coded **deny list** asserted by unit test: any property name
  matching `/prompt|content|output|path|workspace|runId/i` fails the
  build.
- `PRIVACY.md` at repo root, linked from the walkthrough's last step.
- Endpoint configurable via `warpBridge.telemetry.connectionString`
  setting (Sena Labs Application Insights workspace by default,
  empty = no transport even if VS Code telemetry is on).

### Implementation

- New `src/services/telemetry.ts` with `ITelemetryReporter`,
  `NoopReporter`, `AppInsightsReporter`.
- Wire `reporter.activate(context)` in `extension.ts#activate`.
- Replace ad-hoc `logger.info` activation/error calls with reporter
  events where appropriate (do **not** remove the logger).
- Unit tests: deny list, opt-in respect, noop fallback, init failure
  resilience.

## Deliverable Q — Security gates

### Goal

Every PR runs CodeQL (`javascript-typescript`) and a dependency audit
before it can be squash-merged. Publish `SECURITY.md` triage SLA and
`PRIVACY.md` policy.

### Contract

- `.github/workflows/codeql.yml` — `javascript-typescript` analysis on
  push + pull_request, branch `main`.
- `.github/dependabot.yml` — npm + github-actions ecosystems, weekly
  schedule.
- `npm audit --audit-level=high` job in `ci.yml` (advisory only;
  failures emit `::warning::` until v1.1).
- `SECURITY.md` updated with triage SLA (`critical` ≤ 48 h,
  `high` ≤ 7 d).
- `PRIVACY.md` describing the telemetry contract.

### Implementation

- New workflows under `.github/workflows/`.
- `dependabot.yml` at `.github/`.
- Tests assert workflow shape + SECURITY/PRIVACY presence.

## Deliverable R — Performance budgets

### Goal

CI fails when activation, sidebar paint, or steady-state memory
regresses past the documented budgets:

| Metric                    | Budget   |
| ------------------------- | -------- |
| Activation                | ≤ 200 ms |
| Sidebar first-paint       | ≤ 300 ms |
| Steady-state memory       | ≤ 50 MB  |
| Bundle (`extension.js`)   | ≤ 125 KB |

### Contract

- New `npm run perf:bench` script that runs a Vitest perf suite using
  `performance.now()` against the activate path with a mocked
  `ExtensionContext`.
- `.github/workflows/perf-budget.yml` runs the suite and emits a job
  summary table. Failures hard-block the PR.
- `dist/extension.js ≤ 125 KB` continues to be enforced by
  `bundle-budget.yml` (already shipped in v0.9 deliverable N).

### Implementation

- New `test/perf/activation.bench.test.ts` measuring `activate(ctx)`
  median over 50 runs after warm-up.
- Sidebar paint is approximated by the time between
  `TreeDataProvider.refresh()` invocation and the next
  `getChildren()` resolution.
- Memory check uses `process.memoryUsage().heapUsed` after a forced
  GC (`--expose-gc` flag in workflow).

## Deliverable S — Accessibility (WCAG 2.1 AA)

### Goal

Every webview surface (Cloud Run Monitor, Dashboard, Skill Editor,
Drive Browser detail view) ships keyboard-navigable controls, ARIA
labels, focus rings, and high-contrast theme support.

### Contract

- Audit checklist file `docs/A11Y-CHECKLIST.md` with one row per
  webview (current state + target).
- Each webview's HTML asserts `lang`, `title`, semantic roles, and
  uses `var(--vscode-*)` tokens for colour (high-contrast aware).
- Snapshot tests assert presence of `aria-*` attributes on
  interactive elements.
- Keyboard navigation: `Tab` order documented per webview;
  `Esc` always closes modal panels.

### Implementation

- New helper `src/ui/webview/a11yHelpers.ts` exporting
  `wrapWithSkipLink`, `requireAriaLabel`, `assertContrastTokens`.
- Tests under `test/ui/a11y/` (~6 cases per webview).

## Deliverable T — Kill-switch, LTS, release ceremony

### Goal

A remote feature-flag service can disable any v1.0 feature without
shipping a new VSIX. v1.0.0 is committed to **12 months of patch
support**.

### Contract

- New service `IFeatureFlags` with implementations:
  - `StaticFlags` (default — all enabled).
  - `RemoteFlags` (HTTP GET against
    `warpBridge.featureFlags.endpoint` setting, 5-minute cache, fail-
    open).
- Each major v1.0 feature reads `flags.isEnabled('<key>')` before
  activating its handler.
- `docs/LTS.md` documenting the 12-month policy.
- v1.0.0 release ceremony (version bump, CHANGELOG promote,
  `docs/RELEASE-NOTES-v1.0.0.md`, tag, `release/v1.0.x` branch).

### Implementation

- `src/services/featureFlags.ts` + tests (cache, fail-open, TTL).
- Wire into `extension.ts#activate`.
- Final ceremony PR mirrors `chore(release): v0.9.0`.

## Risk log

- **Telemetry endpoint provisioning.** Sena Labs Application Insights
  workspace must exist before deliverable P can ship a non-empty
  default connection string. If unavailable at PR time, default
  `connectionString = ""` (noop transport) — document the gap in the
  release notes.
- **CodeQL false positives.** First run on a TypeScript-strict codebase
  often surfaces tagged-template injection warnings around `vscode.l10n.t`.
  Prepared mitigation: suppression via `// codeql[js/...]: justified`
  with a test asserting the suppression scope.
- **Performance bench flakiness.** `performance.now()` on Windows is
  noisy; the perf suite uses median-of-50 with a 2× tolerance buffer
  on top of the documented budget. CI surfaces the actual median
  in the job summary so regressions are visible even when not
  failing.
- **Bundle pressure.** Telemetry + a11y + flags add ~9 KB combined.
  Headroom is 25 KB; if any deliverable lands above projection, defer
  the kill-switch HTTP transport (`StaticFlags` only) to v1.0.1.

## Out of scope (recorded for v1.x)

- Multi-tenant telemetry (per-org workspaces). v1.0 is single
  Sena-Labs-hosted endpoint.
- Configurable feature flag UI in settings. v1.0 reads flags but
  does not render a control panel.
- ClickHouse / PostHog backends. The `ITelemetryReporter` interface
  makes the swap mechanical for v1.x, but v1.0 ships AppInsights
  only.
- Full localisation expansion to the remaining 8 locales (de, fr,
  pt, ja, zh, ko, ru) — community-driven, lands in v1.0.x patches.
