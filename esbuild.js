// IMPL: esbuild bundler configuration for VS Code extension
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// HIGH-1 (AUDIT-ROADMAP-v1.2): hard cap on the production bundle so
// CI fails before a regression ships to the Marketplace. The current
// bundle is ~120 KB; we leave ~10 KB headroom. Override with
// OZBRIDGE_BUNDLE_MAX_KB if you intentionally need more space.
const BUNDLE_MAX_KB = Number(process.env.OZBRIDGE_BUNDLE_MAX_KB) || 145;

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: !production,
  minify: production,
  treeShaking: true,
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('[esbuild] watching for changes...');
  } else {
    await esbuild.build(buildOptions);
    console.log('[esbuild] build complete');
    if (production) {
      const out = path.resolve(__dirname, buildOptions.outfile);
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
