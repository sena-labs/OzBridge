# Enable the MCP bridge (optional)

Warp Bridge ships an embedded **Model Context Protocol** server so
other AI clients (Claude Code, Cursor, Codex, Zed) can drive the Oz
CLI through Warp Bridge.

1. Toggle `warpBridge.mcpEnabled` in **Settings** (or run the
   **Warp: Start MCP server** command).
2. Copy the endpoint URL from **Warp: Copy MCP endpoint URL**.
3. Use **Warp: Register MCP client…** to paste the endpoint into a
   supported client's config file automatically.

The MCP server binds to `127.0.0.1` by default and supports an
optional bearer token (`warpBridge.mcpBearerToken`) for authenticated
setups.
