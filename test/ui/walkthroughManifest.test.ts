import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const NLS = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.nls.json'), 'utf8')) as Record<string, string>;

interface WalkthroughStep {
  id: string;
  title: string;
  description: string;
  media: { markdown?: string; image?: string };
  completionEvents?: string[];
}

interface Walkthrough {
  id: string;
  title: string;
  description: string;
  steps: WalkthroughStep[];
}

describe('Getting Started walkthrough manifest', () => {
  const walkthroughs = (PKG.contributes?.walkthroughs ?? []) as Walkthrough[];
  const wt = walkthroughs.find((w) => w.id === 'ozBridge.gettingStarted');

  it('contributes a single "ozBridge.gettingStarted" walkthrough', () => {
    expect(walkthroughs).toHaveLength(1);
    expect(wt).toBeDefined();
  });

  it('declares exactly four steps', () => {
    expect(wt!.steps).toHaveLength(4);
    const ids = wt!.steps.map((s) => s.id);
    expect(ids).toEqual([
      'ozBridge.gettingStarted.installCli',
      'ozBridge.gettingStarted.firstAgent',
      'ozBridge.gettingStarted.exploreViews',
      'ozBridge.gettingStarted.enableMcp',
    ]);
  });

  it('every step has non-empty completion events', () => {
    for (const step of wt!.steps) {
      expect(step.completionEvents).toBeDefined();
      expect(step.completionEvents!.length).toBeGreaterThan(0);
    }
  });

  it('every step points at an existing markdown asset under media/walkthrough/', () => {
    for (const step of wt!.steps) {
      const md = step.media.markdown;
      expect(md, `step ${step.id} must declare a markdown asset`).toBeDefined();
      const abs = path.join(ROOT, md!);
      expect(fs.existsSync(abs), `missing ${md}`).toBe(true);
      const body = fs.readFileSync(abs, 'utf8');
      // Sanitisation — reject raw <script> or javascript: URIs in shipped copy.
      expect(/\<script/i.test(body)).toBe(false);
      expect(/javascript:/i.test(body)).toBe(false);
    }
  });

  it('every localisable walkthrough %key% is defined in package.nls.json', () => {
    const keys = new Set<string>();
    const collect = (v: unknown): void => {
      if (typeof v === 'string') {
        const m = /^%([^%]+)%$/.exec(v);
        if (m) { keys.add(m[1]); }
      } else if (Array.isArray(v)) {
        v.forEach(collect);
      } else if (v && typeof v === 'object') {
        Object.values(v as Record<string, unknown>).forEach(collect);
      }
    };
    collect(wt);
    for (const key of keys) {
      expect(NLS, `walkthrough key ${key} missing from package.nls.json`).toHaveProperty(key);
    }
    // And we do reference at least the title/description + 4 steps * 2 keys.
    expect(keys.size).toBeGreaterThanOrEqual(2 + 4 * 2);
  });
});
