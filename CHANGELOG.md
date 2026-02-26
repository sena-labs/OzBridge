# Changelog

All notable changes to **Warp Bridge for VS Code** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `CONTRIBUTING.md` with development setup, coding standards, and PR guidelines
- `CODE_OF_CONDUCT.md` (Contributor Covenant v2.0)
- `SECURITY.md` with vulnerability reporting policy and security practices
- GitHub Issue Templates (Bug Report, Feature Request)
- Pull Request template with checklist
- `CODEOWNERS` and `FUNDING.yml` for repository governance
- Comprehensive JSDoc on all exported functions, classes, and interfaces
- Shared `skillDetector.ts` module used by both `/run` and `/cloud` commands

### Changed

- Refactored skill detection logic from inline duplicated code to shared `detectSkill()` utility
- `OutputFormatter` refactored to lazy-load config via `IConfigManager` instead of snapshot
- Logger now writes to both `OutputChannel` and developer console for all log levels
- Logger buffers pre-`initLogger()` messages and flushes them on initialization
- `.vscodeignore` updated to exclude `.github/**`, `test/**`, and `vitest.config.ts` from VSIX

### Fixed

- `OzCliService.exec()` double-reject race condition — added `settled` flag guard
- `/cloud` command now performs skill detection (was missing, unlike `/run`)
- Test helpers use `as unknown as IOzCliService` instead of `as any` for type safety
- `parseOrThrow()` error messages now include first 200 chars of raw output for debugging

## [0.1.0] — 2026-02-25

### Added

- **Chat Participant**: `@warp` Chat Participant for VS Code Copilot Chat, fully registered via the stable `vscode.chat` API
- **Slash Commands**:
  - `/run` — execute a local Warp Oz agent in the current workspace with IDE context injection
  - `/cloud` — start a cloud agent run with interactive credit confirmation and async polling
  - `/status` — display run list or single run detail by ID
  - `/schedule` — manage Warp cron jobs (create, list, pause, unpause, delete) with regex validation
  - `/models` — list available AI models in the Oz platform
  - `/mcp` — list configured MCP servers
  - `/config` — show active Warp Bridge configuration, Oz CLI status, profiles, environments, and integrations
  - `/init` — scaffold `.agents/skills/<skill>/SKILL.md` (7 files) and `.warp/rules/PROJECT.md`
- **Oz CLI Integration**: `OzCliService` wraps `child_process.spawn` with `--output-format json`, per-command timeout, VS Code `CancellationToken` support, and input sanitization (`sanitizeId()`)
- **Context Injection**: `ContextCollector` gathers workspace path, active file, selection (capped at 2000 chars), and diagnostics; formats as `[CONTEXT]...[/CONTEXT]` block
- **Agent Skill Detection**: Automatic skill mapping from prompt keywords to 7 agent skills via `AGENT_SKILL_MAP`
- **Cloud Polling**: `RunPoller` implements exponential backoff (5s → 30s, ×1.5 factor) with 30-minute timeout and `AbortController` integration
- **JSON Parsing**: 5-level robust parser (`parse<T>`, `parseOrThrow<T>`) handles plain text, direct JSON, multi-line JSON blocks, and single-line JSON extraction
- **Output Formatting**: `OutputFormatter` renders Markdown with truncation (configurable `maxOutputChars`), action buttons, and error-specific guidance (install, login, syntax)
- **Configuration**: `ConfigManager` wraps `vscode.workspace.getConfiguration('warpBridge')` with in-memory cache, `onConfigChanged` event, and 8 configurable settings
- **Contextual Follow-ups**: `FollowupProvider` suggests relevant next commands based on the command just executed
- **Logging**: Centralized `logger.ts` with `initLogger()`, `logInfo()`, `logWarn()`, `logError()` — all write to `OutputChannel` and developer console
- **Test Suite**: 256 tests across 17 files (1.5:1 test-to-code ratio), using Vitest with interface-based mocks
- **CI/CD**: GitHub Actions workflow with Node.js 18/20/22 matrix — type-check, test, and build on every push/PR
- **Build**: esbuild CJS bundle with tree-shaking, external `vscode`, minified output in `dist/extension.js`

## [0.0.2] — 2026-02-20

### Added

- Cloud-run polling implementation (`RunPoller`) with exponential backoff
- Agent skill auto-detection from prompt keywords (`AGENT_SKILL_MAP`)
- `/cloud` slash command with credit warning confirmation dialog
- `/schedule` command with 5 sub-commands and cron expression validation
- `ContextCollector` with selection + diagnostics gathering

### Fixed

- JSON parser now handles multi-line JSON blocks spanning multiple lines
- `OzCliService.exec()` properly rejects on spawn error events

## [0.0.1] — 2026-02-15

### Added

- Initial project scaffolding with TypeScript strict mode and esbuild
- `@warp` Chat Participant registration via `vscode.chat` API
- `/run` slash command for local agent execution
- `/status`, `/models`, `/mcp`, `/config` read-only commands
- `OzCliService` wrapping `child_process.spawn` with JSON output parsing
- 5-level robust JSON parser (`parse<T>`, `parseOrThrow<T>`)
- `OutputFormatter` with Markdown rendering and truncation
- `ConfigManager` with caching and `onConfigChanged` event
- Vitest test suite with vscode module mock
