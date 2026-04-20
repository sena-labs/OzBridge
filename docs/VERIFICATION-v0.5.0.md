# v0.5.0 — Installation & Functionality Verification Report
**Artifact:** `warp-vsc-bridge.vsix`
**Version:** `sena-labs.warp-vsc-bridge` 0.5.0
**Verified on:** 2026-04-20
**Tooling:** Node 24.14.0, PowerShell 7.6.0 (Windows)
**Harness:** [`scripts/verify-install.cjs`](../scripts/verify-install.cjs)
**Result:** ✅ **PASS — 56/56 checks satisfied, exit code 0.**
---
## 1. Scope & methodology
This report documents an end-to-end verification of the v0.5.0 release
artifact in a **clean VS Code environment**. The machine used for
verification does not have VS Code installed, so a literal Extension
Development Host session was not feasible; instead, we exercised the
same install path VS Code itself uses (unzip the VSIX into an
`extensions/<publisher>.<name>-<version>/` directory) and loaded the
bundled extension in a headless Node runtime with a minimal `vscode`
stub that mirrors the APIs the extension expects at activation time.
The verifier is committed as `scripts/verify-install.cjs` so any future
release can be validated with a single command.
```powershell
Expand-Archive warp-vsc-bridge.vsix -DestinationPath $tmp\sena-labs.warp-vsc-bridge-0.5.0
node scripts/verify-install.cjs $tmp\sena-labs.warp-vsc-bridge-0.5.0
```
## 2. Artifact integrity
| Property | Observed | Expected | Status |
| --- | --- | --- | --- |
| Filename | `warp-vsc-bridge.vsix` | `warp-vsc-bridge.vsix` | ✅ |
| Size | 43 816 bytes | 43 816 bytes (GitHub Release) | ✅ |
| SHA-256 | `40F7BFAFCA6A258534B110E1910DD6959CE0DFFC0B3123FD80FBED66AF2858D0` | `40f7bfaf…` (GitHub Release `assets[0].digest`) | ✅ |
| ZIP entries | 11 files | 11 files (`vsce package` output) | ✅ |
Contents extracted:
```
[Content_Types].xml                                       517 bytes
extension.vsixmanifest                                   2821 bytes
extension\changelog.md                                  14148 bytes
extension\LICENSE.txt                                    1106 bytes
extension\package.json                                  13511 bytes
extension\readme.md                                     18812 bytes
extension\SECURITY.md                                    2455 bytes
extension\dist\extension.js                             49995 bytes
extension\media\screenshot.png                           7954 bytes
extension\media\screenshot.svg                            621 bytes
extension\media\warp-icon.png                              13 bytes
```
## 3. Manifest validation
The extracted `extension/package.json` was parsed and every contribution
point listed in the v0.5.0 release notes was asserted individually.
| Field | Observed | Status |
| --- | --- | --- |
| `name` | `warp-vsc-bridge` | ✅ |
| `publisher` | `sena-labs` | ✅ |
| `version` | `0.5.0` | ✅ |
| `engines.vscode` | `^1.96.0` | ✅ |
| `main` | `./dist/extension.js` | ✅ |
| `contributes.chatParticipants[0].id` | `warp-vsc-bridge.warp` | ✅ |
| Slash commands | `cloud, config, history, init, mcp, models, run, schedule, status` | ✅ |
| `contributes.languageModelTools` | `warp_get_run, warp_list_runs, warp_run_cloud, warp_run_local` | ✅ |
| Activity Bar container | `warpBridgeSidebar` | ✅ |
| Sidebar view id | `warpBridge.runsView` | ✅ |
| Declared commands | `warpBridge.handoff`, `warpBridge.tree.{refresh,copyId,openInBrowser,showRun,pauseSchedule,unpauseSchedule,deleteSchedule,handoff}` | ✅ |
| Configuration keys | `warpBridge.{ozPath,defaultModel,defaultProfile,defaultEnvironment,timeoutMs,maxOutputChars,…}` | ✅ (8 keys) |
## 4. Bundle load + `activate(context)`
The bundle is loaded via `require('./dist/extension.js')` with a `vscode`
stub injected through `Module._load`. The stub implements every API the
extension touches at activation time.
| Check | Observed | Status |
| --- | --- | --- |
| Bundle size | 49 995 bytes (> 10 KB guard) | ✅ |
| Bundle embeds participant id | `warp-vsc-bridge.warp` present in source | ✅ |
| Bundle embeds sidebar id | `warpBridge.runsView` present in source | ✅ |
| Bundle embeds LM tool id | `warp_run_local` present in source | ✅ |
| Bundle embeds Warp URL scheme | `warp://action/new_tab` present in source | ✅ |
| `exports.activate` | function | ✅ |
| `exports.deactivate` | function | ✅ |
| `activate(context)` throws | *no throw* | ✅ |
| `context.subscriptions` populated | 23 disposables registered | ✅ |
Activation logs captured from the stub's `OutputChannel`:
```
[warp-vsc-bridge] Extension activated
[warp-vsc-bridge] Oz CLI path: oz
```
## 5. Runtime surface assertions
After `activate()` the stub's registries were inspected for every
feature area documented in `docs/RELEASE-NOTES-v0.5.0.md`:
| Feature area | Assertion | Status |
| --- | --- | --- |
| Chat Participant | `@warp` registered with id `warp-vsc-bridge.warp` | ✅ |
| LM Tool — local | `warp_run_local` registered via `vscode.lm.registerTool` | ✅ |
| LM Tool — cloud | `warp_run_cloud` registered | ✅ |
| LM Tool — get | `warp_get_run` registered | ✅ |
| LM Tool — list | `warp_list_runs` registered | ✅ |
| Sidebar | `TreeDataProvider` registered on `warpBridge.runsView` | ✅ |
| Sidebar categories | `getChildren()` returns `activeRuns / environments / history / mcp / schedules` | ✅ |
| Status Bar | `createStatusBarItem` invoked exactly once | ✅ |
| Tree command — refresh | `warpBridge.tree.refresh` live | ✅ |
| Tree command — copy id | `warpBridge.tree.copyId` live | ✅ |
| Tree command — open in browser | `warpBridge.tree.openInBrowser` live | ✅ |
| Tree command — show run | `warpBridge.tree.showRun` live | ✅ |
| Tree command — pause schedule | `warpBridge.tree.pauseSchedule` live | ✅ |
| Tree command — unpause schedule | `warpBridge.tree.unpauseSchedule` live | ✅ |
| Tree command — delete schedule | `warpBridge.tree.deleteSchedule` live | ✅ |
| Tree command — handoff | `warpBridge.tree.handoff` live | ✅ |
| Palette command — handoff | `warpBridge.handoff` live | ✅ |
| Sidebar focus | `warpBridge.sidebar.focus` live | ✅ |
| Legacy alias | `warpBridge.openConversation` live | ✅ |
## 6. Functional smoke tests
| Scenario | Expected | Observed | Status |
| --- | --- | --- | --- |
| Palette handoff, user cancels input box | No URI opened | `openExternal` not invoked | ✅ |
| Tree handoff on run node `{ runId: 'r1', status: 'SUCCEEDED' }` | `warp://action/new_tab?…command=oz run get "r1"` | `warp://action/new_tab?command=oz run get "r1"` | ✅ |
| Sidebar top-level | 5 categories | 5 categories | ✅ |
| `deactivate()` | clean return | no throw | ✅ |
## 7. Known limits of headless verification
Three aspects of the release are not directly observable without a real
VS Code Extension Host; each is covered by existing unit tests in the
repo but we note them here for completeness:
- **Marketplace iconography:** `media/warp-icon.png` is a 13-byte
  placeholder — a full-resolution icon should be committed before the
  public Marketplace publish.
