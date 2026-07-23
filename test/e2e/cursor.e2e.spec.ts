import { test, expect } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { launchCursor, runCommand, getCursorBinaryPath, LaunchedCursor } from './helpers/launchCursor';
import {
  closePalette,
  dismissOverlays,
  listPaletteItems,
  runExactCommand,
  waitForFreshNotification,
} from './helpers/workbench';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ARTIFACTS_DIR = path.join(REPO_ROOT, 'test-results', 'e2e-artifacts');

const cursorBinary = getCursorBinaryPath({});

let cursor: LaunchedCursor;

/**
 * Cursor IDE E2E suite. Skipped by default — set
 * `OZBRIDGE_E2E_CURSOR_PATH=<absolute path to Cursor binary>` in the
 * environment to opt in. CI does not have Cursor installed so this
 * suite stays inert there; the developer running the test on a machine
 * with Cursor gets full coverage of the IDE-specific surfaces.
 */
test.describe('OzBridge — Cursor IDE E2E', () => {
  test.skip(!cursorBinary, 'OZBRIDGE_E2E_CURSOR_PATH not set; skipping Cursor E2E suite');

  test.beforeAll(async () => {
    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
    cursor = await launchCursor({ extensionPath: REPO_ROOT });
  });

  test.afterAll(async () => {
    await cursor?.dispose();
  });

  test('boot: workbench loads and OzBridge activates inside Cursor', async () => {
    const win = cursor.window;
    await expect(win.locator('.monaco-workbench')).toBeVisible();
    const ozIcons = win.locator(
      '.activitybar [aria-label*="OzBridge" i], .activitybar [title*="OzBridge" i]',
    );
    await expect(ozIcons.first()).toBeVisible({ timeout: 60_000 });
    expect(await ozIcons.count()).toBeGreaterThanOrEqual(1);
  });

  test('command palette: OzBridge commands are registered in Cursor', async () => {
    const win = cursor.window;
    await dismissOverlays(win);
    const items = await listPaletteItems(win, 'OzBridge');
    await closePalette(win);
    expect(items.length).toBeGreaterThanOrEqual(5);
    expect(items.some((it) => /Start MCP server/i.test(it))).toBe(true);
    expect(items.some((it) => /Register MCP client/i.test(it))).toBe(true);
  });

  test('MCP register Cursor: writes ~/.cursor/mcp.json with type:"sse" entry', async () => {
    const win = cursor.window;
    await dismissOverlays(win);

    // 1) Start the server first.
    await runExactCommand(win, 'OzBridge: Start MCP server');
    const startToast = await waitForFreshNotification(win, null, 12_000);
    expect(startToast, 'start: nessun toast').toBeTruthy();
    expect(startToast!).toMatch(/MCP|listening|http/i);
    await dismissOverlays(win);

    // 2) Invoke the registrar; it pops a QuickPick — pick the Cursor entry.
    await runCommand(win, 'OzBridge: Register MCP client');
    const cursorPick = win.locator('.quick-input-widget .monaco-list-row', { hasText: /Cursor/i });
    await expect(cursorPick.first()).toBeVisible({ timeout: 10_000 });
    await cursorPick.first().click();
    const registeredToast = await waitForFreshNotification(win, startToast, 12_000);
    expect(registeredToast, 'register: nessun toast').toBeTruthy();
    expect(registeredToast!).toMatch(/Registered|Cursor/i);
    await dismissOverlays(win);

    // 3) Verify the on-disk format. The launcher started Cursor with
    //    `HOME`/`USERPROFILE` pointed at a tmp directory (see
    //    `launchCursor`), so the registrar — which resolves
    //    `~/.cursor/mcp.json` via `os.homedir()` inside the extension
    //    host — writes to the tmp file, not the developer's real one.
    const cursorConfigPath = path.join(cursor.homeDir, '.cursor', 'mcp.json');
    const raw = await fs.readFile(cursorConfigPath, 'utf8');
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, Record<string, unknown>> };
    const entry = parsed.mcpServers?.['oz-bridge'];
    expect(entry, 'oz-bridge entry missing from ~/.cursor/mcp.json').toBeTruthy();
    // type:"sse" is required by Claude Code and harmless for Cursor.
    expect(entry!.type).toBe('sse');
    expect(typeof entry!.url).toBe('string');
    expect((entry!.url as string)).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/sse$/);

    // 4) Cleanup: unregister and stop.
    await runCommand(win, 'OzBridge: Unregister MCP client');
    const cursorPick2 = win.locator('.quick-input-widget .monaco-list-row', { hasText: /Cursor/i });
    await expect(cursorPick2.first()).toBeVisible({ timeout: 10_000 });
    await cursorPick2.first().click();
    await waitForFreshNotification(win, registeredToast, 12_000);
    await runExactCommand(win, 'OzBridge: Stop MCP server');
    await waitForFreshNotification(win, null, 8_000);
  });

  test('MCP toggle: rapid start/stop/start ends with exactly one running server (B1 regression)', async () => {
    const win = cursor.window;
    await dismissOverlays(win);

    // Drive the lifecycle commands back-to-back. Each command resolves
    // before the next is dispatched (the palette is sequential), but they
    // exercise the same enqueue/serialization path that the
    // `onConfigChanged` listener uses; a regression in B1 (where stop()
    // races start() and the second start falls back to an ephemeral port)
    // would surface here as a port mismatch in the final status toast.
    await runExactCommand(win, 'OzBridge: Start MCP server');
    const t1 = await waitForFreshNotification(win, null, 12_000);
    await runExactCommand(win, 'OzBridge: Stop MCP server');
    await waitForFreshNotification(win, t1, 8_000);
    await runExactCommand(win, 'OzBridge: Start MCP server');
    const t3 = await waitForFreshNotification(win, null, 12_000);
    expect(t3, 'final start toast missing').toBeTruthy();
    expect(t3!).toMatch(/listening|MCP|http/i);

    await runExactCommand(win, 'OzBridge: Stop MCP server');
    await waitForFreshNotification(win, t3, 8_000);
  });
});
