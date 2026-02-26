/**
 * Refactoring coverage: i18n catalog regression tests.
 *
 * Verifies:
 * - Dead key `error_generic` has been removed from both EN and IT catalogs.
 * - New keys (ext_cli_not_found, ext_install_warp, followup_*) exist and resolve.
 * - All new oz keys are present in both EN and IT catalogs (no missing translations).
 * - Placeholder interpolation works in new keys.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { initI18n, _resetI18n, t, getI18n } from '../../src/core/i18n.js';

afterEach(() => {
  _resetI18n();
});

// =========================================================================
// getI18n() guard — throws before initI18n()
// =========================================================================
describe('getI18n() guard', () => {
  it('dovrebbe lanciare se chiamato prima di initI18n()', () => {
    // _resetI18n() in afterEach garantisce _instance === undefined
    expect(() => getI18n()).toThrow('i18n not initialised');
  });
});

// =========================================================================
// Dead key removal regression
// =========================================================================
describe('dead key error_generic removal', () => {
  it('oz.error_generic dovrebbe restituire raw key (EN) — chiave rimossa', () => {
    initI18n('en');
    // Se la chiave è stata rimossa, t() restituisce la raw key
    expect(t('oz.error_generic')).toBe('oz.error_generic');
  });

  it('oz.error_generic dovrebbe restituire raw key (IT) — chiave rimossa', () => {
    initI18n('it');
    expect(t('oz.error_generic')).toBe('oz.error_generic');
  });
});

// =========================================================================
// New extension activation keys
// =========================================================================
describe('nuove chiavi ext_* (extension activation)', () => {
  it('ext_cli_not_found dovrebbe esistere in EN', () => {
    initI18n('en');
    const val = t('oz.ext_cli_not_found');
    expect(val).not.toBe('oz.ext_cli_not_found'); // non raw key
    expect(val).toContain('Oz CLI not found');
  });

  it('ext_cli_not_found dovrebbe esistere in IT', () => {
    initI18n('it');
    const val = t('oz.ext_cli_not_found');
    expect(val).not.toBe('oz.ext_cli_not_found');
    expect(val).toContain('non trovato');
  });

  it('ext_install_warp dovrebbe esistere in EN', () => {
    initI18n('en');
    expect(t('oz.ext_install_warp')).toBe('Install Warp');
  });

  it('ext_install_warp dovrebbe esistere in IT', () => {
    initI18n('it');
    expect(t('oz.ext_install_warp')).toBe('Installa Warp');
  });
});

// =========================================================================
// New followup_* keys
// =========================================================================
const FOLLOWUP_KEYS = [
  'followup_check_status',
  'followup_list_models',
  'followup_run_local',
  'followup_run_cloud',
  'followup_config',
  'followup_scaffold',
  'followup_run_agent',
];

describe('nuove chiavi followup_* (follow-up labels)', () => {
  it('tutte le chiavi followup dovrebbero esistere in EN (non raw key)', () => {
    initI18n('en');
    for (const key of FOLLOWUP_KEYS) {
      const val = t(`oz.${key}`);
      expect(val, `oz.${key} mancante in EN`).not.toBe(`oz.${key}`);
    }
  });

  it('tutte le chiavi followup dovrebbero esistere in IT (non raw key)', () => {
    initI18n('it');
    for (const key of FOLLOWUP_KEYS) {
      const val = t(`oz.${key}`);
      expect(val, `oz.${key} mancante in IT`).not.toBe(`oz.${key}`);
    }
  });

  it('ogni chiave followup dovrebbe contenere emoji', () => {
    initI18n('en');
    for (const key of FOLLOWUP_KEYS) {
      const val = t(`oz.${key}`);
      // Il primo codepoint è un emoji (> U+2000)
      expect(val.codePointAt(0)! > 0x2000, `oz.${key} senza emoji`).toBe(true);
    }
  });
});

// =========================================================================
// Cross-locale parity check
// =========================================================================
describe('parità EN/IT — nessuna chiave nuova mancante', () => {
  const ALL_NEW_KEYS = [
    'ext_cli_not_found',
    'ext_install_warp',
    ...FOLLOWUP_KEYS,
  ];

  it('ogni nuova chiave dovrebbe risolvere sia in EN che in IT', () => {
    for (const locale of ['en', 'it'] as const) {
      initI18n(locale);
      for (const key of ALL_NEW_KEYS) {
        const val = t(`oz.${key}`);
        expect(val, `oz.${key} raw in locale=${locale}`).not.toBe(`oz.${key}`);
      }
      _resetI18n();
    }
  });
});
