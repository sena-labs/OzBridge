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
