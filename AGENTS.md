# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

OzBridge is a VS Code extension (TypeScript, npm workspaces) that bridges VS Code Copilot Chat with Warp Terminal's Oz AI agent CLI. It is a **pure extension** — no databases, Docker, or external services are needed for development. The workspace package `copilot-chat-toolkit` (under `packages/copilot-chat-toolkit`) is a build-time dependency.

### Key commands

All standard dev commands are in `package.json` scripts and documented in `README.md` and `CONTRIBUTING.md`. Quick reference:

| Task | Command |
|---|---|
| Type-check (lint) | `npm run compile` |
| Unit tests | `npm test -- --run` (Vitest, ~13 s) |
| Build bundle | `npm run build` (esbuild, produces `dist/extension.js`) |
| Dev watch mode | `npm run watch` |
| Package VSIX | `npm run package` |
| Test with coverage | `npm run test:coverage` |

### Non-obvious caveats

- **Workspace package build order**: The `copilot-chat-toolkit` package must be built (`npm run build --workspace=copilot-chat-toolkit`) before `npm run build` for the main extension if its `dist/` directory is missing. After the first build, `npm install` links it automatically.
- **Vitest runs serially** (`fileParallelism: false` in `vitest.config.ts`) because MCP server tests open real TCP sockets; parallel file execution causes port collisions on some platforms. This is intentional and should not be changed.
- **The `vscode` module is mocked** via `vitest.config.ts` alias — tests never need a real VS Code instance. The mock lives at `test/mocks/vscode.ts`.
- **Bundle budget**: The bundle budget is **155 KB** for `dist/extension.js`, enforced in `esbuild.js` and CI. Check with `wc -c dist/extension.js` after building.
- **verify-install script** (`scripts/verify-install.cjs`): Loads the bundled extension with a vscode stub and calls `activate()`. Some assertion failures about `activationEvents` are expected when run against the current manifest — the script checks for `onStartupFinished` and per-command activation events that the extension intentionally omits in favor of lazy activation.
- **E2E tests** (`npm run test:e2e`) require a real VS Code Electron instance and `xvfb-run -a` on headless Linux. These are not part of the standard CI loop for unit testing.
- **Test descriptions** use Italian language (`dovrebbe …`) per project convention.
