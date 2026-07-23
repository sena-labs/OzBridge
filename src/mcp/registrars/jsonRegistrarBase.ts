import { promises as fsp } from 'fs';
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
 *     "oz-bridge": {
 *       "type": "sse",
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
    return withConfigLock(this.configPath, async () => {
      const current = await this.readConfig();
      const mcpServers: McpServersMap = { ...(current.mcpServers ?? {}) };
      mcpServers[endpoint.name] = buildServerEntry(endpoint);
      const next: JsonConfig = { ...current, mcpServers };
      await this.writeConfig(next);
    });
  }

  async unregister(serverName: string): Promise<void> {
    return withConfigLock(this.configPath, async () => {
      if (!(await pathExists(this.configPath))) { return; }
      const current = await this.readConfig();
      if (!current.mcpServers || !(serverName in current.mcpServers)) { return; }
      const mcpServers: McpServersMap = { ...current.mcpServers };
      delete mcpServers[serverName];
      const next: JsonConfig = { ...current, mcpServers };
      await this.writeConfig(next);
    });
  }

  async status(serverName: string): Promise<McpRegistrationStatus> {
    return withConfigLock(this.configPath, async () => {
      if (!(await pathExists(this.configPath))) { return 'not-configured'; }
      const current = await this.readConfig();
      if (current.mcpServers && serverName in current.mcpServers) { return 'registered'; }
      return 'missing';
    });
  }

  // ------------------------------------------------------------------
  // Internals (protected so tests can spy, not part of public API).
  // ------------------------------------------------------------------

  protected async readConfig(): Promise<JsonConfig> {
    let raw: string;
    try {
      raw = (await fsp.readFile(this.configPath, 'utf8')).trim();
    } catch (err) {
      if ((err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') { return {}; }
      throw err;
    }
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

  protected async writeConfig(next: JsonConfig): Promise<void> {
    await atomicWriteJson(this.configPath, next);
  }
}

/**
 * Per-config-path serialization queue.
 *
 * `register()` / `unregister()` perform a read-modify-write over the IDE's
 * JSON config (`~/.claude.json`, `~/.cursor/mcp.json`). `atomicWriteJson`
 * makes the final `rename` atomic, but two concurrent invocations against
 * the same file would still both observe the *same* `current` snapshot,
 * each splice their own copy, and let the last `rename` win — silently
 * dropping the first caller's change.
 *
 * The chain below serializes every read-modify-write against a given
 * absolute path so the second invocation always observes the first's
 * result. The map is keyed by `configPath`, so different IDE configs
 * (Claude Code vs Cursor) progress in parallel.
 *
 * This is **per-process**: it does not protect against a second VS Code
 * window racing on the same file. In practice each window picks a
 * distinct `mcpPort`, so the cross-window scenario is benign — the worst
 * case is identical writes overwriting each other to the same value.
 */
const configLocks = new Map<string, Promise<void>>();

export async function withConfigLock<T>(configPath: string, work: () => Promise<T>): Promise<T> {
  const previous = configLocks.get(configPath) ?? Promise.resolve();
  const next = previous.then(work, work);
  // Replace the chain with a sentinel that never rejects so a single
  // failing caller never poisons subsequent ones; each caller still
  // observes its own rejection through the returned `next`.
  const settled: Promise<void> = next.then(() => undefined, () => undefined);
  configLocks.set(configPath, settled);
  // Drop the entry once it settles — but only if no later caller has
  // already chained onto it. Without this cleanup the map would grow
  // monotonically over a long-running session (each unique tmp path
  // in tests, every distinct user config across the lifetime of the
  // extension host) since chains are never collected on their own.
  void settled.then(() => {
    if (configLocks.get(configPath) === settled) {
      configLocks.delete(configPath);
    }
  });
  return next;
}

/** Test-only: clear the per-path lock map between tests. */
export function __resetConfigLocksForTests(): void {
  configLocks.clear();
}

/** True iff `p` exists; false on ENOENT. */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

function buildServerEntry(endpoint: McpClientEndpoint): Record<string, unknown> {
  // `type: "sse"` is required by Claude Code to distinguish SSE transport
  // from the default stdio transport. Cursor ignores this field but accepts it.
  const entry: Record<string, unknown> = { type: 'sse', url: endpoint.url };
  if (endpoint.bearerToken) {
    entry.headers = { Authorization: `Bearer ${endpoint.bearerToken}` };
  }
  return entry;
}

/**
 * Writes `value` to `file` atomically, pretty-printed with 2-space
 * indentation. Parent directories are created recursively. All
 * filesystem ops are async to avoid blocking the extension-host
 * event loop on slower disks.
 */
export async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    const dir = path.dirname(file);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fsp.rename(tmp, file);
  } catch (err) {
    // Best-effort cleanup of orphan tmp file (e.g. when rename fails after
    // a successful write) — never let a cleanup failure mask the real error.
    try { await fsp.unlink(tmp); } catch { /* ignore */ }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to write config file ${file}: ${msg}`);
  }
}
