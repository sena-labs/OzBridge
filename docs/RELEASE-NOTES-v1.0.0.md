# OzBridge for VS Code — v1.0.0 Release Notes

**Release date:** 2026-04-20
**Codename:** GA (Enterprise-Ready)
**Predecessor:** [`v0.9.0`](https://github.com/sena-labs/warp-vsc-bridge/releases/tag/v0.9.0)
**Milestone plan:** [`docs/MILESTONE-v1.0.md`](MILESTONE-v1.0.md)

## TL;DR

`warp-vsc-bridge` reaches **General Availability**. v1.0 is the
"trust layer" release: the surface stays identical to v0.9 (Chat
Participant + 4 LM Tools + Activity Bar + Cloud Run Monitor + MCP
server + Drive browser + Dashboard + l10n + walkthrough), but the
operational guarantees that enterprise users need are now built in
and **CI-enforced**:

- **Telemetry**: opt-in only, doubly gated, with a hard-coded deny-list
  that makes user content untransmittable by construction.
- **Security**: CodeQL `security-extended`, npm-audit gate, full-history
  gitleaks, weekly Dependabot — all blocking on PRs.
- **Performance**: activation budget regression-tested in CI.
- **Accessibility**: WCAG 2.1 AA on every UI surface, locked by an
  invariant test.
- **Operability**: machine-overridable kill-switch + 18-month LTS
  policy with maintenance branches.

## Footprint

| Metric | v0.9.0 | v1.0.0 | Δ |
|---|---|---|---|
| Tests | 977 / 977 | **1089 / 1089** | +112 |
| Bundle (`dist/extension.js`) | ~102 KB | **104.46 KB** / 125 KB budget | +2 KB |
| Production CVEs | 0 | **0** | — |
| Production runtime deps | 3 | **3** | — |
| VS Code engine | `^1.96.0` | `^1.96.0` | — |
| Locales (`vscode.l10n`) | en/it/es | en/it/es | — |
| CI workflows | 4 | **6** (+ codeql + perf) | +2 |

## What landed

### P — Telemetry opt-in pipeline (#26)

`src/services/telemetry.ts` ships an `ITelemetryReporter` contract
with a default `NoopReporter` (zero network code path) and an
`HttpAppInsightsReporter` that uses the host's global `fetch` —
**no new runtime dependency**. Reporter is **doubly gated**:

1. `vscode.env.isTelemetryEnabled === true`, **AND**
2. `ozBridge.telemetry.connectionString` carries a valid
   `InstrumentationKey=...;IngestionEndpoint=...` string.

Either gate closed ⇒ noop. The event map is a closed
`TelemetryEventMap` enforced both by TypeScript and at runtime, with a
deny-list (`prompt|content|output|path|workspace|runid|message|stack|email|user|token`)
that makes prompt content, run IDs, output, file paths and workspace
paths impossible to transmit. Privacy contract documented in
[`PRIVACY.md`](../PRIVACY.md), linked from the walkthrough.

### Q — Supply-chain security gates (#27)

- `.github/workflows/codeql.yml` — CodeQL `security-extended` +
  `security-and-quality` query suites for JavaScript/TypeScript;
  weekly cron; results published to the Security tab.
- `.github/workflows/security.yml` — `npm audit --omit=dev
  --audit-level=high` blocks on production high/critical CVEs;
  gitleaks scans full git history (`fetch-depth: 0`).
- `.github/dependabot.yml` — root npm + `packages/copilot-chat-toolkit`
  workspace + GitHub Actions; weekly cadence; grouped updates.
- `SECURITY.md` rewritten with v0.9.x → v1.0.x LTS support matrix,
  documented opt-out path, and an "Automated Security Gates" section
  enumerating the CI invariants.

### R — Activation perf CI budget (#33)

`test/activationPerf.test.ts` measures `activate()` over 25 iterations
on a fresh state (warm-up excluded), prints a `[perf] activate()`
summary line and asserts both p50 and p95 against the published
budget (`BUDGETS.p50Ms = 800`, `BUDGETS.p95Ms = 1500`). The envelope
is calibrated for the vitest harness with the mocked `vscode` host —
**real editor activation is ~5× faster** — so the gate trips on a 2×
regression of the synchronous path. New `.github/workflows/perf.yml`
runs the perf suite in isolation on every PR + main push.

### S — WCAG 2.1 AA accessibility pass (#35)

Every `TreeItem` produced by `WarpRunsTreeProvider` and
`WarpDriveTreeProvider` now carries `accessibilityInformation` with a
semantic label + `treeitem` role (e.g. `"Run my-prompt, status
INPROGRESS, active"` rather than `"my-prompt"`). The status bar item
exposes a plain-language label in both steady and error states
(codicon glyphs like `$(cloud)` are not narrated by AT) with role
`'button'`. Tooltip backfilled on category/message nodes that
previously lacked one. New `test/accessibility.test.ts` (13 tests)
hard-blocks regressions across both providers, the status bar, and
the four walkthrough markdown files (alt-text on every image, at
least one heading for document outline).

### T — Kill-switch + LTS policy (#34)

Two new `machine-overridable` settings:

- `ozBridge.killSwitch.enabled` — boolean, default `false`.
- `ozBridge.killSwitch.reason` — string, default `""`.

When the switch is on, `activate()` short-circuits before any wiring
step (no commands, tools, MCP server, chat participant or trees are
registered) and surfaces a single warning notification with the
optional reason text. The extension stays installed; flipping the
boolean back to `false` re-enables it for new windows without a
reload. `SECURITY.md` now documents the kill-switch playbook and a
formal **LTS policy table** (18-month active LTS, 6-month
critical-only window, `release/v<major>.<minor>.x` maintenance
branches, 14-day patch cadence for confirmed vulnerabilities,
one-minor-release deprecation notice).

## Settings added since v0.9

| Setting | Default | Scope |
|---|---|---|
| `ozBridge.telemetry.connectionString` | `""` | application |
| `ozBridge.killSwitch.enabled` | `false` | application, machine-overridable |
| `ozBridge.killSwitch.reason` | `""` | application, machine-overridable |

## Install

### Marketplace (pending VSCE_PAT rotation — see Known Issues)

```bash
code --install-extension sena-labs.warp-vsc-bridge
```

### Open VSX (pending OVSX_PAT + namespace — see Known Issues)

```bash
code --install-extension sena-labs.warp-vsc-bridge --extension-marketplace open-vsx.org
```

### From the GitHub release VSIX (always available)

Download `warp-vsc-bridge-1.0.0.vsix` from the
[release page](https://github.com/sena-labs/warp-vsc-bridge/releases/tag/v1.0.0),
then:

```bash
code --install-extension warp-vsc-bridge-1.0.0.vsix
```

## Known issues

- **Marketplace publication blocked**: `VSCE_PAT` rotation pending in
  Sena Labs Azure DevOps. The publish workflow is wired and will run
  automatically on tag `v1.0.0` once the secret lands. Soft-fail logic
  ensures the GitHub Release still produces a downloadable VSIX even
  if Marketplace push fails.
- **Open VSX publication blocked**: `OVSX_PAT` and the `sena-labs`
  namespace claim are pending at <https://open-vsx.org>. Same
  soft-fail behaviour as Marketplace.
- **Telemetry collector not yet provisioned**: The Application Insights
  resource in the Sena Labs Azure subscription is pending
  provisioning. Until then `ozBridge.telemetry.connectionString`
  has no public default; users who self-host their own AppInsights
  can opt in already by setting it manually.

These are **operational** blockers, not code blockers — the v1.0.0
artefact is shippable today.

## LTS commitment

Per the policy table introduced in deliverable T (see
[`SECURITY.md`](../SECURITY.md#lts-policy)):

| Window | Date range | What ships |
|---|---|---|
| Active LTS | 2026-04-20 → 2027-10-20 | Security patches + non-breaking bug fixes |
| Critical only | 2027-10-20 → 2028-04-20 | High/critical CVE patches only |
| End of life | 2028-04-20 onwards | No further updates |

Maintenance branch: `release/v1.0.x` (created at the v1.0.0 tag).

## Outlook (post-1.0)

The v0.3 → v1.0 roadmap is now fully shipped; every milestone brief lives
in [`docs/`](./). Post-1.0 work continues in `main` toward the
v1.x line; breaking changes (if any) defer to v2.0.

## Acknowledgements

This release closes the v0.3 → v1.0 competitive roadmap drafted six
months ago. Every deliverable from A (LM Tools) through T
(kill-switch + LTS) shipped via a dedicated PR with the
**deliverable-PR playbook** documented in `CONTRIBUTING.md`. Thanks
to every contributor who reviewed, tested and shipped along the way.
