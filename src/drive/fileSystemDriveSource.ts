import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseFlatYaml } from '../services/yamlParser.js';
import { logWarn } from '../services/logger.js';
import {
  IWarpDriveSource,
  DrivePrompt,
  DriveRule,
  DriveSkill,
} from './warpDriveSource.js';

// ===========================================================================
// Conventions
// ===========================================================================
//
// Default directory layout (relative to the user's home directory):
//
//   ~/.warp/drive/prompts/<name>.md       → DrivePrompt
//   ~/.agents/rules/<name>.md             → DriveRule
//   ~/.agents/skills/<name>/SKILL.md      → DriveSkill
//
// Every file may declare a YAML frontmatter block delimited by `---`
// lines at the very top. We extract it with the same `parseFlatYaml`
// reader used for `.warp/warp-bridge.yaml`, which guarantees a
// dependency-free, never-throwing parse with best-effort scalar
// coercion.

/**
 * Runtime knobs for {@link FileSystemDriveSource}. All paths fall back
 * to the canonical locations under the user's home directory when
 * omitted. Override them from the factory (and from every test) to
 * point at a sandboxed temp directory.
 */
export interface FileSystemDriveOptions {
  homeDir?: string;
  promptsDir?: string;
  rulesDir?: string;
  skillsDir?: string;
}

/**
 * Pure-filesystem implementation of {@link IWarpDriveSource}. Used by
 * the factory when the Oz CLI does not expose the `drive` subcommand
 * or when a user wants offline access to their local prompts / rules /
 * skills.
 *
 * All reads are synchronous (`fs.readFileSync`) — the directories are
 * small and reads happen lazily from the sidebar. The async signatures
 * in {@link IWarpDriveSource} are honoured nonetheless so the contract
 * stays identical to the CLI source.
 */
export class FileSystemDriveSource implements IWarpDriveSource {
  readonly label = 'filesystem';

  private readonly promptsDir: string;
  private readonly rulesDir: string;
  private readonly skillsDir: string;
  private readonly allowedRoots: string[];

  constructor(opts: FileSystemDriveOptions = {}) {
    const home = opts.homeDir ?? os.homedir();
    this.promptsDir = opts.promptsDir ?? path.join(home, '.warp', 'drive', 'prompts');
    this.rulesDir = opts.rulesDir ?? path.join(home, '.agents', 'rules');
    this.skillsDir = opts.skillsDir ?? path.join(home, '.agents', 'skills');
    this.allowedRoots = [this.promptsDir, this.rulesDir, this.skillsDir].map(
      toCanonicalRoot,
    );
  }

  async listPrompts(): Promise<DrivePrompt[]> {
    return listMarkdownFiles(this.promptsDir).flatMap((file) => {
      const entry = parsePromptFile(file);
      return entry ? [entry] : [];
    });
  }

  async listRules(): Promise<DriveRule[]> {
    return listMarkdownFiles(this.rulesDir).flatMap((file) => {
      const entry = parseRuleFile(file);
      return entry ? [entry] : [];
    });
  }

  async listSkills(): Promise<DriveSkill[]> {
    return listSkillFolders(this.skillsDir).flatMap((file) => {
      const entry = parseSkillFile(file);
      return entry ? [entry] : [];
    });
  }

  async read(id: string): Promise<string> {
    const trimmed = id.trim();
    if (!trimmed) {
      throw new Error('FileSystemDriveSource.read: empty id');
    }
    const resolved = path.resolve(trimmed);
    const allowedByResolvedPath = this.allowedRoots.some((root) => isInside(resolved, root));
    if (!allowedByResolvedPath) {
      throw new Error(`FileSystemDriveSource.read: path outside allowed roots: ${resolved}`);
    }

    let canonicalResolved: string;
    try {
      canonicalResolved = fs.realpathSync(resolved);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`FileSystemDriveSource.read: ${msg}`);
    }

    // Security: refuse reads outside the directories this source
    // governs. Prevents a compromised tree node from asking the
    // extension to leak arbitrary files, including symlink escapes.
    const allowed = this.allowedRoots.some((root) => isInside(canonicalResolved, root));
    if (!allowed) {
      throw new Error(`FileSystemDriveSource.read: path outside allowed roots: ${canonicalResolved}`);
    }
    try {
      return fs.readFileSync(canonicalResolved, 'utf8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`FileSystemDriveSource.read: ${msg}`);
    }
  }
}

// ===========================================================================
// Listing helpers
// ===========================================================================

/** Lists every `.md` file immediately inside `dir`, sorted by name. */
function listMarkdownFiles(dir: string): string[] {
  const absolute = path.resolve(dir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absolute, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
    .map((e) => path.join(absolute, e.name))
    .sort();
}

/**
 * Lists `<skillsDir>/<name>/SKILL.md` for every direct subdirectory
 * of `skillsDir`. Skill folders without a `SKILL.md` file are
 * silently skipped.
 */
function listSkillFolders(skillsDir: string): string[] {
  const absolute = path.resolve(skillsDir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absolute, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) { continue; }
    const candidate = path.join(absolute, entry.name, 'SKILL.md');
    if (fs.existsSync(candidate)) {
      out.push(candidate);
    }
  }
  return out.sort();
}

