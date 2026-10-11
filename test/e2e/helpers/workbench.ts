import { Page, expect } from '@playwright/test';

/**
 * Opens the Command Palette, filters with `query`, returns the visible labels.
 * Leaves the palette open — call `closePalette` or press Escape.
 */
export async function listPaletteItems(win: Page, query: string): Promise<string[]> {
  const isMac = process.platform === 'darwin';
  await win.keyboard.press(isMac ? 'Meta+Shift+P' : 'Control+Shift+P');
  const qiw = win.locator('.quick-input-widget');
  await qiw.waitFor({ state: 'visible', timeout: 15_000 });
  const input = qiw.locator('input.input');
  await input.waitFor({ state: 'visible', timeout: 15_000 });
  await input.fill(`>${query.replace(/…/g, '').trim()}`);
  await win.waitForTimeout(400);
  const rows = qiw.locator('.monaco-list-row');
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  const count = await rows.count();
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    // The full content of the row (label + category + description).
    const text = await rows.nth(i).innerText({ timeout: 1_000 }).catch(() => '');
    if (text) labels.push(text.replace(/\s+/g, ' ').trim());
  }
  return labels;
}

export async function closePalette(win: Page): Promise<void> {
  await win.keyboard.press('Escape');
  // wait for it to close
  await win.locator('.quick-input-widget').waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
}

/**
 * Runs a command from the Command Palette. Unlike the general `runCommand`,
 * here we pick the *exact* item to avoid ambiguity when
 * the prefix matches several entries.
 */
export async function runExactCommand(win: Page, exactTitle: string): Promise<void> {
  const isMac = process.platform === 'darwin';
  const qiw = win.locator('.quick-input-widget');
  // If a previous quick-input is still visible (e.g. left by dismissOverlays
  // after runPaletteCommand), pressing Ctrl+Shift+P would toggle it closed
  // rather than open a fresh one, causing a 15s timeout.
  if (await qiw.isVisible().catch(() => false)) {
    await win.keyboard.press('Escape');
    await qiw.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
    await win.waitForTimeout(150);
  }
  // Restore keyboard focus to the VS Code window (may be lost after
  // a prior overlay was dismissed or window focus changed).
  await win.bringToFront();
  await win.waitForTimeout(100);
  await win.keyboard.press(isMac ? 'Meta+Shift+P' : 'Control+Shift+P');
  await qiw.waitFor({ state: 'visible', timeout: 15_000 });
  // The fuzzy filter may not handle the ellipsis glyph U+2026 well;
  // strip it from the search pattern.
  const query = exactTitle.replace(/…/g, '').trim();

  // Avoid relying on `.fill()` visibility heuristics (VS Code sometimes keeps
  // a non-visible quick-input <input> in the DOM while still accepting keyboard
  // input). Drive the palette via keyboard instead.
  await win.keyboard.press(isMac ? 'Meta+A' : 'Control+A').catch(() => {});
  await win.keyboard.press('Backspace').catch(() => {});
  await win.keyboard.type(`>${query}`, { delay: 10 });
  await win.waitForTimeout(350);

  // Prefer keyboard confirmation: VS Code's quick input list can exist but be
  // considered "hidden" by Playwright during transitions; pressing Enter is
  // more resilient than trying to click a row.
  await win.keyboard.press('Enter');
  // Wait for the palette to close (the new UI may open right after).
  await win.locator('.quick-input-widget').waitFor({ state: 'hidden', timeout: 4_000 }).catch(() => {});
}

/**
 * Waits for one of the typical UI signals to be shown after a command
 * is invoked. Returns the type found, or null if none appears within the timeout.
 */
export type PostCommandSignal =
  | { kind: 'notification'; text: string }
  | { kind: 'quickPick'; title: string; items: string[] }
  | { kind: 'inputBox'; title: string; placeholder: string }
  | { kind: 'editor'; tab: string }
  | { kind: 'terminal' }
  | { kind: 'modal'; text: string };

