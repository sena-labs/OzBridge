import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  IMcpClientRegistrar,
  McpClientEndpoint,
  McpRegistrationStatus,
} from '../clientRegistration.js';
import { withConfigLock } from './jsonRegistrarBase.js';

/**
 * Registrar for OpenAI's Codex CLI.
 *
 * Codex stores its configuration in `~/.codex/config.toml`. Unlike
 * Claude Code and Cursor — which use JSON — Codex's format is TOML,
 * and users tend to keep hand-curated comments and unrelated tables
 * in the same file.
 *
 * Rather than pulling in a full TOML parser (adding a dependency and
 * bundle weight for what amounts to one feature) this implementation
 * uses a **minimal, line-based writer** that only understands
 * `[[mcp.servers]]` array-of-tables. Every other byte of the file is
 * preserved verbatim.
 *
 * Grammar accepted for our own blocks:
 *
 * ```toml
 * [[mcp.servers]]
 * name = "oz-bridge"
 * url = "http://127.0.0.1:3847/sse"
 * bearer_token = "…"
 * ```
 *
 * Keys outside this narrow set inside an `[[mcp.servers]]` block are
 * preserved when re-writing the block.
 */
export class CodexRegistrar implements IMcpClientRegistrar {
  readonly clientId = 'codex';
  readonly displayName = 'Codex (CLI)';
  readonly configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath ?? path.join(os.homedir(), '.codex', 'config.toml');
  }

  async register(endpoint: McpClientEndpoint): Promise<void> {
    return withConfigLock(this.configPath, async () => {
      const original = (await readIfExists(this.configPath)) ?? '';
      const withoutExisting = removeMcpServerBlock(original, endpoint.name);
      const appended = appendMcpServerBlock(withoutExisting, endpoint);
      await atomicWriteText(this.configPath, appended);
    });
  }

  async unregister(serverName: string): Promise<void> {
    return withConfigLock(this.configPath, async () => {
      const original = await readIfExists(this.configPath);
      if (original === undefined) { return; }
      const next = removeMcpServerBlock(original, serverName);
      if (next === original) { return; }
      await atomicWriteText(this.configPath, next);
    });
  }

  async status(serverName: string): Promise<McpRegistrationStatus> {
    return withConfigLock(this.configPath, async () => {
      const original = await readIfExists(this.configPath);
      if (original === undefined) { return 'not-configured'; }
      return findMcpServerBlock(original, serverName) !== undefined
        ? 'registered'
        : 'missing';
    });
  }
}

// ===========================================================================
// Minimal TOML helpers — only understand `[[mcp.servers]]` tables.
// ===========================================================================

interface BlockRange {
  /** Inclusive line index of the `[[mcp.servers]]` header. */
  readonly start: number;
  /** Exclusive line index where the block ends (next header or EOF). */
  readonly end: number;
}

const MCP_SERVER_HEADER = /^\s*\[\[\s*mcp\.servers\s*\]\]\s*$/;
const ANY_TABLE_HEADER = /^\s*\[{1,2}[^\]\r\n]+\]{1,2}\s*$/;
const NAME_LINE = /^\s*name\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/;

function findAllMcpServerBlocks(text: string): BlockRange[] {
  const lines = text.split(/\r?\n/);
  const ranges: BlockRange[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!MCP_SERVER_HEADER.test(lines[i])) { continue; }
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (ANY_TABLE_HEADER.test(lines[j])) { end = j; break; }
    }
    ranges.push({ start: i, end });
    i = end - 1;
  }
  return ranges;
}

/**
 * Returns the `BlockRange` of the `[[mcp.servers]]` block whose
 * `name` key equals `serverName`, or `undefined` if no such block
 * exists.
 */
function findMcpServerBlock(text: string, serverName: string): BlockRange | undefined {
  const lines = text.split(/\r?\n/);
  for (const range of findAllMcpServerBlocks(text)) {
    for (let k = range.start + 1; k < range.end; k++) {
      const m = NAME_LINE.exec(lines[k]);
      if (m && unescapeTomlString(m[1]) === serverName) {
        return range;
      }
    }
  }
  return undefined;
}

/**
 * Removes the `[[mcp.servers]]` block named `serverName`, including
 * any immediately preceding blank lines that introduced it, so the
 * resulting file does not accumulate stray separators.
 */
function removeMcpServerBlock(text: string, serverName: string): string {
  const range = findMcpServerBlock(text, serverName);
  if (!range) { return text; }

  const lines = text.split(/\r?\n/);
  let removeStart = range.start;
  // Drop trailing blank lines inside the block (they belong to it).
  let removeEnd = range.end;
  // Strip leading blank lines immediately before the header if they
  // only served to separate it from the previous block.
  while (removeStart > 0 && lines[removeStart - 1].trim() === '') {
    removeStart--;
  }
  // Strip one trailing blank line after the block if present, to
  // avoid accumulating gaps on repeated edits.
  if (removeEnd < lines.length && lines[removeEnd].trim() === '') {
    removeEnd++;
  }
  const next = [...lines.slice(0, removeStart), ...lines.slice(removeEnd)].join('\n');
  return next;
}

function appendMcpServerBlock(text: string, endpoint: McpClientEndpoint): string {
  const sections: string[] = [];
  sections.push('[[mcp.servers]]');
  sections.push(`name = "${escapeTomlString(endpoint.name)}"`);
  sections.push(`url = "${escapeTomlString(endpoint.url)}"`);
  if (endpoint.bearerToken) {
    sections.push(`bearer_token = "${escapeTomlString(endpoint.bearerToken)}"`);
  }
  const block = sections.join('\n');

  if (text.length === 0) { return `${block}\n`; }
  const separator = text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  return `${text}${separator}${block}\n`;
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function unescapeTomlString(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

async function atomicWriteText(file: string, content: string): Promise<void> {
  const dir = path.dirname(file);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.writeFile(tmp, content, 'utf8');
    await fsp.rename(tmp, file);
  } catch (err) {
    // The temp file may carry a bearer token; never leave it orphaned on a
    // failed rename (mirrors atomicWriteJson in jsonRegistrarBase.ts).
    try { await fsp.unlink(tmp); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

/** Reads the file content, or undefined when it does not exist (ENOENT). */
async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return undefined;
    }
    throw err;
  }
}
