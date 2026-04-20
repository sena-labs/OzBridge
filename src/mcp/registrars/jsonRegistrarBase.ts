import * as fs from 'fs';
import * as path from 'path';
import {
  IMcpClientRegistrar,
  McpClientEndpoint,
  McpRegistrationStatus,
} from '../clientRegistration.js';

/**
 * Configuration schema shared by the JSON-based registrars (Claude
 * Code, Cursor). Both clients use a `{ mcpServers: { <name>: {…} } }`
 * layout with an optional `url` key and an optional `headers` map for
 * bearer-token style auth.
 *
 * The shape is intentionally loose (`Record<string, unknown>`) so an
 * unrelated key the user has added in their config survives the
 * register / unregister cycle untouched.
 */
type McpServersMap = Record<string, Record<string, unknown>>;

/**
 * Shape we read from / write to the JSON file. We keep every other
 * top-level property by splat-copying `original`, so clients can keep
 * their unrelated settings intact.
 */
interface JsonConfig {
  mcpServers?: McpServersMap;
  [key: string]: unknown;
}

/**
 * Base class for all JSON-backed registrars. Sub-classes only need
 * to pick a `clientId`, `displayName`, and the absolute config path.
 *
 * The serialised entry always uses the canonical MCP client layout
 * understood by both Claude Code and Cursor:
 *
 * ```json
 * {
 *   "mcpServers": {
 *     "warp-vsc-bridge": {
 *       "url": "http://127.0.0.1:3847/sse",
 *       "headers": { "Authorization": "Bearer …" }
 *     }
 *   }
 * }
 * ```
 */
export abstract class JsonMcpRegistrar implements IMcpClientRegistrar {
  abstract readonly clientId: string;
  abstract readonly displayName: string;
  abstract readonly configPath: string;

  async register(endpoint: McpClientEndpoint): Promise<void> {
    const current = this.readConfig();
    const mcpServers: McpServersMap = { ...(current.mcpServers ?? {}) };
    mcpServers[endpoint.name] = buildServerEntry(endpoint);
    const next: JsonConfig = { ...current, mcpServers };
    this.writeConfig(next);
  }

  async unregister(serverName: string): Promise<void> {
    if (!fs.existsSync(this.configPath)) { return; }
    const current = this.readConfig();
    if (!current.mcpServers || !(serverName in current.mcpServers)) { return; }
    const mcpServers: McpServersMap = { ...current.mcpServers };
    delete mcpServers[serverName];
    const next: JsonConfig = { ...current, mcpServers };
    this.writeConfig(next);
  }

  async status(serverName: string): Promise<McpRegistrationStatus> {
    if (!fs.existsSync(this.configPath)) { return 'not-configured'; }
    const current = this.readConfig();
    if (current.mcpServers && serverName in current.mcpServers) { return 'registered'; }
    return 'missing';
  }

  // ------------------------------------------------------------------
  // Internals (protected so tests can spy, not part of public API).
  // ------------------------------------------------------------------

  protected readConfig(): JsonConfig {
    if (!fs.existsSync(this.configPath)) { return {}; }
    const raw = fs.readFileSync(this.configPath, 'utf8').trim();
    if (!raw) { return {}; }
    try {
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? (parsed as JsonConfig) : {};
    } catch {
      // Preserve user data over our own schema: if the file is not
      // valid JSON we refuse to touch it rather than silently
      // clobbering it on the next write.
      throw new Error(`${this.configPath}: file is not valid JSON`);
    }
  }

  protected writeConfig(next: JsonConfig): void {
    atomicWriteJson(this.configPath, next);
  }
}

function buildServerEntry(endpoint: McpClientEndpoint): Record<string, unknown> {
  const entry: Record<string, unknown> = { url: endpoint.url };
  if (endpoint.bearerToken) {
    entry.headers = { Authorization: `Bearer ${endpoint.bearerToken}` };
  }
  return entry;
}

/**
 * Writes `value` to `file` atomically, pretty-printed with 2-space
 * indentation. Parent directories are created recursively.
 */
export function atomicWriteJson(file: string, value: unknown): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}