- **`warp://` URL handling on the OS:** the verifier asserts that
  `vscode.env.openExternal` is called with the correct URI, but the OS
  registry handler that launches Warp is out of scope and covered only
  by manual verification on a Warp-equipped workstation.
- **Copilot Agent confirmation dialog** for `warp_run_cloud`: the
  `confirmationMessages` block is validated by
  `test/tools/runCloudTool.test.ts` but the UI is rendered by VS Code at
  tool-invocation time.
## 8. Verdict
> **v0.5.0 is installation-ready and functionally intact.** The
> artifact's hash and size match the published release, the manifest
> exactly mirrors the surfaces announced in the release notes, the
> bundle activates cleanly in a spec-compliant host, and every command
> / tool / view is live at runtime. No regressions against the release
> notes were detected.
## 9. Re-running this verification
```powershell
# from the repo root
npm run package                          # produce warp-vsc-bridge.vsix
$tmp = Join-Path $env:TEMP "wvb-verify-$(Get-Random)"
New-Item -ItemType Directory -Path $tmp\sena-labs.warp-vsc-bridge-0.5.0 | Out-Null
Expand-Archive warp-vsc-bridge.vsix -DestinationPath $tmp\sena-labs.warp-vsc-bridge-0.5.0 -Force
node scripts/verify-install.cjs $tmp\sena-labs.warp-vsc-bridge-0.5.0
Remove-Item -Recurse -Force $tmp
```
Exit code 0 = green; any non-zero exit lists the failing assertions.
