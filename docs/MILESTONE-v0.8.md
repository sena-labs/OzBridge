# Milestone v0.8 — "Observability"

**Target version:** `0.8.0`
**Integration branch:** `feat/v0.8-observability`
**Release branch (after ship):** `release/v0.8.x`
**Depends on:** `v0.7.1` (RF-5 wiring + MCP HTTP+SSE smoke) on `main`.
**Latest snapshot:** [`v0.7.1`](https://github.com/sena-labs/warp-vsc-bridge/releases/tag/v0.7.1)

## Strategic message

> Metrics, costs, mid-run steering and dataset curation for Warp cloud
> agent runs — **zero direct competitors** on the VS Code Marketplace.

v0.7 made Warp Drive resources first-class citizens inside VS Code. v0.8
turns the run history into actionable insight: a dashboard for trend
and cost breakdown, mid-run steering with a progressive fallback, and a
failure-triage assistant that suggests fixes from `vscode.lm`.

## Progress tracker

| Id  | Deliverable                                       | Status         | Sub-branch                          | PR  |
| --- | ------------------------------------------------- | -------------- | ----------------------------------- | --- |
| F   | `IRunSteerer` abstraction + progressive fallback  | 🟡 **Planned** | `feat/v0.8-run-steerer`             | —   |
| G   | `RunStatsService` + `runStats.ts` aggregator      | 🟡 **Planned** | `feat/v0.8-run-stats`               | —   |
| H   | Dashboard webview (`warpBridge.dashboard`)        | 🟡 **Planned** | `feat/v0.8-dashboard`               | —   |
| I   | Failure triage helper (`vscode.lm.sendRequest`)   | 🟡 **Planned** | `feat/v0.8-failure-triage`          | —   |
| J   | Dataset export (JSONL from selected runs)         | 🔵 **Stretch** | `feat/v0.8-dataset-export`          | —   |

Current metrics at integration HEAD (`main` @ `v0.7.1`):

- `tsc --noEmit` strict: clean.
- `vitest`: **868 / 868** across 58 files, deterministic.
- `dist/extension.js`: **86.22 KB** (90 KB budget → 96 % used —
  v0.8 must keep the delta ≤ 4 KB or bump the budget to 100 KB).
- VSIX: **60.67 KB**.

> ⚠️ **Bundle pressure.** With only ~4 KB of headroom, every v0.8 PR
> must report `dist/extension.js` size in the description. The
> dashboard webview (deliverable **H**) ships its assets via webview
> URIs from `media/dashboard/`, **outside** the bundled extension code.

## Deliverable F — `IRunSteerer` abstraction

### Goal

A typed abstraction that lets any UI surface (Cloud Run Monitor
webview, sidebar context-menu, command palette) send a follow-up
prompt to a cloud run that is still in flight, with a documented
**progressive fallback** matching the roadmap decision log.

### Contract

```ts
export interface IRunSteerer {
  /** Sends a follow-up prompt to a still-running cloud run. */
  steer(opts: SteerRunOptions): Promise<SteerRunResult>;
  /** Whether the underlying CLI exposes a true continue flag. */
  capabilities(): Promise<SteerCapabilities>;
}

export interface SteerRunOptions {
  runId: string;
  prompt: string;
  cancellation?: vscode.CancellationToken;
}

export interface SteerRunResult {
  /** Run id of the resulting in-flight run (may differ from input). */
  runId: string | null;
  /** Strategy actually used. */
  strategy: 'native-continue' | 'inlined-fallback';
  /** Raw `OzRunResult` returned by the CLI. */
  raw: OzRunResult;
}

export interface SteerCapabilities {
  nativeContinue: boolean;
  detectedAt: number;
}
```

### Implementation

- `src/services/runSteerer.ts` — `ProgressiveRunSteerer` implements
  `IRunSteerer`:
  - On first call, runs `oz agent run --help` once and caches whether
    `--continue` is exposed.
  - If yes → invokes
    `oz agent run --continue <runId> --prompt <text> --output-format json`.
  - If no → invokes
    `oz agent run-cloud --prompt "[CONTINUING <runId>] <text>" --output-format json`.
  - Errors propagate unchanged (`OzCliError`).
- `src/services/ozCliService.ts` — gain two thin methods:
  - `agentContinue(runId, prompt, cancellation?)` (calls native flag).
  - `helpAgentRun()` (returns stdout of `oz agent run --help`).
- `src/types/index.ts` — extend `IOzCliService` with the two methods.

### Tests (target ≥ 12)

- `test/services/runSteerer.test.ts` — capability probe cached, native
  path, fallback path, error propagation, prompt validation, runId
  sanitisation.
- `test/services/ozCliService.runSteerer.test.ts` — `agentContinue`
  argv shape, `helpAgentRun` parsing.
- `test/helpers.ts` — extend `createMockCli()` with the two methods.

### Definition of done

- `npm run compile`, `npm test`, `npm run build` all green.
- `dist/extension.js` ≤ 88 KB (delta ≤ 2 KB).
- New methods documented in `src/types/index.ts` JSDoc.

## Deliverable G — `RunStatsService` + aggregator

### Goal

A pure-data service that produces aggregated metrics from the existing
`runList()` payloads, ready to feed the dashboard webview (deliverable
**H**) without any DOM dependency. Lives in `src/services/runStats.ts`.

### Contract

```ts
export interface RunStatsBucket {
  date: string;             // YYYY-MM-DD (workspace local time)
  total: number;
  succeeded: number;
  failed: number;
  inFlight: number;
}

export interface RunStatsSummary {
  windowDays: number;
  totalRuns: number;
  successRate: number;      // 0..1
  buckets: RunStatsBucket[];
}

export interface IRunStatsService {
  /** Aggregates the last `windowDays` of run history. */
  computeSummary(windowDays: number): Promise<RunStatsSummary>;
}
```

### Implementation

- `src/services/runStats.ts` — `RunStatsService` consumes
  `IOzCliService.runList()` plus per-run `runGet()` for status +
  duration. Caches per-runId entries in-memory (`Map<string, …>`) and
  invalidates on `RunPoller` `onDidUpdate` events for runs that
  transition to a terminal state.
- Pure aggregation helpers (`bucketByDate`, `successRate`) exported as
  module functions for unit tests.

### Tests (target ≥ 18)

- `test/services/runStats.test.ts`:
  - empty history → zeros, no crash;
  - mixed statuses → correct buckets;
  - window boundaries (TZ-safe, edge of day);
  - cache hit on repeated `computeSummary`;
  - cache invalidation on terminal-state transition.

### Definition of done

- `npm test` green, **≥ 18** new tests.
- Zero new runtime deps.
- Documented in `src/types/index.ts`.

## Deliverable H — Dashboard webview

### Goal

A webview opened via command `warpBridge.dashboard.open` that renders:

- 30-day timeline (line chart, runs/day) — vanilla SVG, no charting
  lib (bundle budget!).
- Success-rate gauge.
- Top 10 longest runs with click → run detail.
- Export buttons: CSV / JSON of the visible window.

### Implementation

- `src/ui/dashboardPanel.ts` — `DashboardPanel` singleton wrapper
  around `vscode.window.createWebviewPanel`, retains state via
  `setState`/`getState`, listens to `RunStatsService` updates.
- `media/dashboard/index.html` + `dashboard.js` + `dashboard.css` —
  shipped verbatim, loaded via `webview.asWebviewUri()` with strict
  CSP and per-panel nonce.
- `contributes.commands` entry `warpBridge.dashboard.open`.

### Tests (target ≥ 10)

- `test/ui/dashboardPanel.test.ts` — panel lifecycle, message
  protocol (`requestSummary` → `summary`), export message handling.
- `test/mocks/vscode.ts` — extend `createWebviewPanel` mock if needed.

### Definition of done

- Bundle delta ≤ 2 KB (chart code ships in webview, not extension).
- VSIX delta ≤ 8 KB (webview assets).
- CSP non-empty, nonce unique per panel instance.

## Deliverable I — Failure triage helper

### Goal

When a cloud run finishes with `status === 'FAILED'`, expose a button
in the future Cloud Run Monitor (and a command palette entry today)
that:

1. Extracts the last stack trace / error class from `result.output`.
2. Sends it via `vscode.lm.sendRequest()` with a deterministic system
   prompt asking for a probable root cause + 1-3 concrete next steps.
3. Renders the answer inline in a markdown notification or returns it
   programmatically (for the future webview).

### Implementation

- `src/services/failureTriage.ts` — `FailureTriageService` with one
  method `analyse(result: OzRunResult): Promise<TriageReport>`.
- Pure `extractStackTrace(output: string): string | null` helper for
  unit tests (no `vscode.lm` dependency).
- `src/commands/triageCommand.ts` — palette entry
  `warpBridge.triageLastFailure`.

### Tests (target ≥ 10)

- `test/services/failureTriage.test.ts` — extractor edge cases (no
  trace, multiple traces, ANSI codes, truncated output).
- Mock `vscode.lm.sendRequest()` for the analyse path.

### Definition of done

- Falls back gracefully when `vscode.lm` returns `NoModel` (just
  surfaces the extracted trace as a plain notification).

## Deliverable J — Dataset export (stretch)

### Goal

Selecting N runs from the sidebar (multi-select via `Ctrl/Cmd-click`)
and choosing **Export as JSONL** writes one record per run with
`{ runId, status, prompt, output, durationMs, model, environment }`
fit for evaluation/fine-tuning datasets.

### Implementation

- `src/commands/datasetExportCommand.ts` reusing `RunStatsService`'s
  cache to avoid re-fetching `runGet()` for already-loaded runs.
- Atomic write (`<file>.tmp` → `fs.renameSync`).

### Definition of done

- ≥ 6 tests (validation, atomic write, schema).
- Skip if v0.8 milestone budget exhausted; reschedule as v0.8.1.

## Out of scope

- Real-time event streaming from the cloud agent (waiting on Warp API).
- A native chart library (Chart.js, Recharts) — too heavy for the
  bundle budget.
- Per-user telemetry — explicitly v1.0 territory.

## Risk log

- **Bundle pressure (96 % used).** Mitigation: dashboard ships assets
  outside the bundle; reject any v0.8 PR that pushes
  `dist/extension.js` past 90 KB without a documented budget bump.
- **Oz CLI lacks `--continue` flag today.** Mitigation: the
  progressive-fallback design (`IRunSteerer`) keeps users productive
  on the inlined path.
- **`vscode.lm` may be unavailable** on older VS Code versions.
  Mitigation: failure-triage degrades to "show extracted stack" only.
- **Run history can be huge.** Mitigation: `RunStatsService` accepts a
  `windowDays` argument (default 30); never loads everything at once.

## Definition of done for v0.8.0

- Tests: **≥ 920** total (60+ new), zero flakes, deterministic.
- Bundle: **≤ 100 KB** (budget bumped from 90 KB if needed; documented
  in CHANGELOG).
- VSIX: **≤ 80 KB** (extra room reserved for webview assets).
- README + CHANGELOG + new `docs/DASHBOARD.md` reflect the surface.
- `v0.8.0` tag and GitHub Release live, with VSIX attached.
- `release/v0.8.x` branch created from the tag.
