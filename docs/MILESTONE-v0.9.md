# Milestone v0.9 — "Reach"

**Target version:** `0.9.0`
**Integration branch:** none (incremental PRs into `main`)
**Release branch (after ship):** `release/v0.9.x`
**Depends on:** `v0.8.0` (Observability — dashboard, steerer, triage, dataset export) on `main`.
**Latest snapshot:** [`v0.8.0`](https://github.com/sena-labs/warp-vsc-bridge/releases/tag/v0.8.0)

## Strategic message

> Installable everywhere VS Code-like editors run (Cursor, VSCodium,
> Windsurf, Gitpod, Antigravity). Onboarding in **3 clicks**. Ten
> locales via the official `vscode.l10n` API.

v0.8 made the runtime observable; v0.9 makes the extension **reachable**.
The deliverables are infrastructural rather than feature-driven: dual
publishing (Marketplace + Open VSX), an in-product walkthrough that
brings install-to-first-run conversion above 60 %, full localisation
via the VS Code-native bundle format, hardened CI on every supported
runtime, and contributor-ready release automation.

## Progress tracker

| Id  | Deliverable                                              | Status         | Sub-branch                         | PR  |
| --- | -------------------------------------------------------- | -------------- | ---------------------------------- | --- |
| K   | `vscode.l10n` bundle scaffolding + 2 starter locales     | 🟡 **Planned** | `feat/v0.9-l10n`                   | —   |
| L   | `contributes.walkthroughs` (4-step onboarding)           | 🟡 **Planned** | `feat/v0.9-walkthrough`            | —   |
| M   | Open VSX publishing (workflow + manifest hardening)      | 🟡 **Planned** | `feat/v0.9-openvsx`                | —   |
| N   | CI matrix (Node 20/22 × ubuntu/windows/macOS)            | 🟡 **Planned** | `feat/v0.9-ci-matrix`              | —   |
| O   | `CONTRIBUTING.md` refresh + release-notes automation     | 🔵 **Stretch** | `feat/v0.9-contrib-docs`           | —   |

Current metrics at integration HEAD (`main` @ `v0.8.0`):

- `tsc --noEmit` strict: clean.
- `vitest`: **978 / 978** deterministic.
- `dist/extension.js`: **98.93 KB** (100 KB v0.8 budget — **99 % used**).
- VSIX: **66.96 KB**.

> ⚠️ **Bundle pressure.** v0.8 burned the entire 100 KB budget. v0.9
> raises the documented cap to **125 KB** to absorb the l10n bundle
> tables (~15-25 KB). Every PR still reports `dist/extension.js` size in
> the description; any non-l10n PR that grows the bundle by more than
> +2 KB requires written justification in the PR body.

## Deliverable K — `vscode.l10n` bundle scaffolding

### Goal

Migrate every user-visible string emitted by the extension to
`vscode.l10n.t()` so VS Code (and downstream forks) can swap locale
without restart. Ship `bundle.l10n.json` as the canonical source plus
**two starter translations** (`it`, `es`) that prove the pipeline
end-to-end. The remaining eight locales (de, fr, pt, ja, zh, ko, ru,
plus a placeholder for community contributions) land in v0.9.x patch
releases.

### Contract

- All `vscode.window.show*Message`, `QuickPick` titles/placeholders,
  command titles, status-bar tooltips, walkthrough copy, and webview
  text routed through `vscode.l10n.t(key, ...args)`.
- Bundle file at repo root: `l10n/bundle.l10n.json` (English source).
- Per-locale overrides: `l10n/bundle.l10n.<locale>.json`.
- `package.nls.json` + `package.nls.<locale>.json` for manifest-level
  contributions (command titles, walkthrough labels).
- New `"l10n": "./l10n"` field in `package.json`.

### Implementation

- New folder `l10n/` checked in.
- Codemod pass: replace literal user-facing strings with
  `vscode.l10n.t(...)`; do **not** touch log messages, error stacks, or
  CLI flags.
- `package.nls.json` populated for every `contributes.commands.title`,
  `walkthroughs.title`, `walkthroughs.steps[*].title|description`.
- `.vscodeignore` updated to **include** `l10n/**` (currently excluded
  by the global `*` rule). Ensure `dist/` still ships.
- Add `npm run l10n:export` script using `@vscode/l10n-dev` to extract
  keys (dev-dependency only, not bundled).

### Tests (target ≥ 12)

- `test/l10n/bundleConsistency.test.ts` — every key in
  `bundle.l10n.it.json` and `bundle.l10n.es.json` must exist in the
  English bundle; placeholder count (`{0}`, `{1}`) must match.
- `test/l10n/manifestConsistency.test.ts` — every `%key%` reference in
  `package.json` exists in `package.nls.json` and the per-locale files.
- `test/l10n/coverage.test.ts` — grep for hardcoded `vscode.window.show*`
  string literals; allowlist tracked centrally.

### Definition of done

- `npm run compile`, `npm test`, `npm run build` all green.
- `dist/extension.js` ≤ 105 KB (l10n runtime is small; the JSON
  bundles ship as separate files inside the VSIX).
- VSIX size delta documented in PR body.

## Deliverable L — Walkthrough (`contributes.walkthroughs`)

### Goal

A 4-step onboarding flow shown to first-time users so they reach a
working `@warp /run` invocation without leaving VS Code.

### Steps

1. **Install Warp & login** — detect `oz` on PATH; if missing, link to
   install instructions and the Warp download page.
2. **Configure default environment** — open Settings UI scoped to
   `warpBridge.defaultEnvironment`, with `oz env list` output rendered
   in a markdown step description.
3. **Run `@warp /run hello`** — pre-fills the chat with the prompt;
   step marked complete on first successful run.
4. **Try Agent mode tools** — opens the Agent mode picker and explains
   the four `warp_*` Language Model Tools registered since v0.3.

### Implementation

- `contributes.walkthroughs` entry in `package.json` with id
  `warpBridge.gettingStarted`.
- Markdown step content under `media/walkthrough/`.
- Completion events: `onCommand:warpBridge.run.local` (step 3),
  `onLanguageModelToolRegistered:warp_run_local` (step 4 — fallback to
  `onView:warpBridge.sidebar`).
- Auto-open on first activation **only** when no prior run exists in
  history (gated by a new global state key
  `warpBridge.walkthrough.shown`).

### Tests (target ≥ 8)

- `test/ui/walkthrough.test.ts` — first-activation gating, completion
  detection per step, markdown sanitisation.

## Deliverable M — Open VSX publishing

### Goal

Make the extension installable on Cursor, VSCodium, Windsurf, Gitpod,
and Antigravity by publishing the same VSIX to **Open VSX** alongside
the Marketplace.

### Implementation

- New `release.yml` GitHub Actions workflow triggered on `tag: v*.*.*`:
  - Job `build`: install, test, build, package VSIX, upload artifact.
  - Job `publish-marketplace`: `vsce publish --packagePath` (gated on
    `VSCE_PAT` secret being present).
  - Job `publish-openvsx`: `npx ovsx publish --pat ${{ secrets.OVSX_PAT }} <vsix>`.
  - Job `publish-github-release`: idempotent `gh release create … --clobber`.
- `package.json` `repository`, `bugs`, `homepage`, `license`, `icon`
  fields validated by `vsce ls-publishers` rules.
- `README.md` install snippet for both registries.
- `docs/PUBLISHING.md` updated with the dual-publish playbook and the
  exact secret names required.

### Tests (target ≥ 4)

- `test/scaffold/manifestPublishingReadiness.test.ts` — required
  `package.json` fields present, `icon` resolvable, `repository.url`
  matches a `https://github.com/` URL, `engines.vscode` satisfies the
  Open VSX minimum.

## Deliverable N — CI matrix

### Goal

Catch platform-specific regressions before they reach a release tag.

### Matrix

- `node-version`: `[20.x, 22.x]`
- `os`: `[ubuntu-latest, windows-latest, macos-latest]`
- Total: **6 jobs** per PR.

### Implementation

- Replace the existing single-job CI workflow with a matrix in
  `.github/workflows/ci.yml`:
  - Steps: checkout, setup-node (with cache), `npm ci`, `npm run compile`,
    `npm test --run -- --reporter=verbose`, `npm run build`.
  - Upload `dist/extension.js` size as a job summary annotation.
- Add `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`
  to avoid double runs on rapid pushes.
- Add a separate `bundle-budget.yml` workflow that fails the PR if
  `dist/extension.js` exceeds 125 KB.

### Tests

CI surface only — no in-extension tests required.

## Deliverable O — `CONTRIBUTING.md` refresh & release notes (stretch)

### Goal

Lower the bar for external contributors and remove manual steps from
the release sequence.

### Implementation

- Rewrite `CONTRIBUTING.md` to reference the actual milestone playbook
  (deliverable PR per feature, squash-merge, release notes file).
- Optional: introduce `semantic-release` configuration that reads
  Conventional Commits and authors the GitHub Release. Gate behind a
  `release-bot.yml` workflow so manual releases continue to work.

## Risk log

- **R1 — Bundle delta too large.** l10n migration may add ~5-10 KB of
  call-site overhead. Mitigation: budget raised to 125 KB; per-PR size
  reporting enforced.
- **R2 — Open VSX namespace squat.** `sena-labs` namespace must be
  claimed before deliverable M lands. Mitigation: deliverable M's PR is
  blocked until the namespace is verified (manual step documented in
  `docs/PUBLISHING.md`).
- **R3 — Walkthrough timing on slow machines.** Step 3 completion event
  may race with the actual run. Mitigation: completion driven by
  `onCommand`, not by run terminal status.
- **R4 — CI flakiness on Windows runners.** Existing terminal mocks are
  Windows-friendly, but `vsce package` occasionally times out on
  cold-start runners. Mitigation: pin `@vscode/vsce` to the version
  used locally; retry once on failure.

## Out of scope

- Telemetry (deferred to v1.0).
- GIF generation pipeline (manual screenshots stay in `media/` for
  now; v0.9.x patch can add an `asciicast`-based recorder).
- Additional translations beyond `it` and `es` (handled in v0.9.x or
  via community PRs).
- `semantic-release` enforcement (kept as the optional deliverable O).

## Definition of done — milestone

1. Five deliverables (K-N mandatory, O optional) merged into `main`
   via squash PRs.
2. Bundle ≤ 125 KB; VSIX ≤ 90 KB.
3. `vitest` ≥ 1010 tests (978 baseline + ~32 new).
4. `release.yml` runs to completion against `v0.9.0` tag and uploads to
   both registries.
5. `RELEASE-NOTES-v0.9.0.md` written; `release/v0.9.x` branch cut.
