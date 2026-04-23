# OzBridge as an MCP server
OzBridge can expose its Oz CLI integration as a **Model Context
Protocol** (MCP) server, so *any* MCP client — Claude Code, Cursor,
Codex, etc. — can drive Warp Oz through the same tools that Copilot
Chat sees inside VS Code.
## Quick start
1. Open VS Code settings (Ctrl+,).
2. Enable the server:
   - `ozBridge.mcpEnabled` → `true`
3. *(optional)* Change the port, bind address, or set a bearer token:
   - `ozBridge.mcpPort` (default `3847`)
   - `ozBridge.mcpBindAddress` (default `127.0.0.1` — loopback only)
   - `ozBridge.mcpBearerToken` (default empty = no auth)
4. Watch the OzBridge output channel for the log line:
   ```
   MCP server listening on http://127.0.0.1:3847/sse (4 tools)
   ```
You can also start/stop the server on demand without touching settings:
- `Warp: Start MCP server` (Command Palette)
- `Warp: Stop MCP server`
- `Warp: Show MCP server status`
- `Warp: Copy MCP endpoint URL`
## Endpoints
| Route | Method | Purpose |
| --- | --- | --- |
| `/sse` | `GET` | Opens a Server-Sent-Events stream. The first frame is `event: endpoint\ndata: /messages?sessionId=<uuid>` — the client posts subsequent JSON-RPC requests there. |
| `/messages?sessionId=<uuid>` | `POST` | Single JSON-RPC 2.0 request as the body. The server acknowledges with `202 Accepted` and dispatches the response over the matching SSE stream. |
| `/health` | `GET` | Returns `{ ok, name, version, tools, sessions }`. Unaffected by bearer auth only when token is unset. |
All responses are JSON (`Content-Type: application/json`) except `/sse`
which is `text/event-stream`.
## Protocol
OzBridge implements the **Model Context Protocol 2025-03-26** (and
gracefully negotiates down to 2024-11-05 on request). The supported
method set in v0.6 is deliberately small:
- `initialize` — returns server capabilities + `serverInfo`.
- `ping` — health probe, always returns `{}`.
- `tools/list` — enumerates the registered tools.
- `tools/call` — invokes a tool by name.
Notifications (JSON-RPC requests without an `id`) are dropped if the
method is unknown. Resource/prompt/sampling capabilities are *not*
advertised in this release.
## Tools exposed
| Tool | Purpose |
| --- | --- |
| `oz_agent_run` | Run `oz agent run` locally with a prompt. Returns the full run payload. |
| `oz_agent_run_cloud` | Launch a cloud run. **Consumes Warp credits.** |
| `oz_run_get` | Fetch a run's status and output by id. Read-only. |
| `oz_run_list` | List recent runs; supports `all` / `active` / `completed` / raw status filters plus a numeric `limit`. |
The JSON schemas for the `inputSchema` of each tool are emitted verbatim
by `tools/list`, so clients can route arguments from their own prompts
automatically.
## Bearer authentication
When `ozBridge.mcpBearerToken` is non-empty, every request must carry
an `Authorization: Bearer <token>` header. Requests missing or with a
mismatching token receive `401 Unauthorized`. Comparison is
constant-time via `crypto.timingSafeEqual`.
Bind to loopback (`127.0.0.1`) whenever possible; only change
`ozBridge.mcpBindAddress` if you understand the implications.
## Integration examples
### Claude Code
Add to `~/.claude.json`:
```json
{
  "mcpServers": {
    "warp-bridge": {
      "type": "sse",
      "url": "http://127.0.0.1:3847/sse",
      "headers": {
        "Authorization": "Bearer my-secret"
      }
    }
  }
}
```
### Cursor
Add to `~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "warp-bridge": {
      "url": "http://127.0.0.1:3847/sse",
      "headers": {
        "Authorization": "Bearer my-secret"
      }
    }
  }
}
```
### Codex CLI
Add to `~/.codex/config.toml`:
```toml
[[mcp.servers]]
name = "warp-bridge"
url = "http://127.0.0.1:3847/sse"
authorization = "Bearer my-secret"
```
## Raw protocol cheatsheet
```bash
# 1. Open the SSE stream (keep this process running).
curl -N http://127.0.0.1:3847/sse
# First frame printed:
#   event: endpoint
#   data: /messages?sessionId=<uuid>
# 2. In another shell, list tools on the same sessionId.
curl -X POST 'http://127.0.0.1:3847/messages?sessionId=<uuid>' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# 3. Invoke a tool.
curl -X POST 'http://127.0.0.1:3847/messages?sessionId=<uuid>' \
  -H 'Content-Type: application/json' \
  -d '{
        "jsonrpc":"2.0",
        "id":2,
        "method":"tools/call",
        "params":{
          "name":"oz_run_list",
          "arguments":{"status":"completed","limit":5}
        }
      }'
```
Responses stream back on the SSE connection as:
```
event: message
data: {"jsonrpc":"2.0","id":2,"result":{"filter":"completed","count":5,"items":[…]}}
```
## Troubleshooting
- **Server fails to start with `EADDRINUSE`** — another process is
  bound to `ozBridge.mcpPort`. Pick a different port or set it to
  `0` to let the OS choose an ephemeral one (you can retrieve the
  actual port via the `Warp: Show MCP server status` command).
- **Client connects but gets `401`** — the bearer token on the client
  doesn't match `ozBridge.mcpBearerToken`. Copy the token via the
  VS Code Settings UI, or clear it on both sides for local development.
- **No tools are returned** — check the OzBridge output channel for
  a log line like `MCP server listening on … (N tools)`. If `N` is 0,
  the tool registry failed to populate; file a bug.
- **Connection drops after ~30 s** — idle SSE streams are kept alive
  with a `: keepalive\n\n` comment every 15 s. If your client still
  closes the stream, increase its `keep-alive` timeout.
## Security posture
- Binds to loopback by default; no traffic leaves the machine unless
  you opt in via `ozBridge.mcpBindAddress`.
- Bearer token, when set, is required for *every* route — including
  `/health` — so even reconnaissance probes are authenticated.
- No prompt content or run output is persisted by the server; the
  bridge only forwards calls to the Oz CLI.
- The server exits cleanly on extension `deactivate()` and idempotent
  `Warp: Stop MCP server` calls, so there are no zombie listeners.
## Limitations in v0.6
- `resources`, `prompts`, `sampling`, `logging` MCP capabilities are
  **not** implemented.
- No TLS termination. Put the server behind an authenticated reverse
  proxy if you need HTTPS.
- Auto-registration into the three major MCP clients (`~/.claude.json`
  etc.) is **manual** in this release; a command to do it for you is
  planned for v0.6.x.
