/**
 * Refactoring coverage tests for followups.ts — lazy i18n initialisation.
 *
 * Verifies:
 * - Labels change when switching locale (EN vs IT).
 * - All 8 command entries produce i18n-resolved labels.
 * - Missing commands (/schedule, /models, /mcp) are now covered.
 * - Default followups are localised.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FollowupProvider } from '../../src/participant/followups.js';
import { initI18n, _resetI18n } from '../../src/core/i18n.js';

function getFollowups(provider: FollowupProvider, command?: string) {
  const result = command ? { metadata: { command } } : {};
  return provider.provideFollowups(result as any, {} as any, {} as any);
}

// =========================================================================
// Multi-locale label test
// =========================================================================
describe('FollowupProvider — i18n localisation (refactoring)', () => {
  afterEach(() => {
    _resetI18n();
  });

  it('dovrebbe usare label italiane con locale IT', () => {
    initI18n('it');
    const provider = new FollowupProvider();
    const followups = getFollowups(provider, 'run');
    expect(followups.some(f => f.label?.includes('Controlla stato run'))).toBe(true);
    expect(followups.some(f => f.label?.includes('Lista modelli'))).toBe(true);
  });

  it('dovrebbe usare label inglesi con locale EN', () => {
    initI18n('en');
    const provider = new FollowupProvider();
    const followups = getFollowups(provider, 'run');
    expect(followups.some(f => f.label?.includes('Check run status'))).toBe(true);
    expect(followups.some(f => f.label?.includes('List models'))).toBe(true);
  });

  it('dovrebbe cambiare label di default in base al locale', () => {
    initI18n('en');
    const enProvider = new FollowupProvider();
    const enDefaults = getFollowups(enProvider, 'unknown_cmd');

    _resetI18n();
    initI18n('it');
    const itProvider = new FollowupProvider();
    const itDefaults = getFollowups(itProvider, 'unknown_cmd');

    // EN defaults dovrebbero contenere "Configuration"
    expect(enDefaults.some(f => f.label?.includes('Configuration'))).toBe(true);
    // IT defaults dovrebbero contenere "Configurazione"
    expect(itDefaults.some(f => f.label?.includes('Configurazione'))).toBe(true);
  });
});

// =========================================================================
// Missing command entries (/schedule, /models, /mcp)
// =========================================================================
describe('FollowupProvider — comandi mancanti nei test precedenti', () => {
  beforeEach(() => {
    initI18n('it');
  });

  afterEach(() => {
    _resetI18n();
  });

  it('dovrebbe fornire followup per /schedule → status + config', () => {
    const provider = new FollowupProvider();
    const followups = getFollowups(provider, 'schedule');
    expect(followups).toHaveLength(2);
    expect(followups.some(f => f.command === 'status')).toBe(true);
    expect(followups.some(f => f.command === 'config')).toBe(true);
  });

  it('dovrebbe fornire followup per /models → run + cloud', () => {
    const provider = new FollowupProvider();
    const followups = getFollowups(provider, 'models');
    expect(followups).toHaveLength(2);
    expect(followups.some(f => f.command === 'run')).toBe(true);
    expect(followups.some(f => f.command === 'cloud')).toBe(true);
  });

  it('dovrebbe fornire followup per /mcp → config + models', () => {
    const provider = new FollowupProvider();
    const followups = getFollowups(provider, 'mcp');
    expect(followups).toHaveLength(2);
    expect(followups.some(f => f.command === 'config')).toBe(true);
    expect(followups.some(f => f.command === 'models')).toBe(true);
  });
});

// =========================================================================
// Label content verification (emoji + i18n text)
// =========================================================================
describe('FollowupProvider — label emoji e testo i18n', () => {
  beforeEach(() => {
    initI18n('it');
  });

  afterEach(() => {
    _resetI18n();
  });

  it('tutte le label di /status dovrebbero contenere emoji', () => {
    const provider = new FollowupProvider();
    const followups = getFollowups(provider, 'status');
    for (const f of followups) {
      // Ogni label dovrebbe iniziare con un emoji (primo char > U+2000)
      expect(f.label!.codePointAt(0)! > 0x2000).toBe(true);
    }
  });

  it('nessuna label dovrebbe essere raw key (es. "oz.followup_...")', () => {
    const provider = new FollowupProvider();
    for (const cmd of ['run', 'cloud', 'status', 'config', 'init', 'schedule', 'models', 'mcp']) {
      const followups = getFollowups(provider, cmd);
      for (const f of followups) {
        expect(f.label).not.toMatch(/^oz\./);
      }
    }
  });
});
