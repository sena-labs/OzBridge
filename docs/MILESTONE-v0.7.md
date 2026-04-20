# Milestone v0.7 — "Team & Drive"
**Target version:** `0.7.0`
**Development branch:** `feat/v0.7-team-drive`
**Release branch (after ship):** `release/v0.7.x`
**Depends on:** `v0.6.0` (MCP server export) already on `main`.
## Strategic message
> Your Warp organisation (Drive, Rules, Skills) is **browsable,
> editable, and applicable** directly from VS Code.
v0.6 made Warp Bridge a first-class citizen for *external* MCP clients.
v0.7 turns it into a first-class citizen for *team-shared Warp
resources*: the Warp Drive catalogue, skill definitions, and project
rules become navigable and editable without leaving the IDE.
## Competitive positioning
- **`AbelMak.skills-sh`** (202 installs) — generic skill package
  manager. We ship Warp-native skills with inline preview and direct
  promote-to-Drive.
- **`Swarmify.swarm-ext`** (211 installs) — team orchestration via
  MCP. We layer team config on top of the Oz CLI directly.
## Deliverables
### A. Warp Drive browser
- New command `warpBridge.drive.browse` + dedicated sidebar view
  `warpBridge.driveView` under the existing `warpBridgeSidebar`
  container.
- `TreeDataProvider<DriveNode>` with collections:
  - **Prompts** — saved Warp Drive prompts (via Oz CLI endpoint when
    available, fallback: parse `~/.warp/drive/prompts/*.md`).
  - **Rules** — shared rules library.
  - **Skills** — organisation-wide skill definitions.
- Context-menu action *Insert into chat* → pre-fills
  `@warp /run "<prompt content>"` in the Copilot Chat panel.
- Context-menu action *Copy content* and *Open in editor*.
### B. Skill & Rules editor (Monaco webview)
- New webview panel opened via `warpBridge.skill.edit` /
  `warpBridge.rule.edit`.
- Monaco instance with:
  - Markdown live preview split view.
  - Frontmatter YAML validator (report errors inline).
  - Action buttons:
    - *Save as global skill* → `~/.agents/skills/<name>/SKILL.md`
    - *Save as project skill* → `.agents/skills/<name>/SKILL.md`
    - *Promote to Warp Drive* (no-op if Drive API is not available;
      surfaces a *Copy for manual upload* fallback)
- `.warp/rules/*.md` files follow the same flow via
  `warpBridge.rule.edit`.
### C. `/init` v2
- Replace the fire-and-forget scaffolder with a QuickPick that lets
  the user choose which of the 7 agent-pipeline skills to create,
  shows a preview of the template body, and supports
  add / re-scaffold / skip per file.
- Keep backwards-compatible `@warp /init all` shortcut for the
  existing behaviour.
### D. Per-workspace config `.warp/warp-bridge.yaml`
- Optional file checked into Git. Supports overrides of
  `defaultProfile`, `defaultEnvironment`, `timeoutMs`,
  `cloudPollingTimeoutMs`, `mcpEnabled`, `mcpPort`,
  `mcpBearerToken` (if surfaced via env var, never literal).
- Precedence: workspace YAML > VS Code settings > defaults.
- New service `src/services/workspaceConfigResolver.ts` that merges
  both sources into a `WarpBridgeConfig` snapshot and fires
  `onConfigChanged` when either side changes.
### E. MCP auto-registration (stretch)
- `warpBridge.mcp.registerClient` command that appends the current
  MCP endpoint into:
  - `~/.claude.json`
  - `~/.cursor/mcp.json`
  - `~/.codex/config.toml`
- Opt-in via QuickPick; inverse command `.unregisterClient` removes
  the entry.
## Non-goals
- Full Warp Drive *sync* (push new prompts back to the Drive API) —
  we only *browse + copy-down* in v0.7. Push is scoped for v0.8.
- Rich conflict resolution on multi-user edits — concurrent editing
  is out of scope.
- Skill marketplace UI — we integrate with existing community
  registries where possible, we don't build our own.
## Dependencies between deliverables
- **A → B** — Drive browser supplies the seed content for the editor
  (*Edit existing prompt / rule / skill*).
- **B → C** — `/init` v2 reuses the editor's template renderer to
  show inline previews.
- **D** is independent and can land first; useful regardless of A–C.
- **E** reuses the MCP lifecycle shipped in v0.6.
## Test budget
- Target: **≥ 2.0 : 1** test-to-code ratio on new modules.
- New mock surface expected: `vscode.WebviewPanel`,
  `WebviewView`, `workspace.openTextDocument`,
  `TextEditor.edit`, `QuickPick` / `InputBox` flows, plus the
  filesystem writes for `~/.agents/skills/…`.
## Size budget
- `dist/extension.js` must stay **≤ 90 KB** after v0.7 (current
  baseline: 59 KB). Webview HTML is served as a static string
  resource, not bundled.
- VSIX must stay **≤ 70 KB**. Monaco is loaded from VS Code, not
  shipped.
## Timeline guidance
Four sub-PRs so each deliverable stays reviewable:
1. `feat/v0.7-workspace-config` — deliverable **D**.
2. `feat/v0.7-drive-browser` — deliverable **A**.
3. `feat/v0.7-skill-editor` — deliverable **B**.
4. `feat/v0.7-init-v2` — deliverable **C**.
5. *(optional)* `feat/v0.7-mcp-autoregister` — deliverable **E**.
All merged into `feat/v0.7-team-drive`, which targets `main` as a
single v0.7.0 merge PR. Release follows the v0.6.0 playbook:
consolidate `[Unreleased]` → `[0.7.0]`, bump version, tag, publish.
## Out-of-scope but noted for v0.8+
- Cloud run steering mid-flight.
- Cloud run webview monitor (timeline + diff viewer).
- Dashboard analytics.
See the full roadmap in the v0.3 → v1.0 plan for details.
