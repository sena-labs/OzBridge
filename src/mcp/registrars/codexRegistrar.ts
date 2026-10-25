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
 * uses a **minimal, line-based writer** that only touches the tables
 * belonging to our server. Every other byte of the file is preserved
 * verbatim.
 *
 * Current Codex format (one table per server, Streamable HTTP):
 *
 * ```toml
 * [mcp_servers.oz-bridge]
 * url = "http://127.0.0.1:3847/mcp"
 * http_headers = { "Authorization" = "Bearer …" }
 * ```
 *
 * Older OzBridge releases wrote a `[[mcp.servers]]` array-of-tables
 * block (with `name`/`url`/`bearer_token`) that current Codex ignores.
 * Register and unregister also remove that legacy block for the same
 * server name, so existing users are migrated in place.
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
      const withoutExisting = removeServer(original, endpoint.name);
      const appended = appendServerTable(withoutExisting, endpoint);
      await atomicWriteText(this.configPath, appended);
    });
  }

  async unregister(serverName: string): Promise<void> {
    return withConfigLock(this.configPath, async () => {
      const original = await readIfExists(this.configPath);
      if (original === undefined) { return; }
      const next = removeServer(original, serverName);
      if (next === original) { return; }
      await atomicWriteText(this.configPath, next);
    });
  }

  async status(serverName: string): Promise<McpRegistrationStatus> {
    return withConfigLock(this.configPath, async () => {
      const original = await readIfExists(this.configPath);
      if (original === undefined) { return 'not-configured'; }
      return findServerRanges(original, serverName).current.length > 0
        ? 'registered'
        : 'missing';
    });
  }
}

// ===========================================================================
// Minimal TOML helpers — only understand our own tables.
// ===========================================================================

interface BlockRange {
  /** Inclusive line index of the table header. */
  readonly start: number;
  /** Exclusive line index where the block ends (next header or EOF). */
  readonly end: number;
}

const LEGACY_HEADER = /^\s*\[\[\s*mcp\.servers\s*\]\]\s*$/;
const ANY_TABLE_HEADER = /^\s*\[{1,2}[^\]\r\n]+\]{1,2}\s*$/;
const NAME_LINE = /^\s*name\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/;
const BARE_KEY = /^[A-Za-z0-9_-]+$/;

/** TOML key for `serverName`: bare when allowed, quoted otherwise. */
export function tomlKey(serverName: string): string {
  return BARE_KEY.test(serverName) ? serverName : `"${escapeTomlString(serverName)}"`;
}

function blockEnd(lines: string[], start: number): number {
  for (let j = start + 1; j < lines.length; j++) {
    if (ANY_TABLE_HEADER.test(lines[j])) { return j; }
  }
  return lines.length;
}

/**
 * Returns a header matcher for `[mcp_servers.<name>]` and its subtables
 * (`[mcp_servers.<name>.env]`, …), accepting the name bare or quoted.
 */
function currentHeaderMatcher(serverName: string): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const variants = [`"${escapeTomlString(serverName)}"`];
  if (BARE_KEY.test(serverName)) { variants.push(serverName); }
  const names = variants.map(esc).join('|');
  return new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*(?:${names})\\s*(?:\\.[^\\]]*)?\\]\\s*$`);
}

function findServerRanges(text: string, serverName: string): { current: BlockRange[]; legacy: BlockRange[] } {
  const lines = text.split(/\r?\n/);
  const isCurrent = currentHeaderMatcher(serverName);
  const current: BlockRange[] = [];
  const legacy: BlockRange[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isCurrent.test(lines[i])) {
      const end = blockEnd(lines, i);
      current.push({ start: i, end });
      i = end - 1;
    } else if (LEGACY_HEADER.test(lines[i])) {
      const end = blockEnd(lines, i);
      for (let k = i + 1; k < end; k++) {
        const m = NAME_LINE.exec(lines[k]);
        if (m && unescapeTomlString(m[1]) === serverName) {
          legacy.push({ start: i, end });
          break;
        }
      }
      i = end - 1;
    }
  }
  return { current, legacy };
}

/**
 * Removes every table belonging to `serverName` (current format and
 * legacy `[[mcp.servers]]`), including the blank lines that separated
 * each removed block from the previous one, so repeated edits do not
 * accumulate gaps.
 */
function removeServer(text: string, serverName: string): string {
  const { current, legacy } = findServerRanges(text, serverName);
  const ranges = [...current, ...legacy].sort((a, b) => b.start - a.start);
  if (ranges.length === 0) { return text; }

  let lines = text.split(/\r?\n/);
  for (const range of ranges) {
    let removeStart = range.start;
    let removeEnd = range.end;
    while (removeStart > 0 && lines[removeStart - 1].trim() === '') {
      removeStart--;
    }
    if (removeEnd < lines.length && lines[removeEnd].trim() === '') {
      removeEnd++;
    }
    lines = [...lines.slice(0, removeStart), ...lines.slice(removeEnd)];
  }
  return lines.join('\n');
}

function appendServerTable(text: string, endpoint: McpClientEndpoint): string {
  const sections: string[] = [];
  sections.push(`[mcp_servers.${tomlKey(endpoint.name)}]`);
  sections.push(`url = "${escapeTomlString(endpoint.url)}"`);
  if (endpoint.bearerToken) {
    sections.push(`http_headers = { "Authorization" = "Bearer ${escapeTomlString(endpoint.bearerToken)}" }`);
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
