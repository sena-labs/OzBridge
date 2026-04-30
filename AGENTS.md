# AGENTS.md

## Cursor Cloud specific instructions

### Product overview

OzBridge is a VS Code extension (TypeScript, Node.js ≥ 20) that integrates Warp Oz AI agents into VS Code Copilot Chat. It is a self-contained extension with no databases, Docker containers, or backend services. The workspace package `copilot-chat-toolkit` (under `packages/copilot-chat-toolkit`) is a build-time dependency.

### Key commands

All standard dev commands are in `package.json` scripts and documented in `README.md` and `CONTRIBUTING.md`. Quick reference:

| Task | Command |
|---|---|
| Type-check (lint) | `npm run compile` |
| Unit tests | `npm test` (or `npm test -- --run` for non-watch) |
| Build bundle | `npm run build` |
| Dev watch mode | `npm run watch` |
| Package VSIX | `npm run package` |
| Test with coverage | `npm run test:coverage` |

### Non-obvious notes

- **Workspace package build order**: The `copilot-chat-toolkit` package must be built (`npm run build --workspace=copilot-chat-toolkit`) before `npm run build` for the main extension if its `dist/` directory is missing. After the first build, `npm install` links it automatically.
- **Vitest runs serially** (`fileParallelism: false` in `vitest.config.ts`) because MCP server tests open real TCP sockets. This is intentional and should not be changed.
- **The `vscode` module is mocked** in tests via `test/mocks/vscode.ts` (aliased in `vitest.config.ts`). No actual VS Code instance is needed for unit tests.
- **Bundle budget**: CI enforces a 145 KB ceiling on `dist/extension.js`. Check with `wc -c dist/extension.js` after building.
- **verify-install script** (`scripts/verify-install.cjs`): Loads the bundled extension with a vscode stub and calls `activate()`. Some assertion failures about `activationEvents` are expected when run against the current manifest — the script checks for `onStartupFinished` and per-command activation events that the extension intentionally omits in favor of lazy activation.
- **E2E tests** (`npm run test:e2e`) require a real VS Code Electron instance and `xvfb-run -a` on headless Linux. These are not part of the standard CI loop for unit testing.
- **Test descriptions** are written in Italian (`dovrebbe …` convention).
