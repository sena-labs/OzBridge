# Next development steps — v0.7 remainder
This document is the actionable counterpart to
[`MILESTONE-v0.7.md`](./MILESTONE-v0.7.md). It tells whoever picks the
milestone back up *exactly what to do next*, in order, without
re-reading the full roadmap.
## Current state (as of v0.7.0-alpha.1)
- Integration branch: `feat/v0.7-team-drive` @ `3fae81d`.
- Shipped: deliverable **D** (workspace-config YAML overrides) + its
  self-review follow-ups.
- Remaining: **A**, **B**, **C** (core) and **E** (stretch).
- Tests: 723 / 723. Bundle: 64 KB.
## Execution order
Follow the sequence below. Every step assumes the previous one is
merged into `feat/v0.7-team-drive`. Do *not* chain sub-branches — keep
each sub-PR rooted on the integration branch so rollbacks stay cheap.
### Step 1 — Deliverable A (Warp Drive browser)
Branch: **`feat/v0.7-drive-browser`**
1. Create the branch off `feat/v0.7-team-drive`.
2. Scaffold the `src/drive/` folder with the 4 modules listed in the
   milestone doc (`IWarpDriveSource`, `cliDriveSource`,
   `fileSystemDriveSource`, `driveSourceFactory`).
3. Add `src/ui/driveTreeProvider.ts` + `driveCommands.ts`. Register
   the view + commands in `src/extension.ts` next to the existing
   run tree wiring.
4. Extend `package.json`:
   - new view `warpBridge.driveView` under `warpBridgeSidebar`;
   - new commands + menu entries (see milestone doc).
5. Write the four test suites targeting **≥ 25** new tests.
6. Validate: `npm run compile`, `npm test`, `npm run build`.
7. Commit, push, open PR → `feat/v0.7-team-drive`. Self-review.
8. After merge, cut `v0.7.0-alpha.2`.
**Success criteria**
- `@warp /drive` / Command Palette → *Warp Drive: Browse* opens the view.
- Right-click *Insert into chat* pre-fills the Copilot Chat editor.
- No regression on the existing 723 tests.
### Step 2 — Deliverable B (Skill & Rules Monaco editor)
Branch: **`feat/v0.7-skill-editor`**
1. Branch from the updated `feat/v0.7-team-drive`.
2. Implement `src/services/frontmatterValidator.ts` first (pure
   function, easy to test).
3. Build the webview panel host + HTML/JS. Keep webview assets in
   `src/ui/webview/` and ship them verbatim from the VSIX (listed in
   `.vscodeignore` `!` allow-list).
4. Extend `test/mocks/vscode.ts` with
   `window.createWebviewPanel` + `WebviewPanel` + `Webview` stubs.
5. Wire the *Edit* context-menu entry from the drive tree (from A) to
   the new editor command.
6. Write tests (**≥ 20**).
7. Validate, commit, push, PR, review, merge.
**Success criteria**
- Editor round-trips: open existing skill → edit → save →
  `fs.readFileSync` confirms content.
- CSP is non-empty; nonce is unique per panel instance.
- Frontmatter validator flags missing `name` / `description` inline.
### Step 3 — Deliverable C (`/init` v2 QuickPick)
Branch: **`feat/v0.7-init-v2`**
1. Rewrite `src/commands/initCommand.ts` as `initV2Command.ts`.
   Preserve the legacy `@warp /init all` behaviour with a guard in
   the new handler.
2. Extract the skill templates into `src/scaffold/skillTemplates.ts`.
3. Implement `src/scaffold/skillWriter.ts` with atomic rename.
4. Update existing `/init` tests (`test/commands/initCommand.test.ts`
   + `initCommandEdge.test.ts`) to match the new contract.
5. Write new tests (**≥ 15**).
6. Validate, commit, push, PR, review, merge.
7. After merge, cut `v0.7.0-beta.1`.
**Success criteria**
- Running `/init` twice consecutively → second invocation shows
  `[exists]` next to every skill and asks before overwriting.
- `/init all` still writes every file unconditionally.
### Step 4 — Deliverable E (MCP auto-registration)
Branch: **`feat/v0.7-mcp-autoregister`**
This step is **stretch**. Skip if the first three consume the
milestone budget; schedule as `v0.7.1` instead.
1. Implement `IMcpClientRegistrar` + the 3 strategies (Claude, Cursor,
   Codex). JSON strategies use `JSON.parse` + atomic rename; the TOML
   strategy needs a minimal line-based writer (only `[[mcp.servers]]`
   tables).
2. Register the two commands in `src/mcp/lifecycle.ts`.
3. Tests per strategy (**≥ 15** total) running against a temp
   directory.
4. Validate, commit, push, PR, review, merge.
### Step 5 — Release v0.7.0
Follow the v0.6.0 playbook from memory; do not deviate.
1. Create `feat/v0.7-release-notes` off `feat/v0.7-team-drive`.
2. Bump `package.json` + `package-lock.json` → `0.7.0`.
3. Sync `EXTENSION_VERSION` in `src/extension.ts`.
4. Consolidate CHANGELOG: every `v0.7/*` Added bullet currently under
   `[Unreleased]` moves into `[0.7.0] — <release date>`. Reset
   `[Unreleased]` to `_No changes yet._`.
5. Author `docs/RELEASE-NOTES-v0.7.0.md` mirroring
   `docs/RELEASE-NOTES-v0.6.0.md`.
6. Run `npm run compile`, `npm test`, `npm run package`. Capture the
   VSIX SHA-256.
7. Open PR `feat/v0.7-release-notes` → `feat/v0.7-team-drive`. Merge.
8. Open single PR `feat/v0.7-team-drive` → `main`. Merge.
9. Tag `v0.7.0` on the merge commit, push.
10. `gh release create v0.7.0 warp-vsc-bridge.vsix --notes-file
    docs/RELEASE-NOTES-v0.7.0.md --title "v0.7.0 - Team and Drive"`.
11. Archive: branch `release/v0.7.x` from the tag; push.
12. Open the v0.8 cycle: bump `main` to `0.8.0-dev`, drop
    `docs/MILESTONE-v0.8.md`, branch `feat/v0.8-…`.
## Risk log
- **Webview CSP regressions** (B) — keep the nonce helper centralised
  and assert its uniqueness in a test.
- **Oz CLI Drive endpoint absence** (A) — implementation must silently
  fall back to the filesystem source and log a single info message at
  activation, never a warning.
- **File clobbering** (C, E) — always write to `<file>.tmp` then
  `fs.renameSync`. Never write directly on top of the user's file.
- **Parallel test contention** (C) — the workspace-config tests run
  on `fileParallelism: false` already; keep any new filesystem
  tests consistent with that mode.
## Definition of done for v0.7.0
- Tests: **≥ 800** total, zero flakes, deterministic.
- Bundle: **≤ 90 KB**.
- VSIX: **≤ 70 KB**.
- README + CHANGELOG + `docs/MCP.md` all reflect the final surface.
- `v0.7.0` tag and GitHub Release live, with VSIX attached.
- `release/v0.7.x` branch created from the tag.
## Out of scope
Anything under *Out-of-scope* in `MILESTONE-v0.7.md`. If a new idea
surfaces during execution, file it as a bullet in the v0.8 section of
the main roadmap; do not expand v0.7 scope.
