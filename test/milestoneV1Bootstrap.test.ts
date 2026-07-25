import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const MILESTONE = fs.readFileSync(path.join(ROOT, 'docs', 'MILESTONE-v1.0.md'), 'utf8');

describe('v1.0 milestone bootstrap', () => {
  it('lists all five v1.0 deliverables (P, Q, R, S, T)', () => {
    for (const id of ['P', 'Q', 'R', 'S', 'T']) {
      expect(MILESTONE).toMatch(new RegExp(`\\|\\s*${id}\\s*\\|`));
    }
  });

  it('declares 1.0.0 as the target version', () => {
    expect(MILESTONE).toMatch(/Target version:\*\*\s*`1\.0\.0`/);
  });

  it('depends on v0.9.0', () => {
    expect(MILESTONE).toMatch(/v0\.9\.0/);
  });

  it('records the bundle budget', () => {
    expect(MILESTONE).toMatch(/1[45][05]\s*KB/);
  });

  it('documents the telemetry deny list invariant', () => {
    expect(MILESTONE).toMatch(/prompt\|content\|output\|path\|workspace\|runId/);
  });

  it('documents the four performance budgets', () => {
    expect(MILESTONE).toMatch(/Activation/);
    expect(MILESTONE).toMatch(/200\s*ms/);
    expect(MILESTONE).toMatch(/300\s*ms/);
    expect(MILESTONE).toMatch(/50\s*MB/);
  });
});
