# OzBridge for VS Code — v0.9.0

**Release date:** 2026-04-20  
**Publisher:** `sena-labs`  
**Milestone:** *Reach* — deliverables **K · L · M · N · O**

## TL;DR

v0.9.0 makes OzBridge **installable everywhere a VS Code-like editor
runs and welcoming to first-time users**: the official `vscode.l10n`
pipeline ships English / Italian / Spanish bundles, a four-step
Get-Started walkthrough opens on first activation, the publish
pipeline targets both **VS Code Marketplace** and **Open VSX** in
parallel, CI grew into a 2 × 3 cross-platform matrix gated by a
dedicated 125 KB bundle-budget workflow, and `CONTRIBUTING.md` now
documents the deliverable-PR playbook the maintainers actually use.

## Highlights

### 🌐 Localization pipeline (deliverable K)

Wired the official `vscode.l10n` API end-to-end:

- `l10n/bundle.l10n{,.it,.es}.json` — **51** runtime message keys per
  locale, with positional `{N}` placeholders.
- `package.nls{,.it,.es}.json` — **32** manifest keys (display name,
  description, command palette categories and titles).
- All **43** `vscode.window.show*Message` call sites across nine source
  files now go through `vscode.l10n.t(...)`.
- `package.json` declares `"l10n": "./l10n"` and references commands
  via `%key%` placeholders.

15 consistency tests validate key parity, placeholder counts, manifest
references and bundle declaration.

### 🚀 Get-Started walkthrough (deliverable L)

A four-step `ozBridge.gettingStarted` walkthrough — install Warp CLI,
run `@oz`, explore the Warp views, enable the MCP bridge — opens
automatically on first activation, gated by the
`ozBridge.walkthrough.shown` key in `context.globalState` so it
never nags returning users. Re-openable any time from
**Help → Get Started**. Titles, descriptions and step bodies are
fully localised. The gating helper is hardened to no-op when
`globalState` is unavailable (smoke-test mode, custom hosts).

### 📦 Open VSX publishing (deliverable M)

Refactored `.github/workflows/publish.yml` into four jobs sharing one
VSIX artifact:

1. `build` — install, type-check, test, package.
2. `publish-marketplace` — `@vscode/vsce publish` using `VSCE_PAT`.
3. `publish-openvsx` — `ovsx publish` using `OVSX_PAT`.
4. `github-release` — attaches the VSIX to the tagged GitHub release.

Each publish job **soft-fails** with a `::warning::` when the
corresponding secret is missing, so partial registry access never
blocks a release. README gains install snippets and direct links for
both registries.

> **Heads-up.** `VSCE_PAT` is currently expired (TF400813 from
> v0.7.x); the Marketplace job will warn and skip until the token is
> rotated. The Open VSX job runs as soon as `OVSX_PAT` is provided
> against the `sena-labs` namespace.

### 🛡️ CI matrix + bundle budget (deliverable N)

`.github/workflows/ci.yml` is now a **2 × 3 matrix** — Node `20.19` /
`22.12` × `ubuntu-latest` / `windows-latest` / `macos-latest` — with
`fail-fast: false` and cancel-in-progress concurrency. A separate
`.github/workflows/bundle-budget.yml` builds the production bundle on
every PR and **fails** when `dist/extension.js` exceeds **125 KB**,
emitting a size summary in the GitHub job summary panel.

### 📖 Contributor docs rewrite (deliverable O)

`CONTRIBUTING.md` is rewritten around the **deliverable-PR playbook**:
branch naming, Conventional Commits squash titles, the three-section
PR body template (**What / Verification / Next**), the
`gh pr merge --squash --delete-branch --auto` flow, the CI matrix
baseline, the 125 KB bundle budget and the l10n bundle layout. 8
regex-guarded tests prevent the doc from drifting away from the
pipeline.

## Footprint

| Metric           | v0.8.0   | v0.9.0   |
| ---------------- | -------- | -------- |
| Tests passing    | 978/978  | **1029/1029** |
| Bundle size      | ~99 KB   | **~100 KB** (budget 125 KB) |
| Supported locales| en       | **en, it, es** |
| Registries       | Marketplace | **Marketplace + Open VSX** |
| CI cells         | 1 × 2    | **3 × 2** |

## Install

### VS Code Marketplace

```bash
code --install-extension sena-labs.warp-vsc-bridge
```

### Open VSX (Cursor, VSCodium, Gitpod, Windsurf, …)

```bash
ovsx get sena-labs.warp-vsc-bridge
```

Or grab the `.vsix` from the
[GitHub release page](https://github.com/sena-labs/warp-vsc-bridge/releases/tag/v0.9.0)
and install via **Extensions → Install from VSIX…**.

## Breaking changes

None. v0.2.0 `@oz` chat participant flows continue to work
unchanged.

## Known issues

- `VSCE_PAT` rotation pending — Marketplace publish step will warn and
  skip until renewed.
- Open VSX namespace `sena-labs` must be confirmed claimed before
  the first successful Open VSX publish.

## What's next — v1.0 "GA"

- Telemetry opt-in (`@vscode/extension-telemetry`, respects
  `telemetry.telemetryLevel`).
- Security audit + CodeQL on every PR.
- Performance budgets enforced in CI (activation ≤ 200 ms, sidebar
  first-paint ≤ 300 ms, memory ≤ 50 MB).
- Accessibility compliance pass (WCAG 2.1 AA) on every webview.

See [`docs/warp-vsc-bridge — Roadmap competitiva v0.3 → v1.0.md`](./warp-vsc-bridge%20%E2%80%94%20Roadmap%20competitiva%20v0.3%20%E2%86%92%20v1.0.md)
for the full v1.0 plan.
