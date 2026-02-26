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
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['packages/**'],
    },
  },
});
