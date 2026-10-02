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
   MCP server listening on http://127.0.0.1:3847/sse (6 tools)
   ```
You can also start/stop the server on demand without touching settings:
- `OzBridge: Start MCP server` (Command Palette)
- `OzBridge: Stop MCP server`
- `OzBridge: Show MCP server status`
- `OzBridge: Copy MCP endpoint URL`
## Endpoints
| Route | Method | Purpose |
| --- | --- | --- |
| `/mcp` | `POST` | **Streamable HTTP.** A single JSON-RPC 2.0 request as the body, answered in the same HTTP response — no session to open first. Anything but `POST` gets `405` with `Allow: POST`. |
| `/sse` | `GET` | Opens a Server-Sent-Events stream. The first frame is `event: endpoint\ndata: /messages?sessionId=<uuid>` — the client posts subsequent JSON-RPC requests there. |
| `/messages?sessionId=<uuid>` | `POST` | Single JSON-RPC 2.0 request as the body. The server acknowledges with `202 Accepted` and dispatches the response over the matching SSE stream. |
| `/health` | `GET` | Returns `{ ok, name, version, tools, sessions }`. Unaffected by bearer auth only when token is unset. |
All responses are JSON (`Content-Type: application/json`) except `/sse`,
which is `text/event-stream`, and `/mcp`, which answers in JSON unless the
client's `Accept` header asks for `text/event-stream` *without* also
accepting JSON.

### Which transport to use

`POST /mcp` is the transport to prefer: it is what the MCP specification has
called Streamable HTTP since `2025-03-26`, and the HTTP+SSE pair below is
formally deprecated as of `2026-07-28`. `/sse` + `/messages` stay mounted and
unchanged — the deprecation policy guarantees a twelve-month minimum window,
so nothing is being removed here.

Because the server keeps no per-connection state, a client may POST
`tools/list` or `tools/call` to `/mcp` straight away without an `initialize`
handshake, which is what MCP `2026-07-28`'s stateless core expects.

```bash
# No handshake, no session — one POST, one answer.
curl -s -X POST http://127.0.0.1:3847/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

#### Request metadata

`/mcp` understands the headers MCP mirrors from the JSON-RPC body and
validates any that are present, so a conforming newer client is never
silently misread:

| Header | Checked against | On mismatch |
| --- | --- | --- |
| `MCP-Protocol-Version` | `params._meta["io.modelcontextprotocol/protocolVersion"]` | `400` + `-32020` `HeaderMismatch` |
| `Mcp-Method` | `method` | `400` + `-32020` `HeaderMismatch` |
| `Mcp-Name` | `params.name` or `params.uri` (the `=?base64?…?=` sentinel is decoded first) | `400` + `-32020` `HeaderMismatch` |

Omitting them is accepted — they are only required of `2026-07-28` clients,
and this endpoint also serves the older revisions that never sent them. A
request with no version anywhere is read as `2025-03-26`.

Asking for a revision the server does not implement returns `400` with
`-32022` `UnsupportedProtocolVersion` and the list to pick from, so a newer
client can negotiate down rather than guess:

```json
{ "jsonrpc": "2.0", "id": 1, "error": { "code": -32022,
  "message": "Unsupported protocol version: 2026-07-28",
  "data": { "requested": "2026-07-28", "supported": ["2025-03-26", "2024-11-05"] } } }
```

#### Origin validation

The spec requires a Streamable HTTP server to validate `Origin` so a web page
cannot drive a loopback MCP server through DNS rebinding. `/mcp` accepts a
request with no `Origin` at all (native MCP clients are not browsers and send
none) plus any loopback origin, and answers everything else with `403`. Pass
`allowedOrigins` to `McpServer` to widen that to exact origin strings.
## Protocol
OzBridge implements the **Model Context Protocol 2025-03-26** (and
gracefully negotiates down to 2024-11-05 on request). The supported
method set is deliberately small:
- `initialize` — returns server capabilities + `serverInfo`.
- `server/discover` — the discovery RPC MCP `2026-07-28` uses in place of the
  `initialize` handshake. It reports `supportedVersions`, `capabilities` and
  `serverInfo`, so a newer client can use it as a compatibility probe and
  negotiate down. The list names only the revisions this server actually
  implements, so it never claims conformance OzBridge does not have.
- `ping` — health probe, always returns `{}`.
- `tools/list` — enumerates the registered tools.
- `tools/call` — invokes a tool by name.
`2026-07-28` is **not** advertised: beyond the transport, that revision adds
MUST-level requirements OzBridge has not implemented (a `resultType` on every
result, `ttlMs` / `cacheScope` on list results, `subscriptions/listen`, MRTR).
A `2026-07-28` client still works over `/mcp`, because the spec requires
clients to treat a result with no `resultType` from an earlier-protocol server
as `"complete"`.

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
| `oz_list_models` | List the AI model ids available to the account (`oz model list`) and report the current default. Read-only. |
| `oz_set_default_model` | Set the default Oz model for every OzBridge surface by writing `defaultModel` into the workspace `.warp/warp-bridge.yaml`. Validated against `oz model list`. |
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
    "oz-bridge": {
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
    "oz-bridge": {
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
name = "oz-bridge"
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
  actual port via the `OzBridge: Show MCP server status` command).
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
  `OzBridge: Stop MCP server` calls, so there are no zombie listeners.
## Limitations in v0.6
- `resources`, `prompts`, `sampling`, `logging` MCP capabilities are
  **not** implemented.
- No TLS termination. Put the server behind an authenticated reverse
  proxy if you need HTTPS.
- Auto-registration into the three major MCP clients (`~/.claude.json`
  etc.) is **manual** in this release; a command to do it for you is
  planned for v0.6.x.
