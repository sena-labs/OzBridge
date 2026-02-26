// IMPL: Phase 1 — I18nService unit tests (§3.2 Architecture)
import { describe, it, expect, beforeEach } from 'vitest';
import { I18nService } from 'copilot-chat-toolkit';
import type { LocaleBundle } from 'copilot-chat-toolkit';

// ---------------------------------------------------------------------------
// Sample catalog for tests
// ---------------------------------------------------------------------------
const SAMPLE_BUNDLE: LocaleBundle = {
  en: {
    welcome: 'Hello {0}!',
    goodbye: 'Goodbye {0}, see you {1}.',
    simple: 'A simple message.',
  },
  it: {
    welcome: 'Ciao {0}!',
    goodbye: 'Arrivederci {0}, ci vediamo {1}.',
    simple: 'Un messaggio semplice.',
  },
  fr: {
    welcome: 'Bonjour {0} !',
  },
};

describe('I18nService', () => {
  let i18n: I18nService;

  // -------------------------------------------------------------------------
  // Constructor & locale normalisation
  // -------------------------------------------------------------------------
  describe('constructor', () => {
    it('defaults to "en" when no locale is provided', () => {
      i18n = new I18nService();
      expect(i18n.locale).toBe('en');
    });

    it('defaults to "en" when undefined is provided', () => {
      i18n = new I18nService(undefined);
      expect(i18n.locale).toBe('en');
    });

    it('normalises locale by stripping region and lowercasing', () => {
      i18n = new I18nService('it-IT');
      expect(i18n.locale).toBe('it');
    });

    it('lowercases the locale', () => {
      i18n = new I18nService('EN');
      expect(i18n.locale).toBe('en');
    });

    it('handles locale with only language code', () => {
      i18n = new I18nService('ja');
      expect(i18n.locale).toBe('ja');
    });
  });

  // -------------------------------------------------------------------------
  // Catalog registration & basic lookup
  // -------------------------------------------------------------------------
  describe('registerCatalog + t()', () => {
    beforeEach(() => {
      i18n = new I18nService('it');
      i18n.registerCatalog('test', SAMPLE_BUNDLE);
    });

    it('returns the translated message for the current locale', () => {
      expect(i18n.t('test.simple')).toBe('Un messaggio semplice.');
    });

    it('returns the en message when key is missing in current locale', () => {
      // 'fr' has only 'welcome', not 'goodbye'
      const frI18n = new I18nService('fr');
      frI18n.registerCatalog('test', SAMPLE_BUNDLE);
      expect(frI18n.t('test.goodbye', 'Alice', 'domani')).toBe(
        'Goodbye Alice, see you domani.',
      );
    });

    it('falls back to en when locale has no catalog at all', () => {
      const deI18n = new I18nService('de');
      deI18n.registerCatalog('test', SAMPLE_BUNDLE);
      expect(deI18n.t('test.simple')).toBe('A simple message.');
    });

    it('returns the raw key when neither locale nor en has the key', () => {
      expect(i18n.t('test.nonexistent')).toBe('test.nonexistent');
    });
  });

  // -------------------------------------------------------------------------
  // Namespace handling
  // -------------------------------------------------------------------------
  describe('namespace resolution', () => {
    beforeEach(() => {
      i18n = new I18nService('en');
      i18n.registerCatalog('ns1', { en: { hello: 'Hello' } });
      i18n.registerCatalog('ns2', { en: { hello: 'World' } });
    });

    it('resolves from the correct namespace', () => {
      expect(i18n.t('ns1.hello')).toBe('Hello');
      expect(i18n.t('ns2.hello')).toBe('World');
    });

    it('returns raw key for unknown namespace', () => {
      expect(i18n.t('unknown.hello')).toBe('unknown.hello');
    });

    it('returns raw key when key has no dot separator', () => {
      expect(i18n.t('nodot')).toBe('nodot');
    });

    it('handles keys with multiple dots correctly', () => {
      const bundle: LocaleBundle = { en: { 'sub.key': 'value' } };
      i18n.registerCatalog('deep', bundle);
      expect(i18n.t('deep.sub.key')).toBe('value');
    });
  });

  // -------------------------------------------------------------------------
  // Placeholder replacement
  // -------------------------------------------------------------------------
  describe('placeholder interpolation', () => {
    beforeEach(() => {
      i18n = new I18nService('en');
      i18n.registerCatalog('test', SAMPLE_BUNDLE);
    });

    it('replaces a single placeholder', () => {
      expect(i18n.t('test.welcome', 'Alice')).toBe('Hello Alice!');
    });

    it('replaces multiple placeholders', () => {
      expect(i18n.t('test.goodbye', 'Bob', 'tomorrow')).toBe(
        'Goodbye Bob, see you tomorrow.',
      );
    });

    it('accepts numeric arguments', () => {
      expect(i18n.t('test.welcome', 42)).toBe('Hello 42!');
    });

    it('leaves placeholder intact when argument is missing', () => {
      expect(i18n.t('test.goodbye', 'Alice')).toBe(
        'Goodbye Alice, see you {1}.',
      );
    });

    it('handles message with no placeholders and extra args gracefully', () => {
      expect(i18n.t('test.simple', 'extra', 'args')).toBe(
        'A simple message.',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Overwrite behaviour
  // -------------------------------------------------------------------------
  describe('catalog overwrite', () => {
    it('overwrites a previously registered catalog', () => {
      i18n = new I18nService('en');
      i18n.registerCatalog('x', { en: { k: 'old' } });
      expect(i18n.t('x.k')).toBe('old');

      i18n.registerCatalog('x', { en: { k: 'new' } });
      expect(i18n.t('x.k')).toBe('new');
    });
  });
});
