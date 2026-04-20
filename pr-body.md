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
