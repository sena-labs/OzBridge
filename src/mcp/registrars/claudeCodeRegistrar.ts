import * as os from 'os';
import * as path from 'path';
import { JsonMcpRegistrar } from './jsonRegistrarBase.js';

/**
 * Registrar for Anthropic's Claude Code CLI.
 *
 * Claude Code persists its MCP server list in `~/.claude.json`. The
 * file may contain additional top-level keys (UI preferences, MCP
 * auto-approve flags, etc.) that we MUST leave untouched — see
 * {@link JsonMcpRegistrar} for the preservation strategy.
 */
export class ClaudeCodeRegistrar extends JsonMcpRegistrar {
  readonly clientId = 'claude-code';
  readonly displayName = 'Claude Code (CLI)';
  readonly configPath: string;

  constructor(configPath?: string) {
    super();
    this.configPath = configPath ?? path.join(os.homedir(), '.claude.json');
  }
}
