# OzBridge — Independent QA Audit Report

**Scope**: VS Code extension `sena-labs.ozbridge` v1.1.0 (folder `WARP-VSC`).
**Audit date**: 2026-04-23
**Method**: static analysis of `package.json`, `src/**`, `test/**`, plus 7 new executable audit tests (`test/audit/**`) run against the current tree.
**Baseline**: all 1135 pre-existing unit tests pass. All defects below are **novel findings** not covered by the existing suite.

---

## 1. Normalized Product Requirements (PRD derived from code + docs)

OzBridge is a VS Code chat-first bridge to the **Warp Oz agent CLI**. It exposes:

| Surface | Entry point | Purpose |
|---|---|---|
| **Chat Participant `@oz`** | `contributes.chatParticipants[ozbridge.oz]` + `src/participant/handler.ts` | Slash-commands `/run /cloud /status /history /schedule /models /mcp /config /init` |
| **Language Model Tools** | `contributes.languageModelTools[oz_run_local / oz_run_cloud / oz_get_run / oz_list_runs]` + `src/tools/*` | Copilot Agent-mode invocation of Oz runs |
| **Runs & Resources sidebar** | `ozBridge.runsView` tree + `src/ui/runsTreeProvider.ts` | Active runs, history, schedules, environments, MCP servers |
| **Warp Drive sidebar** | `ozBridge.driveView` tree + `src/ui/driveTreeProvider.ts` | Prompts/rules/skills with CLI primary + filesystem fallback |
| **Dashboard webview** | Command `ozBridge.dashboard.open` + `src/ui/dashboardPanel.ts` | Per-day run stats, success rate, sparkline |
| **Status Bar** | `src/ui/statusBarItem.ts` | Live indicator of active runs, click → focus sidebar |
| **Warp handoff** | Commands `ozBridge.handoff` / `ozBridge.tree.handoff` → `warp://action/new_tab?…` | Open Warp terminal with seeded command |
| **Skill editor** | Commands `ozBridge.skill.{edit,new,saveGlobal,saveWorkspace}` | Create/save Warp skill files globally or per-workspace |
| **MCP server export** | `ozBridge.mcp.{start,stop,status,copyEndpointUrl,registerClient,unregisterClient}` + `src/mcp/*` | Expose Oz as an MCP server for Claude Code / Cursor / Codex |
| **Failure triage** | Command `ozBridge.triageFailure` | LM-assisted analysis of failed run output |
| **Dataset export** | Command `ozBridge.exportDataset` | JSONL/CSV export of history |
| **Walkthrough** | `ozBridge.gettingStarted` (4 steps) | First-activation onboarding |
| **Kill-switch** | `ozBridge.killSwitch.enabled` setting | Operator escape hatch — blocks all wiring |
| **Telemetry** | `ozBridge.telemetry.connectionString` | Opt-in AppInsights, default noop |
| **Localization** | `l10n/` + 6 `package.nls.*.json` files | en/de/es/fr/it/zh-cn |

**Config surface** (`contributes.configuration.properties`): 14 keys — CLI path, defaults, polling/timeouts, MCP port/bind/token, telemetry, kill-switch.

**Activation events declared**: `onChatParticipant:ozbridge.oz`, 4× `onLanguageModelTool:*`, 2× `onView:warpBridge.*`, `onCommand:warpBridge.dashboard.open`.

---

## 2. Risk-Ranked Test Plan

Ordered by production blast radius × likelihood. Each bucket lists the concrete checks I ran and which are covered by new audit tests (`test/audit/`).

### P0 — Blocks first-run UX (release blocker)

| # | Risk | Check | Status |
|---|---|---|---|
| 1.1 | Activation events typo: `warpBridge.*` vs real `ozBridge.*` IDs | Parse `package.json` and cross-check every `onView:`/`onCommand:` | ❌ **FAILS** (2 dangling events) — `activationEventsExtended.test.ts` |
| 1.2 | Commands contributed in palette but unimplemented | Walk `src/**/registerCommand(...)` vs `contributes.commands` | ✅ PASS — `commandsDeclaredVsImplemented.test.ts` |