export async function waitForAnySignal(win: Page, timeoutMs = 8_000): Promise<PostCommandSignal | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Notification toast — VS Code 1.118+ renders these with role="alert";
    // keep legacy CSS selector as fallback for older builds.
    const toast = win.locator(
      '[role="alert"], .notifications-toasts .notification-list-item-message, .notifications-toasts .notification-toast',
    ).filter({ hasText: /\S/ });
    if (await toast.first().isVisible().catch(() => false)) {
      const text = (await toast.first().innerText().catch(() => '')).trim();
      if (text) return { kind: 'notification', text };
    }
    // Modal dialog
    const dialog = win.locator('.monaco-dialog-box .dialog-message-text');
    if (await dialog.isVisible().catch(() => false)) {
      const text = (await dialog.innerText().catch(() => '')).trim();
      return { kind: 'modal', text };
    }
    // Quick input widget (QuickPick or InputBox) — distinguish
    const qiw = win.locator('.quick-input-widget');
    if (await qiw.isVisible().catch(() => false)) {
      const titleEl = qiw.locator('.quick-input-titlebar .quick-input-title');
      const title = (await titleEl.innerText().catch(() => '')).trim();
      const rows = qiw.locator('.monaco-list-row');
      const rowsCount = await rows.count().catch(() => 0);
      if (rowsCount > 0) {
        const items: string[] = [];
        for (let i = 0; i < Math.min(rowsCount, 10); i++) {
          const t = await rows.nth(i).locator('.label-name').first().textContent({ timeout: 500 }).catch(() => '');
          if (t) items.push(t.trim());
        }
        return { kind: 'quickPick', title, items };
      }
      const ph = await qiw.locator('input.input').getAttribute('placeholder').catch(() => '');
      return { kind: 'inputBox', title, placeholder: (ph ?? '').trim() };
    }
    // Terminal panel
    const term = win.locator('.terminal-wrapper, .integrated-terminal, .xterm');
    if (await term.first().isVisible().catch(() => false)) {
      return { kind: 'terminal' };
    }
    // Editor tab changed: detected by the caller via diff. Skipped here.
    await win.waitForTimeout(150);
  }
  return null;
}

/**
 * Variant of `waitForAnySignal` that ignores existing notification toasts
 * and waits for a NEW one to appear (different text). Useful for sequences
 * of consecutive commands that produce toasts with different messages.
 */
export async function waitForFreshNotification(
  win: Page,
  previousText: string | null,
  timeoutMs = 10_000,
): Promise<string | null> {
  const normPrev = (previousText ?? '').trim().replace(/\s+/g, ' ');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const toasts = win.locator(
      '[role="alert"], .notifications-toasts .notification-list-item-message',
    ).filter({ hasText: /\S/ });
    const n = await toasts.count();
    for (let i = n - 1; i >= 0; i--) {
      const tRaw = (await toasts.nth(i).innerText().catch(() => '')).trim();
      const t = tRaw.replace(/\s+/g, ' ');
      if (t && t !== normPrev) return tRaw.trim();
    }
    await win.waitForTimeout(150);
  }
  return null;
}

/** Returns the text of the last visible toast, or null. */
export async function lastNotificationText(win: Page): Promise<string | null> {
  const toasts = win.locator(
    '[role="alert"], .notifications-toasts .notification-list-item-message',
  ).filter({ hasText: /\S/ });
  const n = await toasts.count();
  if (n === 0) return null;
  return ((await toasts.nth(n - 1).innerText().catch(() => '')) || '').trim() || null;
}


export async function listEditorTabs(win: Page): Promise<string[]> {
  const tabs = win.locator('.tabs-container [role="tab"]');
  const n = await tabs.count();
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = await tabs.nth(i).getAttribute('aria-label').catch(() => null);
    if (t) out.push(t.trim());
  }
  return out;
}

/** Closes any UI overlay (palette, quick pick, input box, modal). */
export async function dismissOverlays(win: Page): Promise<void> {
  // Press Escape several times to close nested widgets.
  for (let i = 0; i < 3; i++) {
    if (!(await win.locator('.quick-input-widget, .monaco-dialog-box').first().isVisible().catch(() => false))) break;
    await win.keyboard.press('Escape');
    await win.waitForTimeout(100);
  }
  // Clear all notification toasts via the dedicated command (more
  // reliable than clicking the close icon, which can be intercepted).
  // Check for visible notifications via ARIA role (VS Code 1.118+) or legacy CSS selector.
  const hasToasts = await win.locator(
    '[role="alert"], .notifications-toasts .notification-list-item',
  ).filter({ hasText: /\S/ }).first().isVisible().catch(() => false);
  if (hasToasts) {
    await runPaletteCommand(win, 'Notifications: Clear All Notifications').catch(() => {});
    await win.waitForTimeout(300);
  }
}

/** Runs a command from the palette (strict filter, first match). Internal helper. */
async function runPaletteCommand(win: Page, title: string): Promise<void> {
  const isMac = process.platform === 'darwin';
  await win.keyboard.press(isMac ? 'Meta+Shift+P' : 'Control+Shift+P');
  const qiw = win.locator('.quick-input-widget');
  await qiw.waitFor({ state: 'visible', timeout: 5_000 });
  const input = qiw.locator('input.input');
  await input.waitFor({ state: 'visible', timeout: 5_000 });
  await input.fill(`>${title}`);
  await win.waitForTimeout(200);
  await win.keyboard.press('Enter');
}

