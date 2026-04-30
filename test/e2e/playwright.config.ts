import { defineConfig } from '@playwright/test';
import * as path from 'node:path';

/**
 * Playwright config for OzBridge end-to-end tests.
 *
 * I test E2E avviano un'istanza reale di VS Code (Electron) tramite
 * `@vscode/test-electron`, caricano l'estensione in development mode
 * e simulano un utente che apre dashboard, tree views, status bar
 * e command palette. Durante l'esecuzione viene registrato un report
 * di utilizzo risorse (CPU/RAM) per ogni step.
 *
 * Lanciare con:  npm run test:e2e
 */
export default defineConfig({
  testDir: __dirname,
  testMatch: ['**/*.e2e.spec.ts'],
  // Ogni test e2e fa boot di Electron: serve un timeout generoso.
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
