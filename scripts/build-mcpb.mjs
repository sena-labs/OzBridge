#!/usr/bin/env node
/**
 * Build the MCPB bundle for @sena-labs/oz-mcp-server.
 *
 * Why this exists: Smithery cannot list a stdio server behind `npx` through
 * its URL flow — that path requires Streamable HTTP. The supported route for a
 * locally-run server is an MCPB bundle, which clients download and execute
 * themselves. This produces that bundle.
 *
 * Every value comes from packages/oz-mcp-server/package.json so the bundle
 * cannot drift from the npm release the way the hardcoded server version did.
 *
 * Usage: node scripts/build-mcpb.mjs   ->   dist-mcpb/oz-mcp-server.mcpb
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Ask the freshly built server for its own tool list over stdio.
 *
 * The manifest is generated from this rather than from a hand-written array:
 * Smithery's publish API rejects tool entries without an `inputSchema`, and a
 * copied-out list would drift from the real surface the first time a tool
 * changes — the same failure mode as the hardcoded server version.
 */
function readToolsFromServer(entry) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [entry, '--stdio'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('timed out waiting for tools/list'));
    }, 30_000);

    child.stdout.on('data', (chunk) => {
      buf += chunk;
      for (const line of buf.split('\n')) {
        if (!line.trim()) { continue; }
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.result?.tools) {
          clearTimeout(timer);
          child.kill();
          resolve(msg.result.tools);
        }
      }
    });
    child.on('error', reject);

    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 'build-mcpb', version: '1' },
      },
    }) + '\n');
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    }) + '\n');
  });
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(root, 'packages/oz-mcp-server');
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const stage = path.join(root, 'dist-mcpb');
const outFile = path.join(stage, 'oz-mcp-server.mcpb');

// A fresh production bundle: esbuild inlines every dependency, so the MCPB
// needs no node_modules/ alongside the entry point.
execFileSync('node', [path.join(pkgDir, 'esbuild.mjs'), '--production'], {
  cwd: root, stdio: 'inherit',
});

const tools = await readToolsFromServer(path.join(pkgDir, 'dist/server.js'));
if (!tools.length) { throw new Error('server reported no tools'); }
console.log(`[mcpb] harvested ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`);

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'pack/server'), { recursive: true });
fs.copyFileSync(
  path.join(pkgDir, 'dist/server.js'),
  path.join(stage, 'pack/server/server.js'),
);
fs.copyFileSync(path.join(pkgDir, 'README.md'), path.join(stage, 'pack/README.md'));

const manifest = {
  manifest_version: '0.3',
  name: 'oz-mcp-server',
  display_name: 'OzBridge — Warp Oz for any MCP client',
  version: pkg.version,
  description: pkg.description,
  long_description: [
    'Exposes the Warp Oz agent toolset over MCP: run agents locally or in the',
    'cloud, inspect and list runs, list models and set the default model.',
    '',
    '**Requires the Warp Oz CLI on PATH** (check with `oz --version`).',
    'Download Warp from https://www.warp.dev/download.',
    '',
    'The server only shells out to the documented `oz` CLI — it does not embed,',
    'modify, or reverse-engineer Warp.',
    '',
    'OzBridge is an independent project and is not affiliated with, endorsed by,',
    'or sponsored by Warp. "Warp" and "Oz" are trademarks of Warp, Inc., used',
    'nominatively to describe interoperability.',
  ].join('\n'),
  author: { name: 'Sena Labs', url: 'https://github.com/sena-labs' },
  repository: { type: 'git', url: pkg.repository.url },
  homepage: pkg.homepage,
  documentation: 'https://github.com/sena-labs/OzBridge/blob/main/docs/MCP.md',
  support: pkg.bugs.url,
  license: pkg.license,
  keywords: pkg.keywords,
  server: {
    type: 'node',
    entry_point: 'server/server.js',
    mcp_config: {
      command: 'node',
      // --stdio is required: without it the server starts its HTTP+SSE
      // listener and never speaks the protocol on stdout.
      args: ['${__dirname}/server/server.js', '--stdio'],
      env: {
        OZ_PATH: '${user_config.oz_path}',
        OZ_DEFAULT_MODEL: '${user_config.default_model}',
        OZ_DEFAULT_PROFILE: '${user_config.default_profile}',
      },
    },
  },
  // Deliberately NOT a `tools` array. The two specs conflict: `mcpb validate`
  // rejects `inputSchema` inside a tool entry ("Unrecognized key"), while
  // Smithery's publish API rejects entries without it — a bundle carrying six
  // tools fails with six "expected object, received undefined". Declaring the
  // tools as runtime-generated satisfies both, and clients get the real
  // schemas from the server's own tools/list, which is authoritative anyway.
  // The harvest above still runs: it fails the build if the server exposes no
  // tools, and prints the surface being shipped.
  tools_generated: true,
  compatibility: { runtimes: { node: '>=20.19' } },
  user_config: {
    oz_path: {
      type: 'string',
      title: 'Oz CLI path',
      description: 'Path to the Oz CLI binary. Bare "oz" resolves from PATH.',
      default: 'oz',
      required: false,
    },
    default_model: {
      type: 'string',
      title: 'Default model',
      description: 'Default AI model for runs. "auto" lets Warp choose.',
      default: 'auto',
      required: false,
    },
    default_profile: {
      type: 'string',
      title: 'Default Oz profile',
      description: 'Default Oz agent profile.',
      default: 'Default',
      required: false,
    },
  },
};

fs.writeFileSync(
  path.join(stage, 'pack/manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);

execFileSync('npx', ['-y', '@anthropic-ai/mcpb@latest', 'validate', 'pack/manifest.json'], {
  cwd: stage, stdio: 'inherit',
});
execFileSync('npx', ['-y', '@anthropic-ai/mcpb@latest', 'pack', 'pack', outFile], {
  cwd: stage, stdio: 'inherit',
});

console.log(`\n[mcpb] ${outFile} — v${manifest.version}`);
