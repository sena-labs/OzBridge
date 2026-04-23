# Next development steps — v0.8 (Observability)

This is the actionable counterpart to
[`MILESTONE-v0.8.md`](./MILESTONE-v0.8.md). Whoever picks the milestone
back up reads only this file to know **what to do next, in order**.

## Current state (as of `v0.7.1`)

- `main` HEAD: `c9509e0` (release notes for v0.7.1).
- Tests: **868 / 868** across 58 files.
- Bundle: **86.22 KB** (90 KB budget — only ~4 KB headroom).
- VSIX: **60.67 KB**.
- No open PRs, no open issues.

## Execution order

Each step lands its own PR on `main` (no long-lived integration
branch — v0.8 is small enough to ship incrementally). Mark the
corresponding row in the milestone tracker as soon as the PR lands.

### Step 1 — Deliverable F (`IRunSteerer` abstraction)

Branch: **`feat/v0.8-run-steerer`**

1. Add `agentContinue` + `helpAgentRun` on `OzCliService` and extend
   `IOzCliService` accordingly.
2. Implement `ProgressiveRunSteerer` in `src/services/runSteerer.ts`.
3. Extend `test/helpers.ts::createMockCli()` with the two new methods.
4. Tests: **≥ 12** new (capability probe cached, native path, fallback
   path, error propagation, prompt validation, runId sanitisation).
5. Validate: `npm run compile`, `npm test`, `npm run build`.
6. Open PR with bundle size reported. Squash-merge.

### Step 2 — Deliverable G (`RunStatsService`)

Branch: **`feat/v0.8-run-stats`**

1. Implement `src/services/runStats.ts` with `bucketByDate` and
   `successRate` exported helpers.
2. Wire to the existing `RunPoller` `onDidUpdate` event (already added
   in v0.4) for cache invalidation.
3. Tests: **≥ 18** new (empty history, mixed statuses, TZ boundaries,
   cache hit, cache invalidation).
4. Validate, PR, merge.

### Step 3 — Deliverable H (Dashboard webview)

Branch: **`feat/v0.8-dashboard`**

1. Bundle budget reality-check: if Step 1+2 already pushed the bundle
   above 89 KB, bump the documented budget to 100 KB **before** this
   step (CHANGELOG entry under `[Unreleased]`).
2. Add `media/dashboard/` assets (no charting lib — vanilla SVG).
3. Implement `src/ui/dashboardPanel.ts` with strict CSP + nonce.
4. Register command `ozBridge.dashboard.open` in `package.json`.
5. Tests: **≥ 10** new (panel lifecycle, message protocol, export).
6. Validate, PR, merge.

### Step 4 — Deliverable I (Failure triage)

Branch: **`feat/v0.8-failure-triage`**

1. Implement `extractStackTrace` as a pure module function.
2. Implement `FailureTriageService.analyse()` with `vscode.lm` fallback.
3. Register command `ozBridge.triageLastFailure`.
4. Tests: **≥ 10** new (extractor edge cases, mocked `vscode.lm`).
5. Validate, PR, merge.

### Step 5 — Deliverable J (Dataset export, stretch)

Branch: **`feat/v0.8-dataset-export`**

Skip if Steps 1-4 consume the milestone budget; reschedule as `v0.8.1`.

### Step 6 — Release v0.8.0

Same playbook as `v0.7.0`:

1. Bump `package.json` + `EXTENSION_VERSION` → `0.8.0`.
2. Promote `[Unreleased]` to `[0.8.0] — <date>`.
3. Author `docs/RELEASE-NOTES-v0.8.0.md`.
4. Validate, package, tag, release with VSIX asset.
5. Cut `release/v0.8.x` branch from the tag.

## Risk log

See [`MILESTONE-v0.8.md`](./MILESTONE-v0.8.md) §Risk log. The single
biggest threat is the **bundle budget** — every PR must report
`dist/extension.js` size in the description.

## Out of scope

Anything under `MILESTONE-v0.8.md` §Out of scope. Ideas that surface
mid-execution go to a v0.9 backlog bullet, not into this milestone.
