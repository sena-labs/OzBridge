import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const CONTRIB = fs.readFileSync(path.join(ROOT, 'CONTRIBUTING.md'), 'utf8');

describe('CONTRIBUTING.md (deliverable O)', () => {
  it('documents the deliverable-PR playbook section', () => {
    expect(CONTRIB).toMatch(/##\s+Deliverable-PR playbook/);
  });

  it('references the 2 × 3 CI matrix Node versions', () => {
    expect(CONTRIB).toMatch(/20\.19/);
    expect(CONTRIB).toMatch(/22\.12/);
  });

  it('references the 125 KB bundle budget', () => {
    expect(CONTRIB).toMatch(/125\s*KB/);
  });

  it('documents the non-watch test invocation used in CI', () => {
    expect(CONTRIB).toMatch(/npm test -- --run/);
  });

  it('shows the squash-merge auto flow via gh CLI', () => {
    expect(CONTRIB).toMatch(/gh pr merge[^\n]*--squash[^\n]*--delete-branch[^\n]*--auto/);
  });

  it('documents the l10n bundle layout', () => {
    expect(CONTRIB).toMatch(/package\.nls\.json/);
    expect(CONTRIB).toMatch(/l10n\/bundle\.l10n\.json/);
    expect(CONTRIB).toMatch(/vscode\.l10n\.t/);
  });

  it('includes the three-section PR body template (What / Verification / Next)', () => {
    expect(CONTRIB).toMatch(/##\s+What/);
    expect(CONTRIB).toMatch(/##\s+Verification/);
    expect(CONTRIB).toMatch(/##\s+Next/);
  });

  it('mentions the Conventional Commits requirement', () => {
    expect(CONTRIB).toMatch(/Conventional Commits/);
  });
});
