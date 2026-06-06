# @sena-labs/oz-mcp-server

Standalone [Model Context Protocol](https://modelcontextprotocol.io) server for
**Warp™ Oz™** agents — **no VS Code required**. Run it from a terminal and drive
Oz from Claude Code, Cursor, Codex, or any MCP client.

> **OzBridge is an independent project and is not affiliated with, endorsed by,
> or sponsored by Warp.** "Warp" and "Oz" are trademarks of Warp, Inc., used
> here **nominatively** — solely to describe interoperability. See
> [Trademarks & disclaimer](#trademarks--disclaimer) below.

This package is the VS Code‑free sibling of the
[OzBridge](https://github.com/sena-labs/OzBridge) extension. It exposes the same
MCP tool surface (`oz_agent_run`, `oz_run_list`, …) over an HTTP + Server‑Sent‑
Events transport, so any MCP client can launch and inspect Oz runs.

---

## Requirements

- **Node.js ≥ 20.19**
- The **Oz CLI** installed and on your `PATH` (or pointed at via `OZ_PATH`).
  Download Warp from <https://www.warp.dev/download> — the `oz` command ships
  with it. Verify with `oz --version`.

The server only ever shells out to the documented `oz` CLI; it does not embed,
modify, or reverse‑engineer any Warp software.

---

## Quick start

Run the server with `npx` — no install step needed:

```bash
npx @sena-labs/oz-mcp-server
```

It binds to `127.0.0.1:3847` and prints:

```
[oz-mcp-server] Listening on http://127.0.0.1:3847
[oz-mcp-server] SSE endpoint : http://127.0.0.1:3847/sse
[oz-mcp-server] Health check : http://127.0.0.1:3847/health
[oz-mcp-server] Press Ctrl+C to stop.
```

Leave it running, then point your MCP client at the SSE endpoint
(`http://127.0.0.1:3847/sse`) — see [MCP client setup](#mcp-client-setup).

Pin a port and a bearer token instead of the defaults:

```bash
npx @sena-labs/oz-mcp-server --port 3847 --token my-secret
```

Install it globally if you'd rather not re‑download on each run:

```bash
npm install -g @sena-labs/oz-mcp-server
oz-mcp-server --help
```

---

## Configuration

Settings resolve in this order (highest precedence first):

1. CLI flags
2. Environment variables
3. `./.warp/warp-bridge.yaml` (current working directory), then
   `~/.warp/warp-bridge.yaml`
4. Compiled‑in defaults

### CLI flags

| Flag | Default | Purpose |
| --- | --- | --- |
| `--port <n>` | `3847` | TCP port to listen on. `0` lets the OS pick an ephemeral port. |
| `--bind <addr>` | `127.0.0.1` | Interface to bind. Non‑loopback **requires** a token (see [Security](#security)). |
| `--token <s>` | _(none)_ | Bearer token required on every request. Empty = no auth. |
| `--cwd <dir>` | `process.cwd()` | Workspace root for `.warp/warp-bridge.yaml` discovery. |
| `--help`, `-h` | — | Print usage and exit. |

### Environment variables

| Variable | Maps to | Default | Purpose |
| --- | --- | --- | --- |
| `OZ_PATH` | `ozPath` | `oz` | Path to the Oz CLI binary. Bare `oz` resolves from `PATH`. |
| `OZ_MCP_PORT` | port | `3847` | Listening port. `0` = OS‑assigned ephemeral port. |
| `OZ_MCP_BIND` | bind address | `127.0.0.1` | Interface to bind (loopback only by default). |
| `OZ_MCP_TOKEN` | bearer token | _(empty)_ | Bearer token required on every request. Empty disables auth. |
| `OZ_DEFAULT_MODEL` | `defaultModel` | `auto` | Default AI model for runs. |
| `OZ_DEFAULT_PROFILE` | `defaultProfile` | `Default` | Default Oz agent profile. |
| `OZ_DEFAULT_ENV` | `defaultEnvironment` | _(empty)_ | Default cloud environment id. |
| `OZ_TIMEOUT_MS` | local run timeout | `300000` | Hard timeout for local runs (ms). |
| `OZ_IDLE_TIMEOUT_MS` | idle timeout | `90000` | Abort a run after this long with no CLI output (ms). `0` disables. |

```bash
OZ_PATH=/usr/local/bin/oz \
OZ_MCP_PORT=3847 \
OZ_MCP_TOKEN=my-secret \
npx @sena-labs/oz-mcp-server
```

> On Windows PowerShell, set variables with `$env:` first:
> ```powershell
> $env:OZ_MCP_TOKEN = "my-secret"; npx @sena-labs/oz-mcp-server
> ```

---

## MCP client setup

The server speaks MCP over HTTP + SSE, so clients connect by **URL**, not by
spawning a command. Start the server (above), then add the endpoint to your
client. These snippets mirror
[`docs/MCP.md`](https://github.com/sena-labs/OzBridge/blob/main/docs/MCP.md);
drop the `Authorization` header if you didn't set a token.

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

Or register it from the CLI:

```bash
claude mcp add --transport sse oz-bridge http://127.0.0.1:3847/sse \
  --header "Authorization: Bearer my-secret"
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

---

## Tools exposed

| Tool | Purpose |
| --- | --- |
| `oz_agent_run` | Run `oz agent run` locally with a prompt. Returns the full run payload. |
| `oz_agent_run_cloud` | Launch a cloud run. **Consumes Warp credits.** |
| `oz_run_get` | Fetch a run's status and output by id. Read‑only. |
| `oz_run_list` | List recent runs; filter by `all` / `active` / `completed` / raw status, plus a numeric `limit`. |
| `oz_list_models` | List the AI model ids available to the account and report the current default. Read‑only. |
| `oz_set_default_model` | Set the default Oz model by writing `defaultModel` into the workspace `.warp/warp-bridge.yaml`. |

The full JSON `inputSchema` for each tool is emitted verbatim by `tools/list`.
See [`docs/MCP.md`](https://github.com/sena-labs/OzBridge/blob/main/docs/MCP.md)
for the protocol details, raw‑`curl` cheatsheet, and endpoint reference.

---

## Endpoints

| Route | Method | Purpose |
| --- | --- | --- |
| `/sse` | `GET` | Opens the SSE stream. First frame is `event: endpoint` with the `sessionId` to POST to. |
| `/messages?sessionId=<uuid>` | `POST` | A single JSON‑RPC 2.0 request. Acknowledged with `202`; the response streams back over `/sse`. |
| `/health` | `GET` | Returns `{ ok, name, version, tools, sessions }`. |

Quick health check:

```bash
curl http://127.0.0.1:3847/health
```

---

## Security

- **Loopback by default.** The server binds to `127.0.0.1`; no traffic leaves
  the machine unless you opt in.
- **Non‑loopback requires a token.** Binding to anything other than `127.0.0.1`
  / `::1` without `--token` / `OZ_MCP_TOKEN` is refused — the MCP tool surface
  can spawn the Oz CLI, so an unauthenticated public bind is never allowed.
- **Bearer auth covers every route** (including `/health`) when a token is set;
  comparison is constant‑time.
- **No persistence.** Prompt content and run output are forwarded to the Oz CLI,
  never stored by the server.

There is no TLS termination — put the server behind an authenticated reverse
proxy if you need HTTPS.

---

## Trademarks & disclaimer

OzBridge is an independent project developed by Ivan Sena under the Sena Labs
name. It is **not affiliated with, endorsed by, sponsored by, or officially
associated with** Warp, Inc., Microsoft, GitHub, or the Visual Studio Code
project.

**Warp™** and **Oz™** are trademarks of Warp, Inc. These names are used in this
project **nominatively** — solely to describe that OzBridge interoperates with
Warp Oz — and not to imply any sponsorship, endorsement, or affiliation.

OzBridge uses **only Warp's documented, public interfaces** — the `oz`
command‑line tool and the Model Context Protocol transport. It does **not**
modify, reverse‑engineer, embed, or create a derivative work of Warp's software,
and it is a **complementary integration**, not a competing product or service.

This software is provided "as is", without warranty of any kind. Use it at your
own risk. See
[`DISCLAIMER.md`](https://github.com/sena-labs/OzBridge/blob/main/DISCLAIMER.md)
for the full text.

---

## License

[MIT](https://github.com/sena-labs/OzBridge/blob/main/LICENSE) © Sena Labs
