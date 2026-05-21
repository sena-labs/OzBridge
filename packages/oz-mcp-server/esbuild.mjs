import esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes('--production');

const vscodeShim = path.resolve(__dirname, 'src/vscode-shim.ts');
const toolkitSrc = path.resolve(__dirname, '../copilot-chat-toolkit/src/index.ts');

const sharedOptions = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  alias: {
    vscode: vscodeShim,
    'copilot-chat-toolkit': toolkitSrc,
  },
  tsconfig: path.resolve(__dirname, 'tsconfig.json'),
  external: [],
  sourcemap: !production,
  minify: production,
  treeShaking: true,
  logLevel: 'info',
};

// CLI entry point (executable)
await esbuild.build({
  ...sharedOptions,
  entryPoints: [path.resolve(__dirname, 'src/server.ts')],
  outfile: path.resolve(__dirname, 'dist/server.js'),
  banner: { js: '#!/usr/bin/env node' },
});

// Library entry point: McpServer + buildToolRegistry without CLI side effects.
// Used by E2E tests (Playwright) so they can import MCP types without
// the VS Code extension host.
await esbuild.build({
  ...sharedOptions,
  entryPoints: [path.resolve(__dirname, 'src/lib.ts')],
  outfile: path.resolve(__dirname, 'dist/lib.js'),
  logLevel: 'silent',
});

if (production) {
  const outPath = path.resolve(__dirname, 'dist/server.js');
  const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`[esbuild] bundle ${sizeKb} KB`);
}

// Make the output executable on Unix
const outFile = path.resolve(__dirname, 'dist/server.js');
try {
  fs.chmodSync(outFile, 0o755);
} catch {
  // Windows — chmod not needed
}
