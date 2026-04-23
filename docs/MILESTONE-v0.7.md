# Milestone v0.7 — "Team & Drive"
**Target version:** `0.7.0`
**Integration branch:** `feat/v0.7-team-drive`
**Release branch (after ship):** `release/v0.7.x`
**Depends on:** `v0.6.0` (MCP server export) already on `main`.
**Latest snapshot:** [`v0.7.0-alpha.1`](https://github.com/sena-labs/warp-vsc-bridge/releases/tag/v0.7.0-alpha.1)
## Strategic message
> Your Warp organisation (Drive, Rules, Skills) is **browsable,
> editable, and applicable** directly from VS Code.
v0.6 made OzBridge a first-class citizen for *external* MCP clients.
v0.7 turns it into a first-class citizen for *team-shared Warp
resources*: the Warp Drive catalogue, skill definitions, and project
rules become navigable and editable without leaving the IDE.
## Progress tracker
| Id | Deliverable | Status | Sub-branch | PR | Lands at |
| --- | --- | --- | --- | --- | --- |
| D | Per-workspace YAML overrides | ✅ **Merged** | `feat/v0.7-workspace-config` | [#3](https://github.com/sena-labs/warp-vsc-bridge/pull/3) | `cba29f2` |
| — | Self-review follow-ups | ✅ **Merged** | `feat/v0.7-config-followups` | [#4](https://github.com/sena-labs/warp-vsc-bridge/pull/4) | `3fae81d` |
| A | Warp Drive browser | 🟡 **Planned** | `feat/v0.7-drive-browser` | — | — |
| B | Skill & Rules Monaco editor | 🟡 **Planned** | `feat/v0.7-skill-editor` | — | — |
| C | `/init` v2 QuickPick | 🟡 **Planned** | `feat/v0.7-init-v2` | — | — |
| E | MCP auto-registration (stretch) | 🔵 **Stretch** | `feat/v0.7-mcp-autoregister` | — | — |
Current metrics at integration HEAD:
- `tsc --noEmit` strict: clean.
- `vitest`: 723 / 723 across 47 files, deterministic.
- `dist/extension.js`: ≈ 64 KB (90 KB budget → 71 % used).
- VSIX: 49.9 KB / 11 files.
## Deliverable A — Warp Drive browser
### Goal
A dedicated Activity Bar view that lists the organisation's shared
prompts, rules and skills so they can be inserted into a chat, copied,
or opened for editing without leaving VS Code.
### Modules
- `src/drive/warpDriveSource.ts` — `interface IWarpDriveSource` with
  `listPrompts(): Promise<DrivePrompt[]>`,
  `listRules(): Promise<DriveRule[]>`, `listSkills(): Promise<DriveSkill[]>`,
  `read(id: string): Promise<string>`.
- `src/drive/cliDriveSource.ts` — implementation that shells out to
  `oz drive list` / `oz drive get` when the Oz CLI exposes the endpoint.
- `src/drive/fileSystemDriveSource.ts` — fallback reading
  `~/.warp/drive/prompts/*.md`, `~/.agents/rules/*.md`,
  `~/.agents/skills/*/SKILL.md`.
- `src/drive/driveSourceFactory.ts` — chooses CLI or FS based on a
  one-shot capability probe at activation.
- `src/ui/driveTreeProvider.ts` — `TreeDataProvider<DriveNode>` with 3
  category roots (`prompts`, `rules`, `skills`) and leaf nodes keyed by
  `<source>:<id>`. Auto-refresh is **manual only** (a refresh command in
  the view title bar) — no background polling.
- `src/ui/driveCommands.ts` — context-menu handlers
  `ozBridge.drive.insertIntoChat`, `.copyContent`, `.openInEditor`,
  `.edit` (deliverable B hand-off), and `.refresh`.
### Manifest additions
- `contributes.viewsContainers.activitybar.ozBridgeSidebar` already
  exists; add a second view entry `ozBridge.driveView` alongside
  `ozBridge.runsView`.
- 5 new `contributes.commands` entries under category `Warp Drive`.
- 4 `contributes.menus.view/item/context` entries gated on the right
  `contextValue` (`warpDrivePrompt`, `warpDriveRule`, `warpDriveSkill`).
### Tests (target ≥ 25)
- `test/drive/fileSystemDriveSource.test.ts` (fs read + parse frontmatter).
- `test/drive/cliDriveSource.test.ts` (mock `IOzCliService` + JSON parsing).
- `test/ui/driveTreeProvider.test.ts` (3 categories, empty / populated / error).
- `test/ui/driveCommands.test.ts` (every command, happy + no-selection paths).
### Acceptance
- `@oz /drive` (optional alias) or Command Palette → *Warp Drive: Browse*
  focuses the sidebar view and loads content in ≤ 300 ms on a cached
  `IWarpDriveSource`.
- Right-click *Insert into chat* pre-fills `@oz /run "<content>"` in
  the Copilot Chat editor via the existing
  `workbench.action.chat.open` command.
## Deliverable B — Skill & Rules Monaco editor
### Goal
Rich in-extension editing of `SKILL.md` and rule files with markdown
live preview and frontmatter validation. Consumable from anywhere the
user can reach a skill or rule (Drive browser, explorer, command
palette).
### Modules
- `src/ui/skillEditorPanel.ts` — `vscode.WebviewPanel` wrapper.
  Handles CSP, nonce, restore-on-reload, and `postMessage` protocol.
- `src/ui/webview/skillEditor.html` + `.css` + `.js` — Monaco + split
  preview. Loaded from disk and cached; no bundling, no Monaco shipped.
- `src/services/frontmatterValidator.ts` — thin wrapper around the
  existing `yamlParser.ts` that only accepts the skill/rule frontmatter
  schema (`name`, `description`, optional `model`, `tags`).
- `src/ui/skillEditorCommands.ts` — commands
  `ozBridge.skill.edit <path>`, `.rule.edit <path>`,
  `.skill.new`, `.skill.saveGlobal`, `.skill.saveWorkspace`,
  `.skill.promoteToDrive` (delegates to `IWarpDriveSource.upload?` or
  falls back to a *Copy for manual upload* modal).
### Webview protocol
```
host → webview  init           { path, content }
host → webview  applyEdits     { edits }
webview → host  ready
webview → host  save           { content }
webview → host  validate       { frontmatter }  // debounced 300 ms
webview → host  telemetry      { event, durationMs }
```
### Tests (target ≥ 20)
- `test/services/frontmatterValidator.test.ts` — schema happy + every
  error case.
- `test/ui/skillEditorPanel.test.ts` — host ↔ webview message round-trip
  via a new `vscode.window.createWebviewPanel` stub in the mock.
- `test/ui/skillEditorCommands.test.ts` — save targets (global /
  workspace), promote-to-Drive fallback, unsupported extension refusal.
### Acceptance
- Editor opens a 50 KB skill file and renders the first paint in ≤ 400 ms
  on a reference dev box.
- Saving writes an atomic rename (`.tmp` → final) so partial files
  never land on disk.
- Frontmatter validation shows inline diagnostics when a required key
  is missing.
## Deliverable C — `/init` v2 QuickPick
### Goal
Replace the current fire-and-forget `/init` scaffolder with an
opt-in-per-file QuickPick that shows live previews and supports
re-scaffolding only some of the 7 pipeline skills without clobbering
local edits.
### Modules
- `src/commands/initV2Command.ts` — new handler replacing the legacy
  `initCommand.ts`. Exported as `createInitV2Command()` to match the
  existing pattern.
- `src/scaffold/skillTemplates.ts` — in-memory registry keyed by skill
  name, returning frontmatter + body strings. Re-used by deliverable B
  for the *Insert template* action.
- `src/scaffold/skillWriter.ts` — atomic writer with overwrite
  protection (prompts before clobbering an existing file).
### UX
1. `@oz /init` → QuickPick with 7 rows, each showing name +
   description + current on-disk state (`[new]`, `[exists]`,
   `[modified]`).
2. Multi-select → confirmation with diff preview for each `[modified]`
   entry.
3. Progress notification while writing; final summary in chat with
   per-file status.
4. `@oz /init all` keeps working as the legacy bulk shortcut.
### Tests (target ≥ 15)
- `test/commands/initV2Command.test.ts` — QuickPick cancel, single
  selection, multi-selection, `all` shortcut, overwrite decline,
  overwrite accept, filesystem error handling.
- `test/scaffold/skillWriter.test.ts` — atomic write, failure
  rollback, existing-file detection.
### Acceptance
- Running `/init` twice in a row yields no destructive writes unless
  the user explicitly confirms an overwrite.
- Existing users of `/init all` see zero behavioural regression.
## Deliverable E — MCP auto-registration (stretch)
### Goal
One-click insertion of the local MCP endpoint into the well-known
client config files. Strictly opt-in and reversible.
### Modules
- `src/mcp/clientRegistration.ts` — strategy interface
  `IMcpClientRegistrar` with `register(cfg)` / `unregister(cfg)` /
  `status(): 'registered' | 'absent' | 'other-endpoint'`.
- `src/mcp/registrars/claudeCodeRegistrar.ts` — edits
  `~/.claude.json` (JSON, atomic write).
- `src/mcp/registrars/cursorRegistrar.ts` — edits
  `~/.cursor/mcp.json` (JSON, atomic write).
- `src/mcp/registrars/codexRegistrar.ts` — edits
  `~/.codex/config.toml` via a minimal zero-dep TOML writer
  (only needs to append/remove a named `[[mcp.servers]]` entry).
### Commands
- `ozBridge.mcp.registerClient` — QuickPick picks which clients to
  register; updates each; shows per-client status.
- `ozBridge.mcp.unregisterClient` — inverse; removes entries whose
  `url` matches the current endpoint.
### Tests (target ≥ 15)
- One suite per registrar hitting a temp directory, covering:
  pristine file, existing unrelated entries, existing entry we own,
  existing entry from another endpoint (must ask before clobber).
- `test/mcp/clientRegistration.test.ts` — orchestration of all three.
### Acceptance
- Registrations are idempotent (no duplicate entries).
- Unregistering never touches entries not created by us.
- Endpoint changes (e.g. user switches port) trigger a QuickPick that
  offers to update every registered client.
## Non-goals
- Full Warp Drive *sync* (push new prompts back to the Drive API).
  Browse + copy-down only; push is scoped for v0.8.
- Rich conflict resolution on multi-user edits — concurrent editing
  is out of scope.
- Skill marketplace UI — we integrate with existing community
  registries where possible, we don't build our own.
## Dependencies between deliverables
- **A → B** — Drive browser supplies the seed content for the editor
  (*Edit existing prompt / rule / skill*). B can still ship before A
  by opening files directly; A simply adds another entry point.
- **B → C** — `/init` v2 reuses the editor's template renderer to
  show inline previews. Not a hard block: `/init` v2 can also render
  previews in a markdown QuickPick detail until B lands.
- **D** ✅ — already merged, independent.
- **E** reuses the MCP lifecycle shipped in v0.6. Independent of A/B/C.
## Test budget
- Target: **≥ 2.0 : 1** test-to-code ratio on new modules.
- New mock surfaces expected:
  - `vscode.window.createWebviewPanel` + `WebviewPanel` + `Webview`
    (deliverable B).
  - `vscode.window.showQuickPick` with full options typing
    (deliverable C).
  - Filesystem-writing helpers (deliverable E — already exercised by
    the workspace-config tests).
## Size budget
- `dist/extension.js` must stay **≤ 90 KB** after v0.7. Current: 64 KB.
  Expected growth:
  - A: +8 KB (tree provider + CLI source).
  - B: +6 KB (panel host; Monaco is loaded from VS Code).
  - C: +3 KB (QuickPick + template renderer).
  - E: +4 KB (3 registrars + orchestration).
  Total projected: ≈ 85 KB — ~ 94 % of budget, within target.
- VSIX must stay **≤ 70 KB**. Current: 50 KB.
## Timeline guidance
Ordered sub-PR sequence (after D):
1. `feat/v0.7-drive-browser` — deliverable **A**.
2. `feat/v0.7-skill-editor` — deliverable **B**.
3. `feat/v0.7-init-v2` — deliverable **C**.
4. `feat/v0.7-mcp-autoregister` — deliverable **E** (stretch).
Each sub-PR targets `feat/v0.7-team-drive`. Once all four are merged,
cut `v0.7.0-beta.1` as a final sanity check, then promote to the
`v0.7.0` release commit on `main`.
### Release cadence
- `v0.7.0-alpha.1` — D + follow-ups ✅ (snapshot already published).
- `v0.7.0-alpha.2` — A merged.
- `v0.7.0-beta.1` — A + B + C merged.
- `v0.7.0` — final, follows the v0.6.0 playbook (consolidate
  `[Unreleased]` → `[0.7.0]`, tag, publish).
## Out-of-scope but noted for v0.8+
- Cloud run steering mid-flight.
- Cloud run webview monitor (timeline + diff viewer).
- Dashboard analytics.
See the full roadmap in the v0.3 → v1.0 plan for details.
