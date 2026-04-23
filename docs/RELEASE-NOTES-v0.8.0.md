# OzBridge for VS Code — v0.8.0 release notes

**Date:** 2026-04-20  
**Codename:** *Observability*

This release closes the v0.8 milestone defined in
[`docs/MILESTONE-v0.8.md`](MILESTONE-v0.8.md). It introduces five new
modules (deliverables F–J) covering run steering, statistics
aggregation, a webview dashboard, AI-assisted failure triage, and
dataset export.

## Highlights

### F — `IRunSteerer` with progressive fallback
A new abstraction lets the extension *steer* an in-flight Oz run
without round-tripping through the user. The default
`ProgressiveRunSteerer` probes the CLI's `oz agent run --help` once,
caches the capability, and either uses native `--continue <runId>` or
inlines a `[CONTINUING <runId>]` prefix into a fresh `run-cloud`
prompt. Either way the call site stays a one-liner.

### G — `RunStatsService`
Pure-data aggregator built on top of `runList()` + `runGet()` that
produces a dashboard-ready `RunStatsSummary`. Terminal runs
(`SUCCEEDED` / `FAILED`) are cached forever; non-terminal records are
always re-fetched so status transitions surface on the next refresh.
Pure helpers (`bucketByDate`, `successRate`, `extractCreatedAt`,
`formatLocalDate`, `isTerminalStatus`) are exported for testability.

### H — Observability dashboard webview
New command **`Warp: Open Dashboard`** opens a singleton webview with:

- Total-runs and success-rate cards
- Inline SVG sparkline over the 14-day window
- Per-day breakdown table with OK / Failed / In-flight columns
- Refresh button that invalidates the underlying cache

Hardened with a strict CSP (`default-src 'none'`) and a 32-char
per-render nonce; every dynamic value is HTML-escaped.

### I — Failure triage
New command **`Warp: Triage Failed Run…`** runs an AI-assisted
diagnosis against a `FAILED` run. The flow:

1. Loads the run, validates the status.
2. Extracts up to 3 stack frames (Node, Python, generic file:line:col).
3. Tail-trims the output to 4 KB at a line boundary.
4. Sends a deterministic prompt (`SUMMARY:` / `ACTIONS:` protocol)
   through `vscode.lm.selectChatModels({ vendor: 'copilot' })`.
5. Renders the parsed suggestion as a markdown preview tab.

`ILanguageModelClient` keeps the service injectable and lets the host
gracefully degrade when the language-model API is unavailable.

### J — Dataset export (stretch)
New command **`Warp: Export Run Dataset…`** exports the run history to
**JSON Lines** or **RFC 4180 CSV**. Defaults are conservative:
terminal runs only, 200-row limit, 4 KB output cap per row. Pure
helpers (`csvQuote`, `toCsv`, `toJsonl`, `truncateOutput`) are
exported for unit testing.

## New commands

| Command id                      | Title                          |
| ------------------------------- | ------------------------------ |
| `ozBridge.dashboard.open`     | Warp: Open Dashboard           |
| `ozBridge.triageFailure`      | Warp: Triage Failed Run…       |
| `ozBridge.exportDataset`      | Warp: Export Run Dataset…      |

## Quality gates

- **Tests**: 978/978 (+110 vs v0.7.1).
- **Bundle**: `dist/extension.js` 98.93 KB (101,305 bytes) — within
  the v0.8 budget of 100 KB.
- **VSIX**: `warp-vsc-bridge-0.8.0.vsix` 66.96 KB (68,567 bytes).
- **TypeScript**: strict, 0 errors.

## Compatibility

No breaking changes since 0.7.1. The new commands and the dashboard
panel activate on demand; the extension continues to work on hosts
without `vscode.lm` (failure triage shows a graceful warning).

## Operational notes

- The `publish.yml` GitHub Actions workflow still requires the
  `VSCE_PAT` secret to be re-issued (TF400813 on the previous run).
  This release ships the VSIX as a GitHub Release asset; Marketplace
  publication will resume once the token is rotated.

## What's next — v0.9 preview

Per the
[v0.3 → v1.0 competitive roadmap](warp-vsc-bridge%20%E2%80%94%20Roadmap%20competitiva%20v0.3%20%E2%86%92%20v1.0.md),
v0.9 ("Workflow integration") will focus on inline GitHub PR triage
and tighter Notebook integration. The `IRunSteerer` and dataset export
abstractions introduced here are direct prerequisites for those
flows.
