---
status: draft · work in progress
targeted-release-date: TBD (when deliverables A-UI, B, C merge)
---
# Warp Bridge for VS Code — v0.7.0 (draft)
> **⚠️ Work in progress.** This document is the running draft of the
> v0.7.0 release notes. It is kept in sync with `feat/v0.7-team-drive`
> as sub-PRs land. The final version will replace this note with a
> release date and asset metadata, following the same playbook as
> `docs/RELEASE-NOTES-v0.6.0.md`.
**Publisher:** `sena-labs`
**Integration branch:** `feat/v0.7-team-drive`
**Latest pre-release:** [`v0.7.0-alpha.2`](https://github.com/sena-labs/warp-vsc-bridge/releases/tag/v0.7.0-alpha.2)
## TL;DR
v0.7.0 turns Warp Bridge into a first-class client for **team-shared
Warp resources**: the Warp Drive catalogue becomes navigable from a
dedicated sidebar, skill and rule files gain a Monaco-powered editor,
`/init` becomes opt-in-per-file with live previews, and a single
committed YAML can override the extension's settings for every
contributor of a repository.
## Highlights
### 📂 Warp Drive browser
A dedicated *Warp Bridge → Drive* Activity Bar view lists the
organisation's shared prompts, rules and skills. Right-click a node to
copy it, open it in an editor, or insert it straight into the Copilot
Chat panel. The backend is **transport-agnostic**:
- when the Oz CLI ships the `drive` subcommand the browser consumes
  it;
- otherwise it falls back to the filesystem layout
  (`~/.warp/drive/prompts/*.md`, `~/.agents/rules/*.md`,
  `~/.agents/skills/*/SKILL.md`).
Fallback is silent on `CliDriveNotAvailableError`; every other CLI
error (authentication, network, …) is surfaced to the user. Reads are
path-traversal-guarded so a compromised tree node cannot exfiltrate
arbitrary files.
### ✍️ Skill & Rules Monaco editor *(pending)*
A rich in-extension editor for `SKILL.md` / rule files with split
markdown preview, YAML frontmatter validation, and *Save as global /
Save as workspace / Promote to Warp Drive* actions. CSP-locked
webview, unique per-panel nonces.
### 🧰 `/init` v2 *(pending)*
A QuickPick that lets the user pick which of the 7 agent-pipeline
skills to scaffold, shows a live preview of each template, and refuses
to clobber existing files without explicit confirmation. The legacy
`@warp /init all` shortcut still writes everything unconditionally.
### 🧾 Per-workspace YAML overrides
Drop a `.warp/warp-bridge.yaml` at the root of the repository and
every contributor gets the same `warpBridge.*` defaults:
```yaml
defaultProfile: team-shared
defaultEnvironment: staging
timeoutMs: 600000
mcpEnabled: true
mcpPort: 3900
```
The file is watched live (create / change / delete) so downstream
services (MCP lifecycle, status bar, sidebar) react without a reload.
Secrets (`mcpBearerToken`) and platform-specific paths (`ozPath`) are
deliberately excluded from the allow-list.
### 🔌 MCP auto-registration *(stretch — may slip to v0.7.1)*
Two commands (`warpBridge.mcp.registerClient` /
`.unregisterClient`) that append / remove the current MCP endpoint in
`~/.claude.json`, `~/.cursor/mcp.json`, and `~/.codex/config.toml`.
Opt-in; idempotent; reversible.
## Progress tracker
This block will be removed for the final release.
| Deliverable | Status |
| --- | --- |
| D — Per-workspace YAML overrides | ✅ Merged (PR #3 + #4) |
| A-backend — drive sources + factory | ✅ Merged (PR #5) |
| A-UI — sidebar tree, commands, manifest view | 🟡 Next (`feat/v0.7-drive-ui`) |
| B — Skill & Rules Monaco editor | 🟡 Planned (`feat/v0.7-skill-editor`) |
| C — `/init` v2 | 🟡 Planned (`feat/v0.7-init-v2`) |
| E — MCP auto-registration | 🔵 Stretch (`feat/v0.7-mcp-autoregister`) |
## Upgrade path
- From **v0.6.0**: install the new VSIX or run
  `code --install-extension warp-vsc-bridge.vsix`. **No behaviour
  changes by default** — the new surfaces are additive; the workspace
  YAML overrides only apply when you add a `.warp/warp-bridge.yaml`.
- From earlier versions: chain-upgrade via v0.5.0 → v0.6.0 → v0.7.0;
  all settings remain backwards-compatible.
## Compatibility
- **VS Code:** ≥ 1.96.0 (same floor as v0.5 / v0.6).
- **Platforms:** macOS, Linux, Windows.
- **Oz CLI:** the drive browser works both with and without the
  `drive` subcommand. When Oz gains it, no reinstall required — the
  factory will start using it automatically if we ship a runner patch.
- **Copilot Chat:** optional; required only for the `@warp`
  participant, Agent-mode LM tools, and the *Insert into chat* action
  from the drive sidebar.
## Metrics (running, not final)
- Tests: **790 / 790** green at alpha.2 snapshot (target ≥ 800 for
  v0.7.0 final).
- Bundle: **≈ 72 KB** at alpha.2 (v0.7 budget: 90 KB).
- VSIX size: **TBD** at final release.
- New runtime dependencies: **0** (unchanged since v0.2.0).
## Breaking changes
**None anticipated.** All v0.2.0-era settings, slash commands and
LM tools remain supported. Tree view `when` clauses may be tightened
to keep menus scoped, but no existing user journey changes.
## Known limitations
- **CLI drive endpoint** — not yet shipped by the Oz CLI. The current
  source falls back silently to the filesystem; a future
  `OzCliDriveRunner` adapter will enable the CLI path with zero
  downstream change.
- **Symlink escape in the FS drive source** — the current
  path-traversal guard uses `path.relative` without resolving
  symlinks. Tracked as `RF-1`; fix targeted for v0.7.1.
- **No in-memory caching** — every sidebar refresh re-reads the CLI
  or disk. Fine for typical org sizes (< 50 entries per category);
  caching is a v0.8 concern.
- **Monaco editor CSP hardening** — when B ships, expect extra
  documentation and tests around the nonce strategy.
## What's next (v0.8 preview)
- Cloud run steering mid-flight.
- Cloud Run Monitor webview (NDJSON timeline + diff viewer).
- Dashboard analytics for cloud credits.
- Warp Drive *push* (the current release is browse-only).
## Install (once final)
### VS Code Marketplace
```text
ext install sena-labs.warp-vsc-bridge
```
### VSIX (GUI / CLI)
Download from the v0.7.0 GitHub release, then either
`Ctrl+Shift+P` → **Extensions: Install from VSIX…** or
`code --install-extension warp-vsc-bridge.vsix`.
## Links
- **Repository:** https://github.com/sena-labs/warp-vsc-bridge
- **Changelog:** [`CHANGELOG.md`](../CHANGELOG.md)
- **Milestone brief:** [`docs/MILESTONE-v0.7.md`](./MILESTONE-v0.7.md)
- **Execution plan:** [`docs/NEXT-STEPS-v0.7.md`](./NEXT-STEPS-v0.7.md)
- **MCP integration guide:** [`docs/MCP.md`](./MCP.md)
- **Previous release:** [`RELEASE-NOTES-v0.6.0.md`](./RELEASE-NOTES-v0.6.0.md)
