// IMPL: esbuild bundler configuration for VS Code extension
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// HIGH-1 (AUDIT-ROADMAP-v1.2): hard cap on the production bundle so
// CI fails before a regression ships to the Marketplace. The current
// bundle is ~151 KB after dashboard webview redesign (v1.1); we leave
// ~4 KB headroom. Override with OZBRIDGE_BUNDLE_MAX_KB if you intentionally
// need more space.
const BUNDLE_MAX_KB = Number(process.env.OZBRIDGE_BUNDLE_MAX_KB) || 155;

/** Shared base options for both extension and mcp-bundle chunks. */
const baseOptions = {
  bundle: true,
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: !production,
  minify: production,
  treeShaking: true,
};

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
  ...baseOptions,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
};

/**
 * Lazy-loaded chunk: McpServer + tool registry.
 * Loaded at runtime by lifecycle.ts via `await import('./mcp-bundle.js')`.
 * Must be built as a separate chunk so the HTTP-server code stays out of
 * the initial activation payload.
 */
/** @type {import('esbuild').BuildOptions} */
const mcpBundleOptions = {
  ...baseOptions,
  entryPoints: ['src/mcp/mcp-bundle.ts'],
  outfile: 'dist/mcp-bundle.js',
};

async function main() {
  if (watch) {
    const [ctxExt, ctxMcp] = await Promise.all([
      esbuild.context(extensionOptions),
      esbuild.context(mcpBundleOptions),
    ]);
    await Promise.all([ctxExt.watch(), ctxMcp.watch()]);
    console.log('[esbuild] watching for changes...');
  } else {
    await Promise.all([
      esbuild.build(extensionOptions),
      esbuild.build(mcpBundleOptions),
    ]);
    console.log('[esbuild] build complete');
    if (production) {
      const out = path.resolve(__dirname, extensionOptions.outfile);
      const sizeKb = fs.statSync(out).size / 1024;
      const sizeStr = sizeKb.toFixed(1);
      if (sizeKb > BUNDLE_MAX_KB) {
        console.error(
          `[esbuild] bundle ${sizeStr} KB exceeds budget ${BUNDLE_MAX_KB} KB. ` +
          `Either trim the code or raise OZBRIDGE_BUNDLE_MAX_KB intentionally.`,
        );
        process.exit(1);
      }
      console.log(`[esbuild] bundle ${sizeStr} KB / ${BUNDLE_MAX_KB} KB budget`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
