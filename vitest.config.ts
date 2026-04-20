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
    },
  },
});
