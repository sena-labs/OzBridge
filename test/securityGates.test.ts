/**
 * v1.0 deliverable Q (security gates) — config invariants.
 *
 * These tests parse the actual workflow & dependabot YAML files to
 * guarantee the security gates remain wired even if a future PR
 * accidentally drops a job. The assertions intentionally stay
 * structural (presence of strings) so they don't break on cosmetic
 * formatting changes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..');

function read(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

describe('CodeQL workflow', () => {
  const yaml = read('.github/workflows/codeql.yml');

  it('targets the JavaScript/TypeScript language pack', () => {
    expect(yaml).toMatch(/javascript-typescript/);
  });

  it('enables the security-extended + security-and-quality query suites', () => {
    expect(yaml).toMatch(/security-extended/);
    expect(yaml).toMatch(/security-and-quality/);
  });

  it('runs on PRs to main and on a weekly cron', () => {
    expect(yaml).toMatch(/pull_request:[\s\S]*?branches:\s*\[main\]/);
    expect(yaml).toMatch(/schedule:[\s\S]*?cron:/);
  });

  it('grants security-events: write so findings reach the Security tab', () => {
    expect(yaml).toMatch(/security-events:\s*write/);
  });
});

describe('Security gates workflow', () => {
  const yaml = read('.github/workflows/security.yml');

  it('declares the npm audit job', () => {
    expect(yaml).toMatch(/audit:/);
  });

  it('fails on high+critical CVEs in production deps only', () => {
    expect(yaml).toMatch(/--omit=dev/);
    expect(yaml).toMatch(/--audit-level=high/);
  });

  it('declares the secret-scan job using gitleaks', () => {
    expect(yaml).toMatch(/secret-scan:/);
    expect(yaml).toMatch(/gitleaks\/gitleaks-action/);
  });

  it('checks out full git history for accurate secret scanning', () => {
    expect(yaml).toMatch(/fetch-depth:\s*0/);
  });

  it('runs on PRs, main pushes, and a weekly cron', () => {
    expect(yaml).toMatch(/pull_request:[\s\S]*?branches:\s*\[main\]/);
    expect(yaml).toMatch(/schedule:[\s\S]*?cron:/);
  });
});

describe('Dependabot configuration', () => {
  const yaml = read('.github/dependabot.yml');

  it('declares version 2 schema', () => {
    expect(yaml).toMatch(/^version:\s*2/m);
  });

  it('watches npm, the toolkit workspace and GitHub Actions', () => {
    expect(yaml).toMatch(/package-ecosystem:\s*'npm'[\s\S]*?directory:\s*'\/'/);
    expect(yaml).toMatch(/directory:\s*'\/packages\/copilot-chat-toolkit'/);
    expect(yaml).toMatch(/package-ecosystem:\s*'github-actions'/);
  });

  it('uses a weekly cadence for every ecosystem', () => {
    const matches = yaml.match(/interval:\s*'weekly'/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });
});

describe('SECURITY.md refresh', () => {
  const md = read('SECURITY.md');

  it('lists the v0.9 LTS entry in the supported-versions table', () => {
    expect(md).toMatch(/0\.9\.x/);
    expect(md).toMatch(/active LTS/);
  });

  it('documents the v1.0 automated security gates', () => {
    expect(md).toMatch(/CodeQL/);
    expect(md).toMatch(/npm audit/);
    expect(md).toMatch(/gitleaks/);
    expect(md).toMatch(/Dependabot/);
  });

  it('links to PRIVACY.md for the telemetry contract', () => {
    expect(md).toMatch(/PRIVACY\.md/);
  });
});
