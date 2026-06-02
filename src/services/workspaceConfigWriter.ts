import { promises as fsp } from 'fs';
import * as path from 'path';

/**
 * Relative path of the workspace override file. Kept in sync with
 * `WORKSPACE_CONFIG_PATH` in `workspaceConfigResolver.ts`; duplicated here
 * (rather than imported) so this writer stays free of the `vscode` import the
 * resolver carries — letting the framework-agnostic MCP tool layer use it.
 */
const WORKSPACE_CONFIG_PATH = path.join('.warp', 'warp-bridge.yaml');

/**
 * Writes a single `key: value` override into the workspace
 * `.warp/warp-bridge.yaml`, the highest-precedence config source read by both
 * the VS Code extension ({@link WorkspaceConfigResolver}) and the standalone
 * MCP server ({@link StandaloneConfigManager}). Used so a model picked from any
 * surface persists for every client driving the same workspace.
 *
 * The file is a flat scalar map (see {@link parseFlatYaml}); we therefore
 * upsert one line, preserving every other line — including comments and
 * unrelated keys — verbatim.
 */

/**
 * Formats a scalar for the flat-YAML writer. Bare (unquoted) when the value
 * is a simple token (Oz model ids, profile names, environment ids all qualify);
 * double-quoted with JSON escaping otherwise so the value round-trips through
 * {@link parseFlatYaml}.
 *
 * @internal Exported for unit tests.
 */
export function formatYamlScalar(value: string): string {
  if (/^[A-Za-z0-9_./-]+$/.test(value)) {
    return value;
  }
  // JSON.stringify produces a double-quoted string with valid escapes, which
  // the parser decodes via JSON.parse for double-quoted values.
  return JSON.stringify(value);
}

/**
 * Returns `source` with `key` set to `value`: replaces the first existing
 * `key:` line if present, otherwise appends one. Trailing blank lines are
 * trimmed before appending so the file does not accumulate gaps on repeated
 * edits, and the result always ends with exactly one newline.
 *
 * @internal Exported for unit tests.
 */
export function upsertFlatYamlLine(source: string, key: string, value: string): string {
  const newLine = `${key}: ${formatYamlScalar(value)}`;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyRe = new RegExp(`^(\\s*)${escaped}(\\s*):`);

  const lines = source.split(/\r?\n/);
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    if (keyRe.test(lines[i])) {
      lines[i] = newLine;
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    lines.push(newLine);
  }
  let out = lines.join('\n');
  if (!out.endsWith('\n')) {
    out += '\n';
  }
  return out;
}

/**
 * Persists `key = value` into `<workspaceRoot>/.warp/warp-bridge.yaml`,
 * creating the file and `.warp/` directory if needed. The write is atomic
 * (temp file + rename). Returns the absolute path written.
 */
export async function setWorkspaceOverride(
  workspaceRoot: string,
  key: string,
  value: string,
): Promise<string> {
  if (typeof workspaceRoot !== 'string' || workspaceRoot.trim().length === 0) {
    throw new Error('setWorkspaceOverride: workspaceRoot is required');
  }
  const file = path.join(workspaceRoot, WORKSPACE_CONFIG_PATH);
  let current = '';
  try {
    current = await fsp.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
      throw err;
    }
    // ENOENT — start from an empty document.
  }
  const next = upsertFlatYamlLine(current, key, value);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.writeFile(tmp, next, 'utf8');
    await fsp.rename(tmp, file);
  } catch (err) {
    try { await fsp.unlink(tmp); } catch { /* best-effort cleanup */ }
    throw err;
  }
  return file;
}
