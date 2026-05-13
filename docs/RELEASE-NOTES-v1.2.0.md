# OzBridge for VS Code — v1.2.0 Release Notes

**Release date:** 2026-05-13
**Codename:** Secrets & Schedules
**Predecessor:** [`v1.1.0`](RELEASE-NOTES-v1.1.0.md) (OzBridge rebrand)
**Changelog:** [`CHANGELOG.md § [1.2.0]`](../CHANGELOG.md)

---

## TL;DR

v1.2.0 is the **feature completeness + security hardening** release.
Three major user-facing features land (secrets management, schedule
editing, artifact download) alongside a wave of audit-driven fixes
that close all CRITICAL and HIGH findings from the v1.2 security review.

---

## Footprint

| Metric | v1.1.0 | v1.2.0 | Δ |
|---|---|---|---|
| Tests | 1 378 / 1 378 | **1 378 / 1 378** | — |
| Bundle (`dist/extension.js`) | ~148 KB | **~151 KB** / 155 KB budget | +3 KB |
| Production CVEs | 0 | **0** | — |
| Production runtime deps | 3 | **3** | — |
| VS Code engine | `^1.96.0` | `^1.96.0` | — |
| Locales (`vscode.l10n`) | en/de/es/fr/it/zh-cn | en/de/es/fr/it/zh-cn | — |
| New commands | — | **+6** | +6 |
| New tree categories | — | **+1** (Secrets) | +1 |

---

## What landed

### 1 — Secrets management

Full CRUD workflow for Warp secrets from within VS Code.

- **Tree category**: a new **Secrets** node in the Activity Bar sidebar
  lists every secret returned by `oz secret list`, with icon `key` and
  scope/type badge.
- **Commands**: `createSecret`, `updateSecret`, `deleteSecret` (with
  modal confirmation), `copySecretName` — all accessible from the
  inline context menu.
- **Security-first storage**: secret *values* are piped through stdin
  only when calling `oz secret create` / `oz secret update --value`.
  They never appear in `argv` (visible via `ps` / Task Manager) or in
  the environment block.
- **Graceful degradation**: on older Warp CLIs that do not yet expose
  the `secret` subcommand the category renders an informational message
  instead of crashing the tree.

### 2 — Schedule editing

Users can now inspect and modify scheduled runs without leaving the
editor.

- `/schedule get <id>` — prints the full schedule record in the chat.
- `/schedule update <id> [--name "x"] [--cron "y"] [--prompt "z"]` —
  applies only the flags provided; unchanged fields are not sent.
- **Inline action**: the **Edit Schedule…** context menu on any running
  or paused schedule node in the tree opens an interactive quick-pick
  flow for in-place editing.
- **Bug fix**: the previous implementation accidentally passed the
  schedule ID into the flag parser, so `--name` and `--cron` were never
  applied. This is now fixed.

### 3 — Artifact download

- **Download Artifact…** (`ozBridge.tree.downloadArtifact`) opens a
  native Save dialog pre-filled with the filename from artifact metadata.
- On success, a notification offers *Reveal in Explorer*.
- Output paths are validated to reject empty values and NUL bytes
  before reaching the CLI.

---

## Audit fixes (CRITICAL + HIGH)

All findings from the internal v1.2 security audit are closed.

| ID | Area | Resolution |
|---|---|---|
| CRIT-1 | `oz agent run --continue` unrecognised flag | Corrected to `--conversation <ID>`; `RunSteerer` fallback retained for old CLIs |
| CRIT-2 | Missing `capabilities` block in `package.json` | Added `untrustedWorkspaces` + `virtualWorkspaces` declarations |
| CRIT-3 | `getParent()` not implemented on tree providers | Implemented on both `OzRunsTreeProvider` and `DriveTreeProvider` |
| HIGH-2 | Empty sidebar with no guidance | Added `viewsWelcome` entries for both `runsView` and `driveView` |
| HIGH-4 | Unhandled exceptions in chat sub-commands | Top-level `try/catch` in `createHandler()` — errors → friendly markdown; `CancellationError` re-thrown |
| HIGH-5 | Missing `engines.node` constraint | Added `"node": ">=20.19"` |
| HIGH-6 | Status bar tooltip strings not localised | All strings now wrapped in `vscode.l10n.t()` across all six locales |

---

## Improvements (MEDIUM audit items)

| ID | Area | Change |
|---|---|---|
| MED-1 | Activation events | Removed all redundant `onCommand:*` events (VS Code 1.74+ handles these automatically); 7 events remain |
| MED-3 | LM tools input validation | `oz_list_runs` rejects non-integer or non-positive `limit` before calling the CLI |
| MED-6 | Env blocklist | Extended with `GITLAB_TOKEN`, `JIRA_API_TOKEN`, `SLACK_TOKEN`, `STRIPE_*`, `TWILIO_*` |
| MED-7 | Windows process termination | `taskkill /T /F /PID` used when `shell: true` to reap the full process tree |
| MED-8 | Tree collapse state | Each sidebar category persists its expanded/collapsed state via `globalState` |
| BUG-5 | Tooltip XSS surface | Removed `MarkdownString.isTrusted = true` from `buildTooltip()` |

---

## Developer notes

- `engines.node: ">=20.19"` is now declared; update your local toolchain if needed.
- The `capabilities.untrustedWorkspaces.supported = "limited"` declaration means the
  extension loads in Restricted Mode but disables features that require trust.
- The six new commands (`editSchedule`, `downloadArtifact`, `createSecret`,
  `updateSecret`, `deleteSecret`, `copySecretName`) follow the existing
  `ozBridge.tree.*` naming convention and are declared in `package.json`
  alongside their `when`-clause context values.
- Bundle budget remains **155 KB** (raised from 145 KB in v1.1.0 to accommodate
  the secrets/schedule/artifact surface); current size ~151 KB leaves 4 KB headroom.

---

## Upgrade from v1.1.0

No breaking changes. Install the new VSIX (or update via the Marketplace) and
reload the window. The new Secrets tree category appears automatically once the
extension activates.

If your workspace uses `ozBridge.envBlocklist` to extend the variable redaction
list, note that `GITLAB_TOKEN`, `JIRA_API_TOKEN`, `SLACK_TOKEN`, `STRIPE_*` and
`TWILIO_*` are now built-in and no longer need to be listed manually.

---

## What's next (v1.3.0)

- `noUncheckedIndexedAccess` TypeScript strictness flag
- NDJSON edge-case hardening (MED-5)
- TypeScript `paths` migration away from `baseUrl` workaround (MED-9)
