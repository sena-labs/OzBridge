# Next development steps — v0.9 (Reach)

This is the actionable counterpart to
[`MILESTONE-v0.9.md`](./MILESTONE-v0.9.md). Whoever picks the milestone
back up reads only this file to know **what to do next, in order**.

## Current state (as of `v0.8.0`)

- `main` HEAD: `df5e0f7` (`chore(packaging): exclude .vsix from VSIX bundle`).
- Tests: **978 / 978** deterministic.
- Bundle: **98.93 KB** (100 KB v0.8 cap → **99 % used**, raised to 125 KB
  for v0.9 in the kickoff PR).
- VSIX: **66.96 KB**.
- No open PRs, no open issues.

## Execution order

Each step lands its own PR on `main` (no long-lived integration branch).
Mark the corresponding row in the milestone tracker as soon as the PR
lands. Every PR description must include the post-PR `dist/extension.js`
size and the test count.

### Step 0 — Bootstrap (this PR)

Branch: **`feat/v0.9-bootstrap`**

1. Add `docs/MILESTONE-v0.9.md`.
2. Add `docs/NEXT-STEPS-v0.9.md` (this file).
3. Add a `## [Unreleased]` entry to `CHANGELOG.md` documenting the
   bundle-budget bump from 100 KB to 125 KB.
4. No code changes.

### Step 1 — Deliverable K (`vscode.l10n` bundle)

Branch: **`feat/v0.9-l10n`**

1. Create `l10n/bundle.l10n.json` from extracted strings.
2. Migrate `vscode.window.show*`, `QuickPick` titles/placeholders, and
   webview headers to `vscode.l10n.t()`.
3. Author `package.nls.json` and `package.nls.it.json` /
   `package.nls.es.json`.
4. Add `"l10n": "./l10n"` to `package.json`; update `.vscodeignore` to
   include `l10n/**`.
5. Add `npm run l10n:export` (using `@vscode/l10n-dev`).
6. Tests (≥ 12): bundle key consistency, manifest `%key%` consistency,
   hardcoded-string allowlist.
7. Validate: `npm run compile`, `npm test`, `npm run build`.
8. Open PR with bundle size + VSIX size reported.

### Step 2 — Deliverable L (Walkthrough)

Branch: **`feat/v0.9-walkthrough`**

1. Add `contributes.walkthroughs` entry (id
   `warpBridge.gettingStarted`) with 4 steps.
2. Author markdown content under `media/walkthrough/`.
3. Implement first-activation gating via global state
   (`warpBridge.walkthrough.shown`).
4. Tests (≥ 8): gating, per-step completion, markdown sanitisation.
5. Validate, PR, merge.

### Step 3 — Deliverable M (Open VSX publishing)

Branch: **`feat/v0.9-openvsx`**

1. Verify the `sena-labs` namespace claim on Open VSX (manual; document
   in `docs/PUBLISHING.md`).
2. Replace/extend `.github/workflows/release.yml` with three publish
   jobs (Marketplace, Open VSX, GitHub Release).
3. Harden `package.json` publishing fields (`repository`, `bugs`,
   `homepage`, `license`, `icon`).
4. Update `README.md` install section with both registries.
5. Tests (≥ 4): manifest publishing-readiness assertions.
6. Validate, PR, merge.

### Step 4 — Deliverable N (CI matrix)

Branch: **`feat/v0.9-ci-matrix`**

1. Rewrite `.github/workflows/ci.yml` as a 2 × 3 matrix (Node 20/22 ×
   ubuntu/windows/macos).
2. Add `bundle-budget.yml` workflow asserting `dist/extension.js` ≤
   125 KB.
3. Add `concurrency.cancel-in-progress` to both workflows.
4. Validate locally with `act` (or by opening a draft PR).
5. PR, merge.

### Step 5 — Deliverable O (Contributing docs, stretch)

Branch: **`feat/v0.9-contrib-docs`**

Skip if Steps 1-4 consume the milestone budget; reschedule as `v0.9.1`.

1. Rewrite `CONTRIBUTING.md` with the deliverable-PR playbook.
2. (Optional) Add `semantic-release` config + `release-bot.yml`.

### Step 6 — Release v0.9.0

Same playbook as `v0.8.0`:

1. Bump `package.json` + `EXTENSION_VERSION` → `0.9.0`.
2. Promote `[Unreleased]` to `[0.9.0] — <date>`.
3. Author `docs/RELEASE-NOTES-v0.9.0.md`.
4. Validate, package, tag, release with VSIX asset.
5. Cut `release/v0.9.x` branch from the tag.
6. Confirm `release.yml` published to both registries; if `OVSX_PAT` /
   `VSCE_PAT` are missing, document the gap in the release notes.

## Risk log

See [`MILESTONE-v0.9.md`](./MILESTONE-v0.9.md) §Risk log. Highest
attention items:

- **VSCE_PAT is currently expired** (TF400813 from v0.7.x release). It
  must be rotated before deliverable M's `release.yml` lands, otherwise
  the Marketplace publish step will fail every release.
- **Open VSX namespace** must be claimed manually under `sena-labs` —
  blocking deliverable M.

## Out of scope

Anything under `MILESTONE-v0.9.md` §Out of scope. Ideas that surface
mid-execution go to a v1.0 backlog bullet, not into this milestone.
