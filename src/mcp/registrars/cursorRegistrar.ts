import * as os from 'os';
import * as path from 'path';
import { JsonMcpRegistrar } from './jsonRegistrarBase.js';

/**
 * Registrar for Cursor.
 *
 * Cursor stores its MCP config at `~/.cursor/mcp.json`. The layout is
 * identical to Claude Code's (`{ mcpServers: { <name>: {...} } }`),
 * so this registrar reuses {@link JsonMcpRegistrar} wholesale and
 * only overrides the config path.
 */
export class CursorRegistrar extends JsonMcpRegistrar {
  readonly clientId = 'cursor';
  readonly displayName = 'Cursor';
  readonly configPath: string;

  constructor(configPath?: string) {
    super();
    this.configPath = configPath ?? path.join(os.homedir(), '.cursor', 'mcp.json');
  }
}
