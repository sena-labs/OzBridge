import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const NLS = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.nls.json'), 'utf8')) as Record<string, string>;
const LOCALES = ['it', 'es'] as const;

function collectKeys(value: unknown, acc: Set<string>): void {
  if (typeof value === 'string') {
    const m = /^%([^%]+)%$/.exec(value);
    if (m) { acc.add(m[1]); }
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectKeys(v, acc));
  } else if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((v) => collectKeys(v, acc));
  }
}

describe('package.nls manifest consistency', () => {
  const referenced = new Set<string>();
  collectKeys(PKG, referenced);
  const refKeys = [...referenced].sort();

  it('package.json references at least the localized commands and metadata', () => {
    expect(refKeys.length).toBeGreaterThan(0);
    expect(referenced.has('displayName')).toBe(true);
    expect(referenced.has('description')).toBe(true);
  });

  it('every %key% in package.json exists in package.nls.json', () => {
    for (const key of refKeys) {
      expect(NLS, `key ${key} missing from package.nls.json`).toHaveProperty(key);
    }
  });

  it('package.json declares the l10n bundle directory', () => {
    expect(PKG.l10n).toBe('./l10n');
  });

  for (const locale of LOCALES) {
    describe(`locale '${locale}'`, () => {
      const nls = JSON.parse(
        fs.readFileSync(path.join(ROOT, `package.nls.${locale}.json`), 'utf8'),
      ) as Record<string, string>;

      it('contains exactly the same keys as package.nls.json', () => {
        expect(Object.keys(nls).sort()).toEqual(Object.keys(NLS).sort());
      });

      it('all values are non-empty strings', () => {
        for (const key of Object.keys(NLS)) {
          expect(typeof nls[key]).toBe('string');
          expect(nls[key].length).toBeGreaterThan(0);
        }
      });
    });
  }
});
