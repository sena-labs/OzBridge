---
layout: default
title: "Warp Oz agents in any IDE, via MCP"
description: "Open-source MCP server and VS Code extension that runs Warp Oz cloud and local agents from GitHub Copilot Chat, Claude Code, Cursor and Codex CLI."
---

# OzBridge

**OzBridge is an open-source [Model Context Protocol](https://modelcontextprotocol.io)
(MCP) server and VS Code extension that runs Warp Oz cloud and local agents from any
MCP-compatible client — GitHub Copilot Chat, Claude Code, Cursor and Codex CLI.**

> **Independent project** — not affiliated with, endorsed by, or sponsored by Warp, Inc.
> **Warp™** and **Oz™** are trademarks of Warp, Inc., used here nominatively only to
> describe interoperability. OzBridge uses solely Warp's documented public interfaces
> (the `oz` CLI, the Model Context Protocol, and `WARP_OUTPUT_FORMAT`).

[Quick Start guide](QUICK-START.html) ·
[MCP reference](https://github.com/sena-labs/OzBridge/blob/main/docs/MCP.md) ·
[Source on GitHub](https://github.com/sena-labs/OzBridge) ·
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=sena-labs.ozbridge) ·
[Open VSX](https://open-vsx.org/extension/sena-labs/ozbridge)

## What problem does it solve?

Warp Oz orchestrates autonomous coding agents in the cloud, but its agents are
driven from the Warp terminal. OzBridge exposes the same Oz toolset over the
Model Context Protocol, so the editor or agent you already use can launch, poll
and read Oz runs without leaving it.

## What can it do?

- **Run Oz agents locally** — spawns the `oz` CLI in your workspace. No Warp credits.
- **Run Oz agents in the cloud** — launches a Warp Oz cloud run and polls it to completion.
- **Query runs** — fetch a run by id, or list recent runs filtered by status.
- **Pick the model** — list the models available to your account and set the default.
- **Native VS Code integration** — the `@oz` chat participant plus Language Model
  Tools that GitHub Copilot Agent mode invokes on its own.

Six MCP tools are exposed: `oz_agent_run`, `oz_agent_run_cloud`, `oz_run_get`,
`oz_run_list`, `oz_list_models`, `oz_set_default_model`.

## Install

**VS Code / Cursor (Microsoft Marketplace):**

```bash
code --install-extension sena-labs.ozbridge
```

**VSCodium / Gitpod / Theia (Open VSX):**

```bash
codium --install-extension sena-labs.ozbridge
```

**Standalone MCP server — no editor required:**

```bash
npx -y @sena-labs/oz-mcp-server
```

Requires [Warp](https://www.warp.dev/) installed with the `oz` CLI on `PATH`, and a
Warp account (a free account is enough for local runs).

## How do I use Warp Oz in Claude Code?

Start the bridge, then add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "oz-bridge": {
      "type": "sse",
      "url": "http://127.0.0.1:3847/sse"
    }
  }
}
```

## How do I use Warp Oz in Cursor?

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "oz-bridge": {
      "url": "http://127.0.0.1:3847/sse"
    }
  }
}
```

## How do I use Warp Oz in Codex CLI?

Add to `~/.codex/config.toml`:

```toml
[[mcp.servers]]
name = "oz-bridge"
url = "http://127.0.0.1:3847/sse"
```

## How do I use Warp Oz in VS Code?

Install the extension — no MCP wiring needed. Oz appears as the `@oz` chat
participant, and Copilot Agent mode calls the Oz tools autonomously.

Set `ozBridge.mcpBearerToken` to require an `Authorization: Bearer <token>`
header on every MCP request; the server binds to `127.0.0.1` by default. Full
protocol details, endpoints and a raw-`curl` cheatsheet are in the
[MCP reference](https://github.com/sena-labs/OzBridge/blob/main/docs/MCP.md).

## Frequently asked questions

**Is OzBridge affiliated with Warp?**
No. It is an independent open-source project that uses Warp's documented public
interfaces only.

**Do I need VS Code?**
No. The standalone `@sena-labs/oz-mcp-server` package runs via `npx` with no
editor involved.

**What is the difference between a local run and a cloud run?**
A local run spawns the `oz` CLI in your workspace and consumes no Warp credits.
A cloud run executes on Warp's infrastructure, consumes credits, and runs
detached from your machine.

**Which operating systems are supported?**
macOS, Linux and Windows.

**What licence is it under?**
MIT.
