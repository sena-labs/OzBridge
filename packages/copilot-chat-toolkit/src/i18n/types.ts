// ============================================================================
// i18n — Type Definitions
// ============================================================================
// IMPL: Phase 1 — i18n types for copilot-chat-toolkit (§3.2 Architecture)

/**
 * A flat dictionary of message keys to translated strings.
 * Placeholders use `{0}`, `{1}`, … syntax.
 *
 * @example
 * ```ts
 * const catalog: MessageCatalog = {
 *   'welcome': 'Hello {0}!',
 *   'goodbye': 'Goodbye {0}, see you {1}.',
 * };
 * ```
 */
export type MessageCatalog = Record<string, string>;

/**
 * A mapping of locale codes (e.g. `'en'`, `'it'`, `'ja'`) to their respective
 * {@link MessageCatalog}. Each plugin registers one `LocaleBundle` per namespace.
 *
 * @example
 * ```ts
 * const bundle: LocaleBundle = {
 *   en: { welcome: 'Hello {0}!' },
 *   it: { welcome: 'Ciao {0}!' },
 * };
 * ```
 */
export type LocaleBundle = Record<string, MessageCatalog>;

/**
 * Internationalisation service interface.
 *
 * Provides catalog registration and message lookup with fallback chain:
 * **current locale → `'en'` → raw key**.
 *
 * Keys follow the convention `namespace.messageKey`
 * (e.g. `'core.welcome'`, `'oz.cli_not_found'`).
 */
export interface II18nService {
  /** The resolved locale code (lowercase, no region — e.g. `'it'`, `'en'`). */
  readonly locale: string;

  /**
   * Registers a {@link LocaleBundle} under the given namespace.
   * Subsequent calls with the same namespace **overwrite** the previous bundle.
   *
   * @param namespace - Unique namespace (e.g. `'core'`, `'oz'`, `'shell'`).
   * @param bundle - Locale → MessageCatalog mapping.
   */
  registerCatalog(namespace: string, bundle: LocaleBundle): void;

  /**
   * Looks up a translated message.
   *
   * Fallback chain: current locale → `'en'` → raw key.
   * Positional placeholders `{0}`, `{1}`, … are replaced by `args`.
   *
   * @param key  - Dot-separated key: `'namespace.messageKey'`.
   * @param args - Positional replacement values.
   * @returns The translated, interpolated string.
   */
  t(key: string, ...args: Array<string | number>): string;
}
