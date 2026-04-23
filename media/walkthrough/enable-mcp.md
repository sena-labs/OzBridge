# Enable the MCP bridge (optional)

OzBridge ships an embedded **Model Context Protocol** server so
other AI clients (Claude Code, Cursor, Codex, Zed) can drive the Oz
CLI through OzBridge.

1. Toggle `ozBridge.mcpEnabled` in **Settings** (or run the
   **Warp: Start MCP server** command).
2. Copy the endpoint URL from **Warp: Copy MCP endpoint URL**.
3. Use **Warp: Register MCP client…** to paste the endpoint into a
   supported client's config file automatically.

The MCP server binds to `127.0.0.1` by default and supports an
optional bearer token (`ozBridge.mcpBearerToken`) for authenticated
setups.

---

**Privacy.** OzBridge ships **no telemetry by default**. If you
choose to enable it (`ozBridge.telemetry.connectionString`), only a
closed set of typed events is sent — never prompt content, run IDs,
output, file paths or workspace paths. See
[`PRIVACY.md`](https://github.com/sena-labs/warp-vsc-bridge/blob/main/PRIVACY.md)
for the full contract.
