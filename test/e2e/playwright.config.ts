import { defineConfig } from '@playwright/test';
import * as path from 'node:path';

// Resolve the vscode module to the standalone shim so E2E helpers can import
// src/ code without the VS Code extension host. This mirrors the vitest alias
// in vitest.config.ts but for the Playwright runner.
process.env.TS_NODE_PROJECT = path.join(__dirname, 'tsconfig.e2e.json');

/**
 * Playwright config for OzBridge end-to-end tests.
 *
 * The E2E tests launch a real VS Code instance (Electron) through
 * `@vscode/test-electron`, load the extension in development mode
 * and simulate a user who opens the dashboard, tree views, status bar
 * and command palette. During the run a resource-usage report
 * (CPU/RAM) is recorded for every step.
 *
 * Run with:  npm run test:e2e
 */
export default defineConfig({
  testDir: __dirname,
  testMatch: ['**/*.e2e.spec.ts'],
  // Every e2e test boots Electron: a generous timeout is needed.
  timeout: 5 * 60 * 1000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(__dirname, '..', '..', 'test-results', 'e2e-report') }],
    ['json', { outputFile: path.join(__dirname, '..', '..', 'test-results', 'e2e.json') }],
  ],
  outputDir: path.join(__dirname, '..', '..', 'test-results', 'e2e-artifacts'),
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
});
