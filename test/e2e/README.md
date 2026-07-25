# OzBridge — E2E tests (Playwright + VS Code)

This suite launches a real **VS Code** instance (Electron) with the
extension loaded in *development mode* through `@vscode/test-electron`,
and simulates a user who:

1. waits for the workbench to boot and checks that the extension activated;
2. opens the **Command Palette** and verifies that the `OzBridge: …`
   commands are registered;
3. opens the **OzBridge viewlet** in the activity bar and inspects the
   *Runs & Resources* and *Warp Drive* tree views;
4. runs `OzBridge: Open Dashboard` and validates the **webview** content
   (title, sections, sparkline);
5. checks that the **status bar** item is present;
6. samples **CPU/RAM** across the whole workbench process tree for the
   full duration of the run.

## Running

```powershell
npm run build           # compiles the extension into dist/ (required by the launch)
npm run test:e2e        # headless (default)
npm run test:e2e:headed # with a visible UI (local debugging)
```

> On Linux CI use `xvfb-run -a npm run test:e2e`.

On first launch, Playwright / `@vscode/test-electron` downloads VS Code
*stable* into the local `.vscode-test/` cache.

## Output and artefacts

Everything lands in `test-results/`:

| File                                          | Description                                     |
| --------------------------------------------- | ----------------------------------------------- |
| `e2e-report/index.html`                       | Playwright HTML report                          |
| `e2e.json`                                    | machine-readable JSON report                    |
| `e2e-artifacts/resource-samples.jsonl`        | resource samples (1.5 s) — one JSON per line    |
| `e2e-artifacts/resource-summary.json`         | aggregate (peak/avg CPU%, peak/avg RSS MB)      |
| `e2e-artifacts/<test-name>/trace.zip`         | Playwright trace (on failure only)              |
| `e2e-artifacts/<test-name>/video.webm`        | Electron video (on failure only)                |

## Resource monitor

`test/e2e/helpers/resourceMonitor.ts` uses `Get-CimInstance` on Windows and
`ps` on Unix to reconstruct the process tree from the main Electron PID,
then computes total RSS and incremental CPU%. No native dependencies.

Samples also carry `loadAvg1m` and system free/total memory, to make it
easier to correlate results with CI slowdowns.

## Notes

- The script sets `OZBRIDGE_E2E=1`: the extension can read it to avoid
  spawning the real Oz CLI during tests.
- The test workspace is a temporary folder holding a single `README.md`,
  removed afterwards.
- Tests run `fullyParallel: false` with `workers: 1`: one VS Code instance
  per run, which is more reliable and quieter for the monitor.
