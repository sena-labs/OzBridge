import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const L10N_DIR = path.resolve(__dirname, '..', '..', 'l10n');
const SOURCE = 'bundle.l10n.json';
const LOCALES = ['it', 'es', 'de', 'fr', 'zh-cn'] as const;

function load(name: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(L10N_DIR, name), 'utf8'));
}

function placeholders(s: string): string[] {
  return Array.from(s.matchAll(/\{(\d+)\}/g)).map((m) => m[1]).sort();
}

describe('l10n bundle consistency', () => {
  const source = load(SOURCE);
  const sourceKeys = Object.keys(source);

  it('source bundle is non-empty', () => {
    expect(sourceKeys.length).toBeGreaterThan(0);
  });

  it('source bundle uses identity mapping', () => {
    for (const key of sourceKeys) {
      expect(source[key]).toBe(key);
    }
  });

  for (const locale of LOCALES) {
    describe(`locale '${locale}'`, () => {
      const bundle = load(`bundle.l10n.${locale}.json`);
      const localeKeys = Object.keys(bundle);

      it('contains exactly the same keys as the source bundle', () => {
        expect(localeKeys.sort()).toEqual([...sourceKeys].sort());
      });

      it('preserves placeholder counts and indices for every translation', () => {
        for (const key of sourceKeys) {
          expect(placeholders(bundle[key])).toEqual(placeholders(key));
        }
      });

      it('translations are non-empty strings', () => {
        for (const key of sourceKeys) {
          expect(typeof bundle[key]).toBe('string');
          expect(bundle[key].length).toBeGreaterThan(0);
        }
      });
    });
  }
});
