# Warp Bridge for VS Code — v0.7.1

**Release date:** 2026-04-20
**Type:** Hardening / patch release on top of v0.7.0.

## Highlights

- **Warp Drive — Oz CLI source wired (RF-5).** The Warp Drive sidebar
  now consumes a `CompositeDriveSource` that prefers the Oz CLI and
  transparently falls back to the filesystem source when the binary
  lacks the `drive` subcommand. No user-visible change until the CLI
  ships the endpoints; the fallback path is identical to v0.7.0
  production behaviour.
- **MCP HTTP+SSE end-to-end smoke tests.** First three integration
  tests walking the full client handshake (open `/sse` → consume the
  `endpoint` frame → POST a `tools/call` JSON-RPC request → assert the
  SSE `message` frame carries the response), plus rejection of unknown
  `sessionId` and malformed JSON body.

## Changes

### Added

- `OzCliService.driveList(category)` and `driveGet(id)` (sanitised id,
  JSON parsing, raw markdown body).
- `src/drive/ozCliDriveRunner.ts` — thin adapter implementing
  `CliDriveRunner` over `IOzCliService`. Errors propagate unchanged so
  `CliDriveSource.isNotAvailableError` can convert "unknown command"
  stderr into the graceful filesystem fallback.
- `test/mcp/integration.test.ts` — 3 new SSE+POST end-to-end tests.

### Changed

- `IOzCliService` extended with `driveList` / `driveGet`. All test
  helpers (`createMockCli()`) updated accordingly.

## Metrics

- **Tests:** 58 files, **868** unit tests, all green.
- **Bundle:** `dist/extension.js` at **86.22 KB** (within the 90 KB
  budget).
- **VSIX:** **60.67 KB**.

## Compatibility

- VS Code engine: unchanged from v0.7.0.
- Settings, commands, MCP surface and Warp Drive UX: unchanged.
- No migration required.

## Operational notes

- The `publish.yml` GitHub Actions workflow that targets the VS Code
  Marketplace and Open VSX requires a valid `VSCE_PAT` secret. Renew
  it before relying on the automated marketplace publish triggered by
  the `v0.7.1` tag.

## Links

- Changelog: [`CHANGELOG.md`](../CHANGELOG.md)
- Previous release: [`v0.7.0`](./RELEASE-NOTES-v0.7.0.md)
