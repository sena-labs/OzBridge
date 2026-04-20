# Warp Bridge for VS Code — v0.5.0
**Release date:** 2026-04-20
**Publisher:** `sena-labs`
**VSIX:** `warp-vsc-bridge.vsix` (≈ 50 KB)
**Tag:** [`v0.5.0`](https://github.com/sena-labs/warp-vsc-bridge/releases/tag/v0.5.0)
## TL;DR
Warp Bridge v0.5.0 is the first **consolidated public release** under the
`sena-labs` publisher. It bundles three previously-internal milestones —
**v0.3 Agent-Native**, **v0.4 Surfaces**, and **v0.5 Context & Handoff** —
into a single coherent ship. The extension goes from *"@warp slash
commands"* to *"deeply integrated Warp control surface"* inside VS Code:
Copilot Agent mode can call Oz directly, a dedicated Activity Bar view and
status bar keep you aware of runs at a glance, and a single click hands a
run off to an actual Warp terminal.
## Highlights
### 🧠 Copilot Agent mode can now call Oz — no `@warp` needed
Four native Language Model Tools are registered on every activation:
| Tool | Reference | What it does |
| --- | --- | --- |
| `warp_run_local` | `#warpRunLocal` | Local Oz agent in the current workspace. |
| `warp_run_cloud` | `#warpRunCloud` | Cloud Oz agent; shows a credit confirmation dialog, polls to terminal state by default. |
| `warp_get_run` | `#warpGetRun` | Read-only lookup of a run by id. |
| `warp_list_runs` | `#warpListRuns` | Recent runs with `all` / `active` / `completed` / `OzRunStatus` filters. |
Agent-mode prompts like *"run the unit tests locally via Oz"* are now
routed to `warp_run_local` automatically, without any `@`-mention.
### 🗂 Warp sidebar + status bar
A dedicated Activity Bar view (**Warp Bridge → Runs & Resources**) renders
five live categories:
- **Active Runs** — `QUEUED` + `INPROGRESS`, auto-refreshed every 10 s.
- **History** — `SUCCEEDED` + `FAILED`, most recent 20 entries.
- **Schedules** — cron jobs from `oz schedule list`.
- **Environments** — cloud environments from `oz environment list`.
- **MCP Servers** — MCP integrations from `oz mcp list`.
Right-click menus offer *Copy ID*, *Open in Browser* (`app.warp.dev/agents/<id>`),
*Pause / Resume / Delete* for schedules (with modal confirmation), and
*Hand off to Warp terminal*.
A `$(cloud) Warp: N active` status bar item on the right mirrors the
Active Runs count in real time — `default` at 0, `warningBackground` at
1–2, `errorBackground` at 3+. Clicking it focuses the sidebar.
### 🔗 Prompt variables & Warp terminal handoff
Inside any `/run` or `/cloud` prompt you can now embed tokens that the
extension resolves **locally** before sending the prompt to the Oz CLI:
| Token | Expands to |
| --- | --- |
| `#warp.env` | `warpBridge.defaultEnvironment` (or `(no default environment)` when empty). |
| `#warp.profile` | `warpBridge.defaultProfile`. |
| `#warp.model` | `warpBridge.defaultModel`. |
| `#oz.history` | Markdown table of the last 10 runs. |
| `#oz.run/<id>` | Fenced JSON payload from `oz run get <id>`. |
Two commands open a real Warp terminal via the
`warp://action/new_tab?path=…&command=…` URI scheme:
- **`Warp: Hand off to Warp terminal…`** (Command Palette) — asks for a
  prompt and runs `oz agent run --prompt "<prompt>"` in a new Warp tab.
- **`Warp: Hand off run to Warp terminal`** (sidebar context menu on run
  nodes) — runs `oz run get <runId>`.
If the `warp://` URL handler isn't registered on the platform, a modal
surfaces the exact command with a **Copy command** button so you can paste
it into any shell.
## Upgrade path
- If you were on **v0.2.0**, simply install the new VSIX or run
  `code --install-extension warp-vsc-bridge.vsix`. No settings migration
  needed: all `warpBridge.*` keys are backwards-compatible and defaults
  are unchanged.
- If you were tracking the `v0.3.0-dev` tag (internal), just pull `main`
  and reinstall — `0.5.0` supersedes `0.3.0-dev` entirely.
## Compatibility
- **VS Code:** ≥ 1.96.0 (stable Chat Participant API + `vscode.lm.registerTool`).
- **Platforms:** macOS, Linux, Windows.
- **Warp:** any recent build; handoff commands require Warp ≥ 0.2024.x
  with the `warp://` URL handler registered (fallback modal otherwise).
- **Copilot Chat:** required only if you want to use `@warp` or Agent
  mode tools — all sidebar and status bar features work without it.
## Metrics
- **660** unit tests across **41** files — all green.
- Extension bundle: **≈ 50 KB** (esbuild, minified, `vscode` external).
- VSIX size: **≈ 38 KB** (11 files).
- New surface area: 4 Language Model Tools, 1 Activity Bar view, 1
  status bar item, 12 commands, 5 prompt variables, 1 URL-scheme
  handoff.
## Breaking changes
**None.** All public APIs, slash commands and settings are compatible
with v0.2.0. Tree view `when` clauses were tightened (`viewItem =~
/^warp(Run|Schedule|Environment|Mcp)/`) but this only affects the
internal sidebar.
## Known limitations
- The **Cloud Run Monitor webview** (timeline + live event stream)
  originally scoped for v0.4 was de-prioritised and will land in v0.6+.
- **Chat variables** (`vscode.chat.registerChatVariableResolver`) are
  still a proposed API and are *not* used; prompt variables are instead
  expanded by the extension before the Oz call. Behaviour is equivalent
  from the user's perspective.
- **Warp URL scheme** handling depends on the OS registry. On systems
  without Warp installed the extension always falls back to the Copy
  modal instead of surfacing an opaque error.
## What's next (v0.6 preview)
- **MCP Server Export** — expose `warp_run_local`, `warp_run_cloud`,
  `warp_get_run` etc. as an embedded MCP server so Claude Code, Cursor
  and Codex can drive Oz too.
- **Cloud Run Monitor webview** — NDJSON timeline, Cancel button,
  integrated diff view for file changes.
- **Open VSX publishing** in parallel with the VS Code Marketplace.
## Install
### VS Code Marketplace (preferred, once published)
```text
ext install sena-labs.warp-vsc-bridge
```
### VSIX (GUI)
1. Download `warp-vsc-bridge.vsix` from the v0.5.0 GitHub release.
2. In VS Code: `Ctrl+Shift+P` → **Extensions: Install from VSIX…**.
### VSIX (CLI)
```bash
code --install-extension warp-vsc-bridge.vsix
```
## Thanks
Warp Bridge is maintained by **Sena Labs** with generous assistance from
the Oz agent. Feedback, bug reports and feature requests are welcome on
[GitHub Issues](https://github.com/sena-labs/warp-vsc-bridge/issues).
## Links
- **Repository:** https://github.com/sena-labs/warp-vsc-bridge
- **Changelog:** [`CHANGELOG.md`](../CHANGELOG.md)
- **Publishing guide:** [`docs/PUBLISHING.md`](./PUBLISHING.md)
- **Security policy:** [`SECURITY.md`](../SECURITY.md)
- **Contributing:** [`CONTRIBUTING.md`](../CONTRIBUTING.md)