// ===========================================================================
// File parsers
// ===========================================================================

function parsePromptFile(filePath: string): DrivePrompt | undefined {
  const meta = extractMetadata(filePath);
  if (!meta) { return undefined; }
  return {
    id: filePath,
    category: 'prompt',
    name: meta.name,
    description: meta.description,
    tags: meta.tags,
    source: 'filesystem',
    updatedAt: meta.updatedAt,
  };
}

function parseRuleFile(filePath: string): DriveRule | undefined {
  const meta = extractMetadata(filePath);
  if (!meta) { return undefined; }
  let scope: 'global' | 'project' | undefined;
  if (meta.raw.scope === 'global' || meta.raw.scope === 'project') {
    scope = meta.raw.scope;
  }
  return {
    id: filePath,
    category: 'rule',
    name: meta.name,
    description: meta.description,
    tags: meta.tags,
    source: 'filesystem',
    updatedAt: meta.updatedAt,
    scope,
  };
}

function parseSkillFile(filePath: string): DriveSkill | undefined {
  const meta = extractMetadata(filePath, 'skill');
  if (!meta) { return undefined; }
  const model = typeof meta.raw.model === 'string' ? meta.raw.model : undefined;
  return {
    id: filePath,
    category: 'skill',
    name: meta.name,
    description: meta.description,
    tags: meta.tags,
    source: 'filesystem',
    updatedAt: meta.updatedAt,
    model,
  };
}

// ===========================================================================
// Metadata extraction
// ===========================================================================

interface ExtractedMetadata {
  name: string;
  description?: string;
  tags?: string[];
  updatedAt?: string;
  raw: Record<string, unknown>;
}

/**
 * Reads a markdown file, pulls its optional YAML frontmatter and
 * derives a `DriveBase`-compatible metadata record.
 *
 * - `name` defaults to the frontmatter `name` field, falling back to
 *   the parent directory name for SKILL files or the filename
 *   (without extension) for prompts and rules.
 * - `description` is taken verbatim from the frontmatter.
 * - `tags` accepts a YAML string value `"a, b, c"` (flat YAML is a
 *   scalars-only parser, so lists aren't supported directly) and
 *   splits it on commas.
 * - `updatedAt` is the file's `mtime` in ISO format.
 */
function extractMetadata(
  filePath: string,
  variety: 'prompt' | 'rule' | 'skill' = 'prompt',
): ExtractedMetadata | undefined {
  let source: string;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    logWarn(`fileSystemDriveSource: cannot read ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
  const frontmatter = extractFrontmatterBlock(source);
  const parsed = frontmatter !== undefined ? parseFlatYaml(frontmatter) : { data: {}, errors: [] };
  for (const err of parsed.errors) {
    logWarn(`fileSystemDriveSource: ${filePath} (line ${err.line}): ${err.message}`);
  }
  const raw = parsed.data as Record<string, unknown>;

  const nameFromFrontmatter = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : undefined;
  const name = nameFromFrontmatter ?? defaultNameFor(filePath, variety);
  if (!name) { return undefined; }

  const description = typeof raw.description === 'string' && raw.description.length > 0
    ? raw.description
    : undefined;

  const tags = splitTags(raw.tags);

  let updatedAt: string | undefined;
  try {
    updatedAt = fs.statSync(filePath).mtime.toISOString();
  } catch { /* ignore — updatedAt stays undefined */ }

  return { name, description, tags, updatedAt, raw };
}

/**
 * Returns the body of the YAML frontmatter block, or `undefined` if
 * the file does not start with one. A valid block is delimited by a
 * literal `---` line at position 0 and another `---` line somewhere
 * below; the content in between (without the delimiters) is returned.
 */
function extractFrontmatterBlock(source: string): string | undefined {
  const lines = source.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== '---') {
    return undefined;
  }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      return lines.slice(1, i).join('\n');
    }
  }
  // No closing `---` → malformed. Treat as no frontmatter rather than
  // swallowing the entire body.
  return undefined;
}

function defaultNameFor(filePath: string, variety: 'prompt' | 'rule' | 'skill'): string {
  if (variety === 'skill') {
    return path.basename(path.dirname(filePath));
  }
  return path.basename(filePath, path.extname(filePath));
}

function splitTags(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string') { return undefined; }
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function toCanonicalRoot(p: string): string {
  const resolved = path.resolve(p);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function isInside(target: string, root: string): boolean {
  const rel = path.relative(root, target);
  // `rel` is '' when target === root; we require *inside*, so target
  // must be a child path (non-empty and not climbing above).
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
