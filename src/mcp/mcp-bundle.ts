/**
 * OPT-4: Lazy-load entry point for the MCP server and tool-registry modules.
 *
 * This file is compiled as a SEPARATE esbuild entry point (`dist/mcp-bundle.js`)
 * and is NOT included in the main extension bundle (`dist/extension.js`).
 * `lifecycle.ts` loads it on demand via `await import('./mcp-bundle.js')` inside
 * `McpLifecycle.start()`, so the HTTP-server and tool-descriptor code (≈9.5 KB
 * minified) is absent from the initial activation payload.
 */
export { McpServer } from './server.js';
export type { McpServerOptions, McpServerInfo } from './server.js';
export { buildToolRegistry } from './tools.js';
