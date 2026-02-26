// ============================================================================
// Core — i18n Singleton Facade
// ============================================================================
// IMPL: Phase 2 — Singleton I18nService with core catalog (§3.2 Architecture)

import { I18nService } from 'copilot-chat-toolkit';
import type { II18nService, LocaleBundle } from 'copilot-chat-toolkit';

// IMPL: Phase 2b — import core locale catalogs
import { en, oz_en } from './locales/en.js';
import { it, oz_it } from './locales/it.js';
import { es } from './locales/es.js';
import { fr } from './locales/fr.js';
import { de } from './locales/de.js';
import { pt } from './locales/pt.js';
import { ja } from './locales/ja.js';
import { zh } from './locales/zh.js';
import { ko } from './locales/ko.js';
import { ru } from './locales/ru.js';

/** Core i18n message bundle (10 locales). */
export const CORE_MESSAGES: LocaleBundle = { en, it, es, fr, de, pt, ja, zh, ko, ru };

/** Oz-specific i18n message bundle (en + it; other locales fall back to en). */
export const OZ_MESSAGES: LocaleBundle = { en: oz_en, it: oz_it };

/** Module-level singleton, initialised by {@link initI18n}. */
let _instance: II18nService | undefined;

/**
 * Initialises the core i18n singleton.
 *
 * Must be called **once** during `activate()` before any `t()` invocations.
 * Registers the core message catalog automatically.
 *
 * @param locale - Raw locale string (e.g. `vscode.env.language`). Defaults to `'en'`.
 * @returns The initialised {@link II18nService} instance.
 */
export function initI18n(locale?: string): II18nService {
  const svc = new I18nService(locale);
  svc.registerCatalog('core', CORE_MESSAGES);
  svc.registerCatalog('oz', OZ_MESSAGES);
  _instance = svc;
  return svc;
}

/**
 * Returns the singleton i18n service.
 *
 * @throws If called before {@link initI18n}.
 */
export function getI18n(): II18nService {
  if (!_instance) {
    throw new Error('i18n not initialised. Call initI18n() first.');
  }
  return _instance;
}

/**
 * Convenience translation helper.
 *
 * Shorthand for `getI18n().t(key, ...args)`.
 *
 * @param key  - Dot-separated key (e.g. `'core.welcome'`).
 * @param args - Positional replacement values.
 */
export function t(key: string, ...args: Array<string | number>): string {
  return getI18n().t(key, ...args);
}

// IMPL: Phase 2 — exported for testing (reset singleton between tests)
/** @internal Resets the singleton — for testing only. */
export function _resetI18n(): void {
  _instance = undefined;
}
