# OzBridge for VS Code — v0.7.0

**Release date:** 2026-04-20  
**Publisher:** `sena-labs`  
**Previous pre-releases:** [`v0.7.0-alpha.1`](https://github.com/sena-labs/warp-vsc-bridge/releases/tag/v0.7.0-alpha.1) · [`v0.7.0-alpha.2`](https://github.com/sena-labs/warp-vsc-bridge/releases/tag/v0.7.0-alpha.2)

## TL;DR

v0.7.0 turns OzBridge into a first-class client for **team-shared Warp resources**: the Warp Drive catalogue becomes navigable from a dedicated sidebar, skill and rule files gain a built-in editor flow, `/init` becomes opt-in-per-file with per-file overwrite protection, a single committed YAML can override the extension's settings for every contributor of a repository, and the running MCP server can be registered into Claude Code, Cursor and Codex with a single command.

## Highlights

### 📂 Warp Drive browser

A dedicated *OzBridge → Drive* Activity Bar view lists the organisation's shared prompts, rules and skills. Right-click a node to copy it, open it in an editor, or insert it straight into the Copilot Chat panel. The backend is **transport-agnostic**:

- when the Oz CLI ships the `drive` subcommand the browser consumes it;
- otherwise it falls back to the filesystem layout (`~/.warp/drive/prompts/*.md`, `~/.agents/rules/*.md`, `~/.agents/skills/*/SKILL.md`).

Fallback is silent on `CliDriveNotAvailableError`; every other CLI error (authentication, network, …) is surfaced to the user. Reads are path-traversal-guarded so a compromised tree node cannot exfiltrate arbitrary files.

### ✍️ Built-in skill & rule editor

Four new commands let you manage skills / rules without leaving VS Code:

- `ozBridge.skill.edit` opens any `SKILL.md` or rule in the native editor (Markdown preview via `Ctrl+K V` remains first-class).
- `ozBridge.skill.new` prompts for a name and scaffolds `SKILL.md` either under the current workspace or globally.
- `ozBridge.skill.saveGlobal` / `ozBridge.skill.saveWorkspace` persist the currently active editor's content as a skill file.

All writes are atomic (`.tmp` + `fs.renameSync`) and validated with the strict `^[a-z0-9][a-z0-9-]*$` skill-name grammar. Overwriting an existing file always requires an explicit modal confirmation. A richer Monaco + webview editor remains a v0.8 stretch item.

### 🧰 `/init` v2

`@oz /init` now opens a QuickPick that lists the seven agent-pipeline skills and the shared project rules file. Each entry is marked as `[new]` or `[exists]`; existing files are not pre-picked and can only be overwritten after an explicit modal confirmation. `@oz /init all` preserves the v0.2.0 bulk behaviour and never overwrites.

### 🧾 Per-workspace YAML overrides

Drop a `.warp/warp-bridge.yaml` at the root of the repository and every contributor gets the same `ozBridge.*` defaults:

```yaml
defaultProfile: team-shared
defaultEnvironment: staging
timeoutMs: 600000
mcpEnabled: true
mcpPort: 3900
```

The file is watched live (create / change / delete) so downstream services (MCP lifecycle, status bar, sidebar) react without a reload. Secrets (`mcpBearerToken`) and platform-specific paths (`ozPath`) are deliberately excluded from the allow-list.

### 🔌 MCP auto-registration

Two new commands — `ozBridge.mcp.registerClient` and `.unregisterClient` — QuickPick among the supported MCP clients (Claude Code, Cursor, Codex) and update the client's config file with the running MCP endpoint. Registrars are idempotent and reversible; they preserve every unrelated key or table in the target file.

- Claude Code → `~/.claude.json` (JSON, `mcpServers.<name>`).
- Cursor → `~/.cursor/mcp.json` (JSON, same layout).
- Codex → `~/.codex/config.toml` (minimal line-based TOML writer targeting only `[[mcp.servers]]` tables).

## Upgrade path

- From **v0.6.0**: install the new VSIX or run `code --install-extension warp-vsc-bridge.vsix`. **No behaviour changes by default** — the new surfaces are additive; the workspace YAML overrides only apply when you add a `.warp/warp-bridge.yaml`.
- From earlier versions: chain-upgrade via v0.5.0 → v0.6.0 → v0.7.0; all settings remain backwards-compatible.

## Compatibility

- **VS Code:** ≥ 1.96.0 (same floor as v0.5 / v0.6).
- **Platforms:** macOS, Linux, Windows.
- **Oz CLI:** the drive browser works both with and without the `drive` subcommand. When Oz gains it, no reinstall required — the factory will start using it automatically if we ship a runner patch.
- **Copilot Chat:** optional; required only for the `@oz` participant, Agent-mode LM tools, and the *Insert into chat* action from the drive sidebar.

## Metrics

- Tests: **860 / 860** green (57 files).
- Bundle: **≈ 85 KB** (`dist/extension.js`, esbuild, minified, `vscode` external; v0.7 budget: 90 KB).
- VSIX: **60.05 KB** (`warp-vsc-bridge.vsix`).
- New runtime dependencies: **0** (unchanged since v0.2.0).

## Breaking changes

**None anticipated.** All v0.2.0-era settings, slash commands and LM tools remain supported. Tree view `when` clauses may be tightened to keep menus scoped, but no existing user journey changes.

## Known limitations

- **CLI drive endpoint** — not yet shipped by the Oz CLI. The current source falls back silently to the filesystem; a future `OzCliDriveRunner` adapter will enable the CLI path with zero downstream change.
- **Symlink escape in the FS drive source** — fixed in v0.7.1 (`RF-1`) via canonical `realpath` validation in `FileSystemDriveSource.read()`.
- **No in-memory caching** — every sidebar refresh re-reads the CLI or disk. Fine for typical org sizes (< 50 entries per category); caching is a v0.8 concern.
- **Monaco webview editor** — this release ships the built-in VS Code editor flow for skills and rules. A dedicated webview with split Markdown preview, YAML frontmatter validation and a CSP / nonce hardening story is a v0.8 stretch item.

## What's next (v0.8 preview)

- Cloud run steering mid-flight.
- Cloud Run Monitor webview (NDJSON timeline + diff viewer).
- Dashboard analytics for cloud credits.
- Warp Drive *push* (the current release is browse-only).

## Install

### VS Code Marketplace

```text
ext install sena-labs.warp-vsc-bridge
```

### VSIX (GUI / CLI)

Download from the v0.7.0 GitHub release, then either `Ctrl+Shift+P` → **Extensions: Install from VSIX…** or `code --install-extension warp-vsc-bridge.vsix`.

## Links

- **Repository:** [github.com/sena-labs/warp-vsc-bridge](https://github.com/sena-labs/warp-vsc-bridge)
- **Changelog:** [`CHANGELOG.md`](../CHANGELOG.md)
- **Milestone brief:** [`docs/MILESTONE-v0.7.md`](./MILESTONE-v0.7.md)
- **MCP integration guide:** [`docs/MCP.md`](./MCP.md)
- **Previous release:** [`RELEASE-NOTES-v0.6.0.md`](./RELEASE-NOTES-v0.6.0.md)
