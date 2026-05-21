/**
 * OPT-4: Lazy-load entry point for the MCP server and tool-registry modules.
 *
 * Also built as a standalone `dist/mcp-bundle.js` by esbuild.js (second entry
 * point). In the extension build, esbuild inlines this as an `__esm` lazy chunk
 * rather than a separate file — the dynamic import in `lifecycle.ts` resolves to
 * the inlined initializer, so HTTP-server code is not evaluated at activation time.
 */
export { McpServer } from './server.js';
export type { McpServerOptions, McpServerInfo } from './server.js';
export { buildToolRegistry } from './tools.js';
