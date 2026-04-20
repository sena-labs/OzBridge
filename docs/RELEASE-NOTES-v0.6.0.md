# Warp Bridge for VS Code — v0.6.0
**Release date:** 2026-04-20
**Publisher:** `sena-labs`
**VSIX:** `warp-vsc-bridge.vsix`
**Tag:** [`v0.6.0`](https://github.com/sena-labs/warp-vsc-bridge/releases/tag/v0.6.0)
## TL;DR
Warp Bridge v0.6.0 ships the **MCP Server Export** milestone: a
lightweight, zero-dependency Model Context Protocol server embedded in
the extension. Flip one setting and any MCP-aware client — Claude Code,
Cursor, Codex — can drive Warp Oz through the same 4 tools Copilot
Chat sees inside VS Code. No new network exposure by default: the
server binds to loopback and is off until you opt in.
## Highlights
### 🔌 Embedded MCP server (opt-in)
Enable `warpBridge.mcpEnabled` and the extension starts a JSON-RPC 2.0
server on `127.0.0.1:3847` by default. Transport is HTTP + SSE, the
layout everyone else uses:
- `GET  /sse` opens the SSE stream. The first frame is
  `event: endpoint\ndata: /messages?sessionId=<uuid>`.
- `POST /messages?sessionId=<uuid>` carries each JSON-RPC request;
  the response is dispatched over the matching SSE connection.
- `GET  /health` returns `{ ok, name, version, tools, sessions }`.
Four tools are advertised via `tools/list`:
| Tool | What it does |
| --- | --- |
| `oz_agent_run` | Local `oz agent run` with prompt. |
| `oz_agent_run_cloud` | Cloud run — **consumes Warp credits**. |
| `oz_run_get` | Read-only lookup by run id. |
| `oz_run_list` | Recent runs with `all` / `active` / `completed` / raw status filters + `limit`. |
Each tool declares a strict JSON `inputSchema` that `tools/list`
emits verbatim, so MCP clients route arguments automatically.
### 🔐 Security-first defaults
- Binds to **loopback** by default; change `warpBridge.mcpBindAddress`
  only when you understand the implications.
- Optional bearer auth via `warpBridge.mcpBearerToken`. When set, every
  request — including `/health` — must carry
  `Authorization: Bearer <token>`. Comparison is constant-time
  (`crypto.timingSafeEqual`).
- No prompt content or run output is persisted on the server; calls
  are forwarded to the Oz CLI and results flow straight back.
### 🎛 Four new commands
All under the `Warp MCP` Command Palette category:
- `Warp: Start MCP server`
- `Warp: Stop MCP server`
- `Warp: Show MCP server status`
- `Warp: Copy MCP endpoint URL`
### 🔁 Reactive lifecycle
Toggle `warpBridge.mcpEnabled` and the server starts or stops without
an extension reload. `deactivate()` disposes the socket cleanly, so
there are no zombie listeners on reload or uninstall.
## Upgrade path
- From **v0.5.0**: install the new VSIX or run
  `code --install-extension warp-vsc-bridge.vsix`. **No behaviour
  changes by default** — the MCP server is opt-in (`mcpEnabled` is
  `false` out of the box). All other v0.5.0 features work identically.
- From **v0.2.0**: upgrading straight to v0.6.0 also pulls in the
  Agent-Native LM Tools (v0.3), Surfaces (v0.4) and Context & Handoff
  (v0.5) milestones. See
  [`docs/RELEASE-NOTES-v0.5.0.md`](RELEASE-NOTES-v0.5.0.md) for
  details on those.
## Compatibility
- **VS Code:** ≥ 1.96.0.
- **Platforms:** macOS, Linux, Windows.
- **MCP clients:** any client speaking protocol `2024-11-05` or newer.
  The server prefers `2025-03-26` and negotiates down on request.
- **Copilot Chat:** still required only for the `@warp` participant
  and Agent-mode tools; the MCP export is usable without it.
## Metrics
- **694** unit tests across **44** files — all green.
- Extension bundle: **≈ 59 KB** (esbuild, minified, `vscode` external).
- VSIX size: **≈ 48 KB** (14 files).
- New surface area: 4 MCP tools, 4 commands, 4 settings, 1 HTTP+SSE
  transport, 1 lifecycle controller.
- Zero new runtime dependencies — `node:http` and `node:crypto` only.
## Breaking changes
**None.** MCP support is entirely opt-in; the default configuration is
identical to v0.5.0.
## Known limitations
- **MCP capabilities:** only `tools` is advertised in `initialize`.
  `resources`, `prompts`, `sampling`, `logging` are not implemented.
- **No TLS:** put the server behind an authenticated reverse proxy if
  you need HTTPS.
- **Auto-registration** into `~/.claude.json` / `~/.cursor/mcp.json` /
  `~/.codex/config.toml` is **manual** in this release; a command to
  do it for you is planned for v0.6.x.
- **Placeholder icon:** `media/warp-icon.png` is still a stub pending
  Marketplace publish.
## What's next (v0.7 preview)
- **Team & Drive** — Warp Drive browser, Skills & Rules editor in a
  Monaco webview, `/init` v2 with skill picker, per-workspace
  `.warp/warp-bridge.yaml` overrides.
- **Auto-registration commands** for the three major MCP clients.
- **Open VSX publishing** alongside the VS Code Marketplace.
## Install
### VS Code Marketplace (once published)
```text
ext install sena-labs.warp-vsc-bridge
```
### VSIX (GUI)
1. Download `warp-vsc-bridge.vsix` from the v0.6.0 GitHub release.
2. In VS Code: `Ctrl+Shift+P` → **Extensions: Install from VSIX…**.
### VSIX (CLI)
```bash
code --install-extension warp-vsc-bridge.vsix
```
## Thanks
Warp Bridge is maintained by **Sena Labs** with ongoing assistance from
the Oz agent. Feedback, bug reports and feature requests are welcome on
[GitHub Issues](https://github.com/sena-labs/warp-vsc-bridge/issues).
## Links
- **Repository:** https://github.com/sena-labs/warp-vsc-bridge
- **Changelog:** [`CHANGELOG.md`](../CHANGELOG.md)
- **MCP integration guide:** [`docs/MCP.md`](./MCP.md)
- **Publishing guide:** [`docs/PUBLISHING.md`](./PUBLISHING.md)
- **Previous release:** [`RELEASE-NOTES-v0.5.0.md`](./RELEASE-NOTES-v0.5.0.md)
