/**
 * Library entry point for the standalone MCP server.
 *
 * Built as `dist/lib.js` (vscode shim bundled) so E2E tests and other
 * non-VS-Code consumers can `require` McpServer and buildToolRegistry
 * without needing the vscode extension host.
 */
export { McpServer } from '../../../src/mcp/server.js';
export type { McpServerOptions, McpServerInfo } from '../../../src/mcp/server.js';
export { buildToolRegistry } from '../../../src/mcp/tools.js';
