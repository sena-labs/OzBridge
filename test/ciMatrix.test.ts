import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const CI = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const BUDGET = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'bundle-budget.yml'),
  'utf8',
);

describe('CI matrix (deliverable N)', () => {
  it('declares both Node 20.19 and 22.12', () => {
    expect(CI).toMatch(/node-version:\s*\[\s*['"]20\.19['"]\s*,\s*['"]22\.12['"]\s*\]/);
  });

  it('runs on ubuntu + windows + macos', () => {
    expect(CI).toMatch(/os:\s*\[\s*ubuntu-latest\s*,\s*windows-latest\s*,\s*macos-latest\s*\]/);
  });

  it('disables fail-fast so one OS failure does not cancel the whole matrix', () => {
    expect(CI).toMatch(/fail-fast:\s*false/);
  });

  it('declares cancel-in-progress concurrency', () => {
    expect(CI).toMatch(/concurrency:[\s\S]*?cancel-in-progress:\s*true/);
  });

  it('runs the non-watch test invocation on every matrix leg', () => {
    expect(CI).toMatch(/npm test -- --run/);
  });
});

describe('Bundle-budget workflow (deliverable N)', () => {
  it('triggers on push to main and pull requests', () => {
    expect(BUDGET).toMatch(/on:[\s\S]*?push:[\s\S]*?branches:\s*\[main\]/);
    expect(BUDGET).toMatch(/pull_request:[\s\S]*?branches:\s*\[main\]/);
  });

  it('declares cancel-in-progress concurrency', () => {
    expect(BUDGET).toMatch(/concurrency:[\s\S]*?cancel-in-progress:\s*true/);
  });

  it('enforces the 125 KB budget on dist/extension.js', () => {
    expect(BUDGET).toMatch(/BUDGET_BYTES=\$\(\(125 \* 1024\)\)/);
    expect(BUDGET).toMatch(/dist\/extension\.js/);
    expect(BUDGET).toMatch(/exceeds the 125 KB budget/);
  });

  it('writes a human-readable summary to $GITHUB_STEP_SUMMARY', () => {
    expect(BUDGET).toMatch(/\$GITHUB_STEP_SUMMARY/);
  });
});
