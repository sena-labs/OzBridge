# Next steps — v1.0 "GA"

This file is the **operational** companion to
[`MILESTONE-v1.0.md`](./MILESTONE-v1.0.md). It lists the concrete PRs
to open, in order, to reach `v1.0.0`. Use the same deliverable-PR
playbook documented in [`CONTRIBUTING.md`](../CONTRIBUTING.md):

1. Branch `feat/v1.0-<slug>` from synced `main`.
2. Implement the smallest complete slice.
3. Add tests (≥ 1.5 : 1 ratio on changed code).
4. Validate (`npm run compile && npm test -- --run && npm run build`).
5. Prepend a `CHANGELOG.md` `[Unreleased]` bullet.
6. Write `pr-body.md` (**What / Verification / Next**).
7. `gh pr create` + `gh pr merge --squash --delete-branch --auto`.

## Step 1 — Deliverable P (Telemetry opt-in)

Branch: **`feat/v1.0-telemetry`**

1. Add `@vscode/extension-telemetry` to `dependencies`.
2. Implement `src/services/telemetry.ts` exporting `ITelemetryReporter`,
   `NoopReporter`, `AppInsightsReporter`.
3. Wire `reporter.activate(context)` in `extension.ts#activate`; emit
   `extensionActivated` with the version constant.
4. Emit `commandInvoked`, `runStarted`, `runCompleted`, `errorRaised`
   from the existing command router and run poller. **No** prompt
   content, paths, IDs.
5. Add deny-list test: every property of every event payload is
   asserted against `/prompt|content|output|path|workspace|runId/i`.
6. Add `PRIVACY.md` at repo root, link from walkthrough's last step
   (`media/walkthrough/04-mcp-bridge.md`).
7. Add settings `ozBridge.telemetry.connectionString` (default `""`,
   meaning noop).
8. Validate, CHANGELOG, PR, merge.

## Step 2 — Deliverable Q (Security gates)

Branch: **`feat/v1.0-security`**

1. Add `.github/workflows/codeql.yml` (`javascript-typescript`,
   `pull_request` + `push` to main, weekly schedule).
2. Add `.github/dependabot.yml` for `npm` + `github-actions`.
3. Append `npm audit --audit-level=high` step to `ci.yml` (advisory
   `continue-on-error: true` for v1.0; promote to blocking in v1.1).
4. Update `SECURITY.md` with a triage SLA table.
5. Tests assert workflow shape, dependabot config, and SECURITY/PRIVACY
   files exist.
6. Validate, CHANGELOG, PR, merge.

## Step 3 — Deliverable R (Performance budgets)

Branch: **`feat/v1.0-perf-budgets`**

1. Add `npm run perf:bench` script (`vitest --run test/perf`).
2. Implement `test/perf/activation.bench.test.ts`:
   - Build a mock `ExtensionContext`.
   - Measure `activate(ctx)` median over 50 runs after 5-run warm-up.
   - Assert median ≤ 200 ms × 2 (tolerance) on CI.
3. Add `test/perf/sidebar.bench.test.ts` for first-paint approximation.
4. Add `.github/workflows/perf-budget.yml` running the perf suite +
   summary table; failure hard-blocks PR.
5. Validate, CHANGELOG, PR, merge.

## Step 4 — Deliverable S (Accessibility)

Branch: **`feat/v1.0-a11y`**

1. Add `src/ui/webview/a11yHelpers.ts` (skip-link wrapper, ARIA-label
   asserter, contrast token validator).
2. Audit each existing webview, add `aria-*`, semantic roles, `lang`,
   `title`, `--vscode-*` colour tokens.
3. Snapshot tests under `test/ui/a11y/` per webview.
4. Document the per-webview state in `docs/A11Y-CHECKLIST.md`.
5. Validate, CHANGELOG, PR, merge.

## Step 5 — Deliverable T (Kill-switch + LTS)

Branch: **`feat/v1.0-killswitch-lts`**

1. Implement `src/services/featureFlags.ts` (`StaticFlags`,
   `RemoteFlags` with 5-minute TTL, fail-open).
2. Wire into `extension.ts#activate`; gate v1.0 features
   (`telemetry`, `dashboard`, `runMonitor`).
3. Add `docs/LTS.md` (12-month patch support policy).
4. Validate, CHANGELOG, PR, merge.

## Step 6 — Release v1.0.0

Same playbook as `v0.9.0`:

1. Bump `package.json` + `EXTENSION_VERSION` → `1.0.0`.
2. Promote `[Unreleased]` to `[1.0.0] — <date>`.
3. Author `docs/RELEASE-NOTES-v1.0.0.md`.
4. Validate, package, tag, release with VSIX asset.
5. Cut `release/v1.0.x` branch from the tag.
6. Confirm `publish.yml` runs both registries; if `VSCE_PAT` /
   `OVSX_PAT` are still missing, document the gap in the release
   notes.

## Risk log

See [`MILESTONE-v1.0.md`](./MILESTONE-v1.0.md) §Risk log. Highest
attention items:

- **Telemetry connection string** must be empty by default until the
  Sena Labs Application Insights workspace is provisioned. Without it
  the SDK still bundles cleanly but the transport is noop.
- **`VSCE_PAT` rotation** still pending from v0.7.x — Marketplace
  publish job will continue to warn-skip until rotated.

## Out of scope

Anything under `MILESTONE-v1.0.md` §Out of scope. New ideas surfacing
mid-execution go to a v1.1 backlog bullet, not into this milestone.