### P1 — Runtime correctness / resource safety

| # | Risk | Check | Status |
|---|---|---|---|
| 2.1 | `ActiveRunsTracker.tick()` overlaps under slow CLI → concurrent `runList` requests | Lag-injected CLI + 20 ms interval / 60 ms lag → measure concurrent in-flight | ❌ **FAILS** (3 concurrent) — `activeRunsTrackerOverlap.test.ts` |
| 2.2 | `WorkspaceConfigResolver` frozen at activation — no-workspace mode, multi-root | Build resolver with `undefined`, open folder after, `.refresh()` | ❌ Documents immutable behavior — `workspaceConfigMultiRoot.test.ts` |
| 2.3 | `readMcpConfig()` accepts invalid ports (`>65535`, `Infinity`, fractional) | Unit-test `readMcpConfig` with hostile inputs + assert schema bounds | ❌ **FAILS** (4 cases) — `mcpPortValidation.test.ts` |

### P2 — Security & supply-chain smells

| # | Risk | Check | Status |
|---|---|---|---|
| 3.1 | Status-bar tooltip renders CLI run IDs with `MarkdownString.isTrusted = true` and no sanitizer | Structural scan of `statusBarItem.ts` for isTrusted + id interpolation, look for sanitizer | ❌ **FAILS** — `statusBarTooltipInjection.test.ts` |
| 3.2 | Dashboard webview uses `Math.random()` nonce | Static inspection `dashboardPanel.ts` | ⚠️ Code smell (low severity — nonces don't need crypto entropy, but best practice is `crypto.randomBytes`) |
| 3.3 | Error-fallback HTML branch of `DashboardPanel.refresh()` drops `img-src` CSP directive | Static inspection | ⚠️ Low — branch renders plain text only, mostly cosmetic |

### P3 — API / maintainability

| # | Risk | Check | Status |
|---|---|---|---|
| 4.1 | `HandoffDeps.cfgMgr` declared but unused | Grep `deps.cfgMgr`/`cfgMgr.` inside `handoff.ts` | ❌ **FAILS** — `handoffCfgMgrUnused.test.ts` |
| 4.2 | `shellQuote()` in `handoff.ts` escapes only POSIX metacharacters; Windows `cmd.exe` has distinct rules | Read + reason | ⚠️ Platform-specific, needs manual verification on Windows |
| 4.3 | `manifestActivationConsistency.test.ts` only audits chat/LM tool events, not views/commands | Review existing test | ⚠️ Coverage gap (caused 1.1 to ship) |

---

## 3. Confirmed Bug Reports

### BUG-1 · CRITICAL — Activation events reference stale `warpBridge.*` IDs (confirmed)

**Severity**: Critical · **Confidence**: Certain · **Status**: Confirmed by failing test

- **Files**: `package.json` lines 33–35
- **Repro**:
  1. Install the `.vsix` on a fresh VS Code.
  2. Before activating `@oz` chat or any `oz_*` LM tool, click the **OzBridge sidebar** icon or run the command **"OzBridge: Open dashboard"** from the palette.
  3. Observe: the view stays empty / the dashboard command is reported as *not found* until the chat participant fires.
- **Root cause**: `activationEvents` still contains the old prefix from the `warp-bridge` → `ozbridge` rename:
  ```json
  "onView:warpBridge.runsView",
  "onView:warpBridge.driveView",
  "onCommand:warpBridge.dashboard.open"
  ```
  while `contributes.views` declares `ozBridge.runsView` / `ozBridge.driveView` and the command is `ozBridge.dashboard.open`.
- **Fix**: rename all three to `ozBridge.*`.
- **Evidence**: `test/audit/activationEventsExtended.test.ts` — 2 failing assertions.

### BUG-2 · HIGH — `ActiveRunsTracker.tick()` overlaps under slow CLI

**Severity**: High · **Confidence**: Certain · **Status**: Confirmed by failing test (3 concurrent requests observed)

- **File**: `src/services/activeRunsTracker.ts` lines 103–125, 150
- **Repro**: inject a `cli.runList()` implementation that sleeps 60 ms, construct `ActiveRunsTracker(cli, 20)`, wait 200 ms. Observed 7 starts vs 4 finishes → 3 overlapping.
- **Root cause**: `setInterval(() => { void this.tick(); }, this.intervalMs)` does not check whether a previous `tick()` is still in-flight. The `starting` flag introduced for the `start()` re-entry bug does NOT serialize subsequent ticks.
- **Impact**: under credit exhaustion or network degradation (when `runList` becomes slow), the extension fan-outs repeated CLI calls, increasing load, scrambling `onDidChange` ordering, and hiding the underlying slowness.
- **Suggested fix**: introduce an `inFlight: Promise<void> | null` guard and skip (or chain) when non-null, OR switch from `setInterval` to a self-scheduling `setTimeout` recursion fired from inside the `tick` callback.
- **Evidence**: `test/audit/activeRunsTrackerOverlap.test.ts`.

### BUG-3 · HIGH — MCP port configuration accepts out-of-range values

**Severity**: High · **Confidence**: Certain · **Status**: Confirmed by failing test (4 cases)

- **Files**: `src/mcp/lifecycle.ts` line 25 (`readMcpConfig`), `package.json` line 530–534 (`ozBridge.mcpPort` schema)
- **Repro**: set `ozBridge.mcpPort = 99999` (or `Infinity`, or `3847.5`). Observe: auto-start fails at `server.listen(99999)` with `RangeError`.
- **Root cause**: guard is only `typeof === 'number' && value >= 0`. Missing upper bound (`<= 65535`) and integer check.
- **Suggested fix** (two layers):
  1. In `readMcpConfig`: `Number.isInteger(full.mcpPort) && full.mcpPort >= 0 && full.mcpPort <= 65535`.
  2. In `package.json`: add `"minimum": 0, "maximum": 65535` to `ozBridge.mcpPort` property.
- **Evidence**: `test/audit/mcpPortValidation.test.ts`.

### BUG-4 · MEDIUM — WorkspaceConfigResolver is permanently bound to the first workspace folder at activation

**Severity**: Medium · **Confidence**: Certain · **Status**: Documented via test

- **Files**: `src/services/workspaceConfigResolver.ts` lines 99–119, `src/extension.ts` line 91
- **Repro scenarios**:
  - **Single-file mode**: open a single file in VS Code → chat invokes `@oz` (this triggers `onChatParticipant` activation). Resolver is created with `undefined`. Later opening a workspace folder does **not** bind its `.warp/warp-bridge.yaml` overrides until window reload.
  - **Multi-root**: only the first folder's YAML is observed; the other roots' configuration is silently ignored.
- **Root cause**: `vscode.workspace.onDidChangeWorkspaceFolders` is never wired. `workspaceRoot` is a `readonly` constructor parameter.
- **Suggested fix**: in the resolver (or a thin adapter in `extension.ts`) subscribe to `onDidChangeWorkspaceFolders`, dispose the current `FileSystemWatcher`, re-bind to the first folder, and re-emit overrides. For multi-root, consider merging overrides from all roots with clear precedence rules documented in `CONTRIBUTING.md`.
- **Evidence**: `test/audit/workspaceConfigMultiRoot.test.ts`.

### BUG-5 · MEDIUM (security smell) — Trusted MarkdownString interpolates CLI-provided run IDs without sanitization

**Severity**: Medium · **Confidence**: Likely · **Status**: Confirmed code smell, narrow exploitability

- **File**: `src/ui/statusBarItem.ts` lines 90–109 (`buildTooltip`)
- **Root cause**: the function sets `md.isTrusted = true`, which authorizes `command:` links to execute VS Code commands. Run IDs returned by `oz run list` are interpolated directly inside a backtick code span (`` `${r.id}` ``). A crafted id containing a raw backtick (or a compromised CLI output) would break out of the code span and the resulting markdown would be parsed as trusted.
- **Threat model**: tooltip content originates from a local child process (the `oz` CLI). This is a narrow attack surface, but: `ActiveRunsTracker` only filters empty strings, and there is no explicit whitelist (e.g. `/^[a-zA-Z0-9-]+$/`). Any regression in the CLI format (or a malicious MCP client / substitute binary) can weaponize the tooltip.
- **Suggested fix**:
  - **Preferred**: drop `md.isTrusted = true` on this tooltip — it is never a destination for command links.
  - **Alternative**: validate every `r.id` against a strict regex before interpolation; skip the row otherwise.
- **Evidence**: `test/audit/statusBarTooltipInjection.test.ts`.

### BUG-6 · LOW — `HandoffDeps.cfgMgr` is declared but never consumed

**Severity**: Low · **Confidence**: Certain · **Status**: Confirmed by failing test

- **File**: `src/ui/handoff.ts` lines 102–138
- **Root cause**: public interface forces callers to inject a `ConfigManager` that the function body never references.
- **Impact**: misleading API; callers (and tests) create unnecessary fixtures; may indicate an incomplete feature (e.g. defaulting Warp profile/environment on handoff).
- **Suggested fix**: either wire `cfgMgr.getConfig().defaultProfile` into `buildHandoffCommand` when a prompt is present, or remove `cfgMgr` from `HandoffDeps` and the caller in `extension.ts`.
- **Evidence**: `test/audit/handoffCfgMgrUnused.test.ts`.

---

## 4. Risks / Code Smells Needing Manual Review (no automated proof)

1. **`shellQuote` in `src/ui/handoff.ts` lines 152–164** — Comment claims cross-platform adequacy, but the escape set `[\\$"`]` is POSIX-only. On Windows Warp may spawn `cmd.exe`, where `%VAR%` expansion and caret-escaping rules are different. Recommend a platform switch or pinning Warp's default shell in docs.
2. **`DashboardPanel.renderDashboardHtml` line 85 CSP** — `img-src ${cspSource} data:;` but no `img` tags are ever rendered in the main HTML (only the error-fallback drops the directive). Review to decide whether `data:` should be allowed at all.
3. **`generateNonce()` uses `Math.random()`** — VS Code's built-in `crypto.getRandomValues` or Node `crypto.randomBytes` would be safer; nonce predictability theoretically enables CSP bypass combined with an XSS vector. Low severity because the panel's body is server-rendered by the extension.
4. **Telemetry payload key filter** — tests show `'errorRaised': forbidden keys prompt` path. Confirm the allow-list is kept in sync when new events are added (`errorRaised` is generic and may accidentally leak context in the future).
5. **`deactivate()`** returns a single `state.mcp?.dispose()` promise but also triggers synchronous disposal of `runPoller` and `tracker`. If `state.mcp?.dispose()` rejects the extension host can log an error and abandon cleanup of subsequent subscriptions — consider `Promise.allSettled`.
6. **Large-repo activation perf** — `test/activationPerf.test.ts` exists; ensure it also exercises `tracker.start()` path so it catches the BUG-2 overlap scenario in CI when Oz CLI is slow.
7. **`firstWorkspaceFolderPath()` vs chat participant activation** — activation via `onChatParticipant` fires even in non-workspace mode; every subsequent `@oz` interaction will run without overrides until the window is reloaded (see BUG-4).
8. **Kill-switch** registers no disposables but also does not cleanup `outputChannel` subscription in that branch: `outputChannel` is pushed to `context.subscriptions` before the kill-switch check, so it is disposed. ✓ OK.
9. **`openConversation` URI handler** accepts any `vscode.Uri` from `registerCommand` — no origin check. An in-product actor (another extension) could invoke it with an arbitrary URI. Low severity (any extension can already call `vscode.env.openExternal`).
10. **Drive CLI runner silent fallback** — intentional for forward compatibility, but there is no user-visible surface telling them whether they are reading from the CLI or the filesystem; consider surfacing the mode in the tree header when they differ.

---

## 5. Final Defect Summary (sorted by severity × confidence)

| ID | Severity | Confidence | Title | Evidence |
|---|---|---|---|---|
| BUG-1 | Critical | Certain | Activation events reference stale `warpBridge.*` IDs | `test/audit/activationEventsExtended.test.ts` |
| BUG-2 | High | Certain | `ActiveRunsTracker.tick()` overlaps under slow CLI | `test/audit/activeRunsTrackerOverlap.test.ts` |
| BUG-3 | High | Certain | MCP port accepts `>65535` / `Infinity` / fractional values; no schema bounds | `test/audit/mcpPortValidation.test.ts` |
| BUG-4 | Medium | Certain | Workspace config resolver frozen at activation (no-workspace + multi-root) | `test/audit/workspaceConfigMultiRoot.test.ts` |
| BUG-5 | Medium | Likely | Trusted tooltip with unsanitized CLI IDs | `test/audit/statusBarTooltipInjection.test.ts` |
| BUG-6 | Low | Certain | `HandoffDeps.cfgMgr` dead dependency | `test/audit/handoffCfgMgrUnused.test.ts` |
| RISK-1 | Medium | Needs manual | Windows `cmd.exe` escaping in `shellQuote` | code review |
| RISK-2 | Low | Needs manual | Weak nonce in Dashboard CSP | code review |
| RISK-3 | Low | Needs manual | Error-fallback HTML drops `img-src` CSP | code review |
| RISK-4 | Low | Needs manual | `deactivate()` lacks `allSettled` cleanup | code review |

**Blocker for release**: BUG-1 (first-run UX regression), BUG-3 (auto-start crash on invalid port).

---

## 6. Added audit tests

| File | Assertions | Failing today | Purpose |
|---|---|---|---|
| `test/audit/activationEventsExtended.test.ts` | 3 | 2 | Closes the gap in `manifestActivationConsistency.test.ts` |
| `test/audit/commandsDeclaredVsImplemented.test.ts` | 2 | 0 | Prevent regression of manifest vs runtime drift |
| `test/audit/activeRunsTrackerOverlap.test.ts` | 1 | 1 | Reproduces BUG-2 deterministically |
| `test/audit/workspaceConfigMultiRoot.test.ts` | 2 | 0 | Documents BUG-4 invariants for future fix |
| `test/audit/statusBarTooltipInjection.test.ts` | 1 | 1 | Reproduces BUG-5 code smell |
| `test/audit/mcpPortValidation.test.ts` | 4 | 4 | Reproduces BUG-3 |
| `test/audit/handoffCfgMgrUnused.test.ts` | 1 | 1 | Reproduces BUG-6 |

Run with: `npm test -- test/audit/`.

---

## 7. Suggested fix ordering (smallest-first)

1. **BUG-1** — 1 line × 3 occurrences in `package.json`. Zero runtime risk. (ship today.)
2. **BUG-3** — `readMcpConfig` tighten guard + add `minimum/maximum` in schema.
3. **BUG-6** — remove `cfgMgr` from `HandoffDeps` (breaking for callers inside the repo — one call site).
4. **BUG-5** — drop `md.isTrusted = true` on the status-bar tooltip.
5. **BUG-2** — introduce in-flight guard in `ActiveRunsTracker.tick()`.
6. **BUG-4** — subscribe to `onDidChangeWorkspaceFolders` and propagate overrides.

All changes come with failing tests already in place — each fix will flip a test green, giving a clean regression signal.
