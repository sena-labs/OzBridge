/**
 * MCP client auto-registration contract.
 *
 * Each supported MCP-speaking client (Claude Code, Cursor, Codex, …)
 * ships its own configuration file with a slightly different
 * schema. A {@link IMcpClientRegistrar} abstracts the read / modify /
 * write cycle for one such file and exposes a uniform API so the
 * orchestrator (and the VS Code commands in
 * `src/mcp/lifecycle.ts`) does not have to know about each file's
 * particular syntax.
 *
 * All writes performed by conforming implementations MUST be
 * atomic (tmp file + rename) so a partially-written config never
 * lands on disk.
 */

/** Endpoint coordinates required to reach a running MCP server. */
export interface McpClientEndpoint {
  /** Unique server name used as the key inside the client's config. */
  readonly name: string;
  /** Full URL to the MCP transport (e.g. `http://127.0.0.1:3847/sse`). */
  readonly url: string;
  /** Optional bearer token injected as an `Authorization` header. */
  readonly bearerToken?: string;
}

/** Presence of a given server inside a client's config file. */
export type McpRegistrationStatus =
  | 'registered'      // config file exists and contains the server entry
  | 'missing'         // config file exists but the server entry is absent
  | 'not-configured'; // config file does not exist at all

/**
 * Implementations know how to speak a single client's configuration
 * format. The interface is intentionally narrow: one entry point per
 * operation and a single read-only metadata pair (`clientId` +
 * `displayName`) used by the QuickPick in
 * {@link registerMcpClientCommands}.
 */
export interface IMcpClientRegistrar {
  /** Stable identifier, e.g. `'claude-code'`, `'cursor'`, `'codex'`. */
  readonly clientId: string;
  /** Human-readable name for QuickPick / logs. */
  readonly displayName: string;
  /** Absolute path of the config file the registrar manages. */
  readonly configPath: string;

  /**
   * Adds or updates the given server inside the config file. Creates
   * the file and any parent directories if they do not exist yet.
   *
   * This method MUST preserve every unrelated entry in the file.
   */
  register(endpoint: McpClientEndpoint): Promise<void>;

  /**
   * Removes the named server from the config file. A no-op if the
   * file or entry does not exist.
   */
  unregister(serverName: string): Promise<void>;

  /**
   * Reports whether the named server is currently registered. Never
   * throws for missing files — returns `'not-configured'`.
   */
  status(serverName: string): Promise<McpRegistrationStatus>;
}
