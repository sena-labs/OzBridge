import { Page, expect } from '@playwright/test';

/**
 * Apre la Command Palette, filtra con `query`, restituisce i label visibili.
 * Lascia la palette aperta — chiamare `closePalette` o premere Escape.
 */
export async function listPaletteItems(win: Page, query: string): Promise<string[]> {
  const isMac = process.platform === 'darwin';
  await win.keyboard.press(isMac ? 'Meta+Shift+P' : 'Control+Shift+P');
  const input = win.locator('.quick-input-widget input.input');
  await input.waitFor({ state: 'visible', timeout: 15_000 });
  await input.fill(`>${query.replace(/…/g, '').trim()}`);
  await win.waitForTimeout(400);
  const rows = win.locator('.quick-input-widget .monaco-list-row');
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  const count = await rows.count();
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    // L'intero contenuto della riga (label + categoria + descrizione).
    const text = await rows.nth(i).innerText({ timeout: 1_000 }).catch(() => '');
    if (text) labels.push(text.replace(/\s+/g, ' ').trim());
  }
  return labels;
}

export async function closePalette(win: Page): Promise<void> {
  await win.keyboard.press('Escape');
  // attendi chiusura
  await win.locator('.quick-input-widget').waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
}

/**
 * Esegue un comando dalla Command Palette. Diversamente da `runCommand`
 * generale, qui scegliamo l'item *esatto* per evitare ambiguità quando
 * il prefisso matcha più voci.
 */
export async function runExactCommand(win: Page, exactTitle: string): Promise<void> {
  const isMac = process.platform === 'darwin';
  await win.keyboard.press(isMac ? 'Meta+Shift+P' : 'Control+Shift+P');
  const input = win.locator('.quick-input-widget input.input');
  await input.waitFor({ state: 'visible', timeout: 15_000 });
  // Il filtro fuzzy può non gestire bene il glifo ellissi U+2026;
  // togliamolo dal pattern di ricerca.
  const query = exactTitle.replace(/…/g, '').trim();
  await input.fill(`>${query}`);
  await win.waitForTimeout(350);
  // Conferma il primo risultato.
  await win.keyboard.press('Enter');
  // Attendi che la palette chiuda (la nuova UI può aprirsi subito dopo).
  await win.locator('.quick-input-widget').waitFor({ state: 'hidden', timeout: 4_000 }).catch(() => {});
}

/**
 * Aspetta che venga mostrato uno dei segnali UI tipici dopo l'invocazione
 * di un comando. Restituisce il tipo trovato o null se nessuno entro timeout.
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
    // Notification toast
    const toast = win.locator('.notifications-toasts .notification-list-item-message, .notifications-toasts .notification-toast');
    if (await toast.first().isVisible().catch(() => false)) {
      const text = (await toast.first().innerText().catch(() => '')).trim();
      return { kind: 'notification', text };
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
    // Editor tab cambiata: rilevata dal chiamante via diff. Skip qui.
    await win.waitForTimeout(150);
  }
  return null;
}

/**
 * Variante di `waitForAnySignal` che ignora le notification toast esistenti
 * e attende che ne compaia una NUOVA (testo diverso). Utile per sequenze
 * di comandi successivi che producono toast con messaggi diversi.
 */
export async function waitForFreshNotification(
  win: Page,
  previousText: string | null,
  timeoutMs = 10_000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const toasts = win.locator('.notifications-toasts .notification-list-item-message');
    const n = await toasts.count();
    for (let i = n - 1; i >= 0; i--) {
      const t = (await toasts.nth(i).innerText().catch(() => '')).trim();
      if (t && t !== (previousText ?? '')) return t;
    }
    await win.waitForTimeout(150);
  }
  return null;
}

/** Restituisce il testo dell'ultimo toast visibile, oppure null. */
export async function lastNotificationText(win: Page): Promise<string | null> {
  const toasts = win.locator('.notifications-toasts .notification-list-item-message');
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

/** Chiude qualsiasi UI overlay (palette, quick pick, input box, modale). */
export async function dismissOverlays(win: Page): Promise<void> {
  // Premi Escape multiple volte per chiudere widget annidati.
  for (let i = 0; i < 3; i++) {
    if (!(await win.locator('.quick-input-widget, .monaco-dialog-box').first().isVisible().catch(() => false))) break;
    await win.keyboard.press('Escape');
    await win.waitForTimeout(100);
  }
  // Pulisci tutte le notification toasts via comando dedicato (più
  // affidabile del click sull'icona di close che può essere intercettato).
  const hasToasts = await win.locator('.notifications-toasts .notification-list-item').first().isVisible().catch(() => false);
  if (hasToasts) {
    await runPaletteCommand(win, 'Notifications: Clear All Notifications').catch(() => {});
    await win.waitForTimeout(300);
  }
}

/** Esegue un comando da palette (filtro stretto, primo match). Helper interno. */
async function runPaletteCommand(win: Page, title: string): Promise<void> {
  const isMac = process.platform === 'darwin';
  await win.keyboard.press(isMac ? 'Meta+Shift+P' : 'Control+Shift+P');
  const input = win.locator('.quick-input-widget input.input');
  await input.waitFor({ state: 'visible', timeout: 5_000 });
  await input.fill(`>${title}`);
  await win.waitForTimeout(200);
  await win.keyboard.press('Enter');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
