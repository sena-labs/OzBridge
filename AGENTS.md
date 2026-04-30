# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

OzBridge is a VS Code extension (TypeScript, npm workspaces) that bridges VS Code Copilot Chat with Warp Terminal's Oz AI agent CLI. It is a **pure extension** — no databases, Docker, or external services are needed for development.

### Key commands

All standard dev commands are in `package.json` scripts and documented in the `README.md` "Development" section and `CONTRIBUTING.md`:

- **Type-check:** `npm run compile`
- **Tests:** `npm test -- --run` (1338 tests, Vitest, ~13 s)
- **Build:** `npm run build` (esbuild, produces `dist/extension.js`)
- **Watch:** `npm run watch`
- **Lint:** `npm run compile` (TypeScript strict mode is the linter)

### Non-obvious caveats

- The `vscode` module is **mocked** via `vitest.config.ts` alias — tests never need a real VS Code instance. The mock lives at `test/mocks/vscode.ts`.
- `fileParallelism: false` is set in vitest config because MCP server tests open real TCP sockets; parallel file execution causes port collisions on some platforms.
- The bundle budget is **145 KB** for `dist/extension.js`, enforced in `esbuild.js` and CI. Check with `wc -c dist/extension.js` after building.
- The `copilot-chat-toolkit` sub-package (`packages/copilot-chat-toolkit`) is a `file:` dependency; `npm install` at the root handles it automatically.
- Test descriptions use Italian language (`dovrebbe …`) per project convention.
