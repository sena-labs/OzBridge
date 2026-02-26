// ============================================================================
// i18n — Service Implementation
// ============================================================================
// IMPL: Phase 1 — I18nService for copilot-chat-toolkit (§3.2 Architecture)

import type { II18nService, LocaleBundle } from './types.js';

/**
 * Default internationalisation service.
 *
 * Maintains a map of `namespace → LocaleBundle` and resolves messages via
 * the fallback chain: **current locale → `'en'` → raw key**.
 *
 * Placeholder syntax: `{0}`, `{1}`, … replaced by positional arguments.
 *
 * @example
 * ```ts
 * const i18n = new I18nService('it');
 * i18n.registerCatalog('core', {
 *   en: { welcome: 'Hello {0}!' },
 *   it: { welcome: 'Ciao {0}!' },
 * });
 * i18n.t('core.welcome', 'Mario'); // → 'Ciao Mario!'
 * ```
 */
export class I18nService implements II18nService {
  private readonly catalogs = new Map<string, LocaleBundle>();

  /** Normalised locale code (lowercase, no region). */
  readonly locale: string;

  /**
   * @param locale - Raw locale string (e.g. `'it-IT'`, `'en'`).
   *                 Defaults to `'en'` when omitted or empty.
   */
  constructor(locale?: string) {
    // IMPL: normalise — strip region, lowercase (e.g. 'pt-BR' → 'pt')
    this.locale = (locale ?? 'en').split('-')[0].toLowerCase();
  }

  /** @inheritdoc */
  registerCatalog(namespace: string, bundle: LocaleBundle): void {
    this.catalogs.set(namespace, bundle);
  }

  /** @inheritdoc */
  t(key: string, ...args: Array<string | number>): string {
    // IMPL: split 'namespace.message.key' → namespace + rest joined by '.'
    const dotIndex = key.indexOf('.');
    if (dotIndex < 0) {
      return key; // no namespace separator → return raw key
    }

    const ns = key.slice(0, dotIndex);
    const msgKey = key.slice(dotIndex + 1);

    const bundle = this.catalogs.get(ns);
    if (!bundle) {
      return key; // unknown namespace → raw key fallback
    }

    // IMPL: fallback chain — locale → 'en' → raw key
    const msg =
      bundle[this.locale]?.[msgKey] ??
      bundle['en']?.[msgKey] ??
      key;

    // IMPL: replace positional placeholders {0}, {1}, …
    return msg.replace(/\{(\d+)\}/g, (match, idx) => {
      const index = Number(idx);
      return index < args.length ? String(args[index]) : match;
    });
  }
}
