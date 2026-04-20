# Warp Bridge for VS Code

[![Build](https://github.com/sena-labs/warp-vsc-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/sena-labs/warp-vsc-bridge/actions/workflows/ci.yml)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.96.0-blue)](https://code.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Run **Warp Oz agents** directly from VS Code Copilot Chat via the `@warp` Chat Participant.

![Warp Bridge screenshot](media/screenshot.png)

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
  - [Slash Commands](#slash-commands)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Development](#development)
- [Contributing](#contributing)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [License](#license)

---

## Features

- **`@warp` Chat Participant** — interact with Warp Oz agents from the VS Code chat panel
- **Agent-Native Language Model Tools** (v0.3+) — Copilot **Agent mode** can invoke Warp Oz directly, without typing `@warp`
- **9 slash commands** for complete agent workflow management
- **IDE context injection** — automatically includes workspace, file, selection, and diagnostics in prompts
- **Agent skill detection** — maps prompt keywords to the 7-agent pipeline (spec, design, implement, review, test, deploy, maintenance)
- **Cloud run polling** — exponential backoff polling with real-time progress updates
- **Robust JSON parser** — 5-level fallback for mixed text/JSON CLI output
- **Configurable** — all settings exposed via VS Code Settings UI
- **Zero runtime dependencies** — only `vscode` API at runtime

## Requirements

- **VS Code** ≥ 1.96.0
- **[Warp Terminal](https://www.warp.dev/)** installed with `oz` CLI accessible in PATH
- Warp account (logged in via `oz` CLI)

## Installation

### From VSIX (local)

**Option A — VS Code GUI (recommended):**

1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
2. Type **"Extensions: Install from VSIX..."**
3. Select the `warp-vsc-bridge.vsix` file

**Option B — CLI:**

```bash
code --install-extension warp-vsc-bridge.vsix
```

> **Note:** On Windows `code` may not be in your PATH. Use the full path
> or the GUI method above.

### From source

```bash
git clone <repository-url>
cd warp-vsc-bridge
npm install
npm run build
```

Then press `F5` in VS Code to launch the Extension Development Host.

## Usage

Open the VS Code Chat panel and type `@warp` followed by your request:

```text
@warp fix the bug in main.ts
```

### Slash Commands

| Command | Description | Example |
| --- | --- | --- |
| `/run` | Run an Oz agent locally in the workspace | `@warp /run refactor this function` |
| `/cloud` | Run an Oz agent in the cloud (credits) | `@warp /cloud deploy to staging` |
| `/status` | Show **active** runs (QUEUED / INPROGRESS) or detail by ID | `@warp /status` or `@warp /status <runId>` |
| `/history` | Show **completed** runs (SUCCEEDED / FAILED) with optional filter | `@warp /history`, `@warp /history succeeded`, `@warp /history <runId>` |
| `/schedule` | Create and manage scheduled runs | `@warp /schedule create daily "0 9 * * *" "Run linting"` |
| `/models` | List available AI models | `@warp /models` |
| `/mcp` | List configured MCP servers | `@warp /mcp` |
| `/config` | Show current configuration | `@warp /config` |
| `/init` | Scaffold Warp Skills and Rules files | `@warp /init` |

#### `/history` filters

```text
/history               — list all completed runs (SUCCEEDED + FAILED)
/history succeeded     — only SUCCEEDED runs
/history failed        — only FAILED runs
/history <runId>       — show details for a specific run
```

### Agent Mode — Language Model Tools (v0.3+)

When you use **GitHub Copilot Chat in Agent mode**, Copilot can now invoke
Warp Oz directly through registered **Language Model Tools**. You no longer
need to prefix the request with `@warp`; Copilot picks the right tool based
on the prompt.

| Tool | Reference | Behaviour |
| --- | --- | --- |
| `warp_run_local` | `#warpRunLocal` | Runs a local Oz agent in the current workspace. IDE context is injected automatically unless `includeIdeContext: false`. |
| `warp_run_cloud` | `#warpRunCloud` | Launches a **cloud** Oz agent. Shows a confirmation dialog before consuming Warp credits. Waits for the run to finish by default (`wait: false` to return immediately with the run id). |
| `warp_get_run` | `#warpGetRun` | Fetches status and output of a specific run by id. Read-only. |
| `warp_list_runs` | `#warpListRuns` | Lists recent runs with a status filter (`all`, `active`, `completed`, or a raw status). Read-only. |

Examples:

```text
# Agent mode picks warp_run_local automatically:
Run the unit tests locally via Oz.

# Explicit tool reference (prefix with #):
Run this refactor on cloud: #warpRunCloud refactor src/auth to hexagonal architecture

# Query a previous run:
Check run #warpGetRun for run id run-abc123.
```

Each tool entry is declared in `package.json` under
`contributes.languageModelTools` with a JSON `inputSchema`, so models get
accurate type hints at tool-call time. Cloud tools always show a
confirmation dialog before running, regardless of the user's Bypass
Approvals preference.

#### Schedule sub-commands

```text
/schedule list                                    — List all schedules
/schedule create <name> "<cron>" "<prompt>"       — Create a schedule
/schedule pause <id>                              — Pause a schedule
/schedule unpause <id>                            — Resume a schedule
/schedule delete <id>                             — Delete a schedule
```

## Configuration

All settings are under `warpBridge.*` in VS Code Settings:

| Setting | Default | Description |
| --- | --- | --- |
| `warpBridge.ozPath` | `oz` | Path to the Oz CLI executable |
| `warpBridge.defaultModel` | `auto` | Default AI model for agent runs |
| `warpBridge.defaultProfile` | `Default` | Default Oz agent profile |
| `warpBridge.defaultEnvironment` | *(empty)* | Default cloud environment name |
| `warpBridge.timeoutMs` | `300000` | Timeout for local agent runs (5 min) |
| `warpBridge.cloudPollingIntervalMs` | `5000` | Initial cloud polling interval |
| `warpBridge.cloudPollingTimeoutMs` | `1800000` | Max cloud polling duration (30 min) |
| `warpBridge.maxOutputChars` | `15000` | Max characters shown before truncation |

## Architecture

The extension follows a **layered architecture** pattern with dependency injection
at the composition root (`extension.ts`). Each layer has a single responsibility:

| Layer | Files | Responsibility |
| --- | --- | --- |
| **Types** | `types/index.ts` | Interfaces, error classes, config shape, constants |
| **Parsers** | `jsonParser.ts`, `outputFormatter.ts` | JSON parsing (5-level), chat stream rendering |
| **Services** | `ozCliService.ts`, `configManager.ts`, `contextCollector.ts`, `runPoller.ts`, `logger.ts` | CLI execution, settings, IDE context, polling, logging |
| **Commands** | `router.ts` + 8 command files | Slash command dispatch and business logic |
| **Participant** | `handler.ts`, `followups.ts` | Chat Participant registration and follow-ups |

### Folder structure

```text
src/
├── types/index.ts          — Contracts: interfaces, errors, config
├── parsers/
│   ├── jsonParser.ts       — Robust 5-level JSON parser
│   └── outputFormatter.ts  — Chat stream formatting & truncation
├── services/
│   ├── configManager.ts    — VS Code settings wrapper with caching
│   ├── contextCollector.ts — IDE context gathering
│   ├── ozCliService.ts     — Core CLI execution via child_process
│   ├── runPoller.ts        — Async polling with exponential backoff
│   └── logger.ts           — Centralized extension logging
├── commands/
│   ├── router.ts           — Slash command dispatch
│   └── {8 command files}   — One handler per /command
├── participant/
│   ├── handler.ts          — Chat Participant registration
│   └── followups.ts        — Contextual follow-up suggestions
└── extension.ts            — Entry point: compose & register
```

### Data flow

1. User types `@warp /run implement auth` in Copilot Chat
2. VS Code dispatches the request to the `@warp` Chat Participant
3. `CommandRouter` maps `/run` to `createRunCommand` handler
4. Handler calls `ContextCollector.gather()` for IDE context
5. Handler calls `OzCliService.agentRun()` which spawns `oz` as a child process
6. JSON output is parsed via the 5-level `jsonParser`
7. `OutputFormatter` renders the result as markdown in the chat stream

For detailed design decisions, see [docs/DESIGN.md](docs/DESIGN.md).

## Development

```bash
# Install dependencies
npm install

# Type-check
npm run compile

# Build (esbuild)
npm run build

# Run tests
npm test

# Test with coverage report
npm run test:coverage

# Watch mode (dev)
npm run watch

# Clean build artifacts
npm run clean

# Package VSIX for distribution
npm run package
```

### Test Suite

- **600 tests** across 35 files
- **~2.3:1** test-to-code ratio
- Framework: [Vitest](https://vitest.dev/) v4.0.18

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Make sure all tests pass before submitting:

```bash
npm run compile && npm test
```

See our [Code of Conduct](CODE_OF_CONDUCT.md) and [Security Policy](SECURITY.md).

## Troubleshooting

### `oz` command not found

Ensure Warp is installed and the `oz` CLI is available in your system `PATH`.

| OS | Typical path |
| --- | --- |
| macOS | `/Applications/Warp.app/Contents/MacOS/oz` |
| Linux | `~/.warp/bin/oz` |
| Windows | `C:\Users\<user>\AppData\Local\Programs\Warp\bin\oz.cmd` |

```bash
# Verify oz is available
which oz   # macOS / Linux
where oz   # Windows (PowerShell)
```

If `oz` is in PATH but the extension still reports it as unavailable, type
`@warp /config` in the Copilot Chat panel — this triggers the extension
activation and the first CLI check.

You can also set an explicit path in **Settings → Extensions → Warp Bridge → Oz Path**.

### Authentication errors

Run `oz login` in a terminal to re-authenticate, or use the "Login Warp"
button that appears in the error message inside the chat panel.

### Timeout errors

Increase the timeout in **Settings → Extensions → Warp Bridge → Timeout (ms)**.
The default is 300 000 ms (5 minutes). For large-scale agent runs consider
raising it to 600 000 ms.

### Extension not activating

The extension activates only when the `@warp` participant is invoked in Copilot
Chat. To activate it:

1. Open the Chat panel (`Ctrl+Shift+I`)
2. Type `@warp` followed by any command (e.g., `@warp /config`)

Make sure you have **VS Code ≥ 1.96.0** and the **GitHub Copilot Chat**
extension installed and signed in.

## FAQ

**Q: Does this extension require a Warp subscription?**
A: A free Warp account is sufficient for local agent runs. Cloud runs may
require a paid plan depending on usage. Check your account at
[app.warp.dev](https://app.warp.dev).

**Q: Can I use a custom model?**
A: Yes — set `warpBridge.defaultModel` in VS Code settings or pass it inline
with `/run --model gpt-4o`. To see all available models, use `/models`.

**Q: Which operating systems are supported?**
A: macOS, Linux, and Windows are all natively supported.
The extension works on any platform where VS Code and the Oz CLI can run.
On Windows the extension automatically handles `.cmd` wrappers.

**Q: How do I report a bug?**
A: Open an issue using the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml).
Include your OS, VS Code version, extension version, and steps to reproduce.

**Q: Can I use this extension with GitHub Copilot Chat?**
A: Yes — this extension is a VS Code Chat Participant. It appears as `@warp`
in the Copilot Chat panel. You need GitHub Copilot Chat installed and active.

**Q: How do I update the Oz CLI?**
A: The Oz CLI is bundled with Warp. Updating Warp to the latest version will
automatically update the Oz CLI.
- macOS: `brew upgrade warp`
- Windows/Linux: download the latest installer from [warp.dev](https://www.warp.dev/).

**Q: What happens if the agent run times out?**
A: The extension shows a timeout error with the configured limit in seconds.
You can increase the timeout via `warpBridge.timeoutMs` in settings.
Cloud runs have a separate, longer timeout controlled by `cloudPollingTimeoutMs`.

**Q: Can I run multiple agents in parallel?**
A: Yes — each `/run` or `/cloud` command spawns an independent process.
Multiple chat messages can trigger concurrent agent executions.

## License

[MIT](LICENSE) — see LICENSE file for details.
