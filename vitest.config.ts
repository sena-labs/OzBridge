import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'vscode': path.resolve(__dirname, 'test/mocks/vscode.ts'),
      'copilot-chat-toolkit': path.resolve(__dirname, 'packages/copilot-chat-toolkit/src/index.ts'),
    },
  },
  test: {
    globals: true,
    root: '.',
    include: ['test/**/*.test.ts'],
    // MCP server tests open real TCP sockets on ephemeral ports; running
    // files in parallel occasionally collides with other suites that
    // dynamically import `src/extension.ts` and causes 5 s timeouts on
    // Windows CI runners. Serial file execution keeps the whole suite
    // deterministic at the cost of ~50 s extra wall-clock.
    fileParallelism: false,
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['packages/**'],
      // C-M5: Lock in current coverage as a regression floor. Values are
      // intentionally a few points below the latest measured totals
      // (statements 85.96 / branches 78.38 / functions 89.44 / lines 87.42) to
      // absorb local fluctuation while still flagging real drops.
      thresholds: {
        statements: 85,
        branches: 78,
        functions: 89,
        lines: 86,
      },
    },
  },
});
