/**
 * Contract shared by every implementation of the Warp Drive data source.
 *
 * This module is **dependency-free** on purpose: it defines only the
 * shape of the data the UI consumes (see
 * `src/ui/driveTreeProvider.ts`) and the `IWarpDriveSource` abstraction
 * that both the CLI-backed and the filesystem-backed implementations
 * honour.
 *
 * Keeping the contract in a single file makes it trivial for the
 * factory (`driveSourceFactory.ts`) to pick a concrete implementation
 * at activation time based on a capability probe.
 */
/**
 * Top-level category a drive entry belongs to. Drives the grouping in
 * the sidebar tree and the right-click context menus.
 */
export type DriveCategory = 'prompt' | 'rule' | 'skill';

/**
 * Fields every drive entry carries, regardless of category. Concrete
 * subtypes add category-specific metadata.
 *
 * - `id` must be stable across reloads so tree selection survives a
 *   refresh. For CLI-sourced entries use the Warp resource id; for
 *   filesystem-sourced entries use the absolute file path.
 * - `source` identifies the backend that produced the entry, which
 *   surfaces in the tooltip and makes it easier to debug mixed
 *   CLI + filesystem fallbacks.
 */
export interface DriveBase {
  readonly id: string;
  readonly category: DriveCategory;
  readonly name: string;
  readonly description?: string;
  readonly tags?: ReadonlyArray<string>;
  readonly source: 'cli' | 'filesystem';
  readonly updatedAt?: string;
}

/** A saved prompt from the Warp Drive. */
export interface DrivePrompt extends DriveBase {
  readonly category: 'prompt';
}

/** A shared rule from the Warp Drive rules library. */
export interface DriveRule extends DriveBase {
  readonly category: 'rule';
  /** Optional scope (`global` / `project`) reported by the backend. */
  readonly scope?: 'global' | 'project';
}

/** An organisation-wide skill definition (`SKILL.md`). */
export interface DriveSkill extends DriveBase {
  readonly category: 'skill';
  /** Optional model hint declared in the skill frontmatter. */
  readonly model?: string;
}

/** Union covering every possible leaf of the drive tree. */
export type DriveEntry = DrivePrompt | DriveRule | DriveSkill;

/**
 * Backend abstraction used by the UI layer. Both the Oz CLI and the
 * filesystem implementations expose exactly this surface so the sidebar
 * never needs to care which one is active.
 *
 * Every method is asynchronous even when the underlying source is
 * synchronous: a future remote implementation (HTTP to a Warp API)
 * would benefit from the uniform return shape.
 */
export interface IWarpDriveSource {
  /** Human-readable name for diagnostics (e.g. `'oz-cli'`, `'filesystem'`). */
  readonly label: string;

  /** Lists every saved Drive prompt the user has access to. */
  listPrompts(): Promise<DrivePrompt[]>;

  /** Lists every shared rule the user has access to. */
  listRules(): Promise<DriveRule[]>;

  /** Lists every shared skill definition the user has access to. */
  listSkills(): Promise<DriveSkill[]>;

  /**
   * Reads the raw markdown body of a drive entry by id. Implementations
   * should throw a descriptive `Error` when the id is unknown or
   * unreadable — the UI layer catches and surfaces the message.
   */
  read(id: string): Promise<string>;
}

// ===========================================================================
// Runtime type guards
// ===========================================================================
//
// These guards are the single validation boundary between "untrusted JSON
// coming from the Oz CLI or a YAML frontmatter block on disk" and the typed
// `DriveEntry` objects consumed by the UI. Keeping them here — next to the
// types themselves — guarantees that every future call site goes through
// exactly the same checks.

/**
 * Narrow check for the shared `DriveBase` fields. Used by every
 * category-specific guard.
 */
function isDriveBaseLike(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) { return false; }
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' && v.id.length > 0 &&
    typeof v.name === 'string' && v.name.length > 0 &&
    (v.description === undefined || typeof v.description === 'string') &&
    (v.tags === undefined || (Array.isArray(v.tags) && v.tags.every((t) => typeof t === 'string'))) &&
    (v.source === 'cli' || v.source === 'filesystem') &&
    (v.updatedAt === undefined || typeof v.updatedAt === 'string')
  );
}

export function isDrivePrompt(value: unknown): value is DrivePrompt {
  return isDriveBaseLike(value) && value.category === 'prompt';
}

export function isDriveRule(value: unknown): value is DriveRule {
  if (!isDriveBaseLike(value) || value.category !== 'rule') { return false; }
  const scope = value.scope;
  return scope === undefined || scope === 'global' || scope === 'project';
}

export function isDriveSkill(value: unknown): value is DriveSkill {
  if (!isDriveBaseLike(value) || value.category !== 'skill') { return false; }
  return value.model === undefined || typeof value.model === 'string';
}

export function isDriveEntry(value: unknown): value is DriveEntry {
  return isDrivePrompt(value) || isDriveRule(value) || isDriveSkill(value);
}

// ===========================================================================
// Parsers
// ===========================================================================

/**
 * Parses a single JSON object emitted by `oz drive list` (or a similar
 * endpoint) into a strongly-typed {@link DriveEntry}.
 *
 * The function is defensive: any field that fails a type guard is
 * dropped and the function returns `undefined` so the caller can log /
 * skip without propagating invalid data. Returning a `{ entry, error }`
 * discriminant would be heavier for the trivial success case, so the
 * function keeps the lightweight `DriveEntry | undefined` signature and
 * exposes {@link parseDriveEntryStrict} for callers that need the
 * reason.
 */
export function parseDriveEntry(raw: unknown, defaultSource: 'cli' | 'filesystem' = 'cli'): DriveEntry | undefined {
  if (typeof raw !== 'object' || raw === null) { return undefined; }
  const obj = raw as Record<string, unknown>;

  // Normalise the `source` field — upstream producers may omit it.
  const normalised: Record<string, unknown> = { ...obj };
  if (normalised.source !== 'cli' && normalised.source !== 'filesystem') {
    normalised.source = defaultSource;
  }
  // Accept the category as-is or infer from a `kind` alias if present.
  if (typeof normalised.category !== 'string' && typeof normalised.kind === 'string') {
    normalised.category = normalised.kind;
  }

  if (isDrivePrompt(normalised)) { return normalised; }
  if (isDriveRule(normalised)) { return normalised; }
  if (isDriveSkill(normalised)) { return normalised; }
  return undefined;
}

export interface ParseDriveEntryError {
  readonly reason: string;
}

/**
 * Strict version of {@link parseDriveEntry} that returns a tagged
 * `{ entry }` or `{ error }` pair. Preferred by the CLI source so the
 * operator can see in the logs *why* an entry was dropped.
 */
export function parseDriveEntryStrict(
  raw: unknown,
  defaultSource: 'cli' | 'filesystem' = 'cli',
): { entry: DriveEntry } | { error: ParseDriveEntryError } {
  const entry = parseDriveEntry(raw, defaultSource);
  if (entry) { return { entry }; }
  if (typeof raw !== 'object' || raw === null) {
    return { error: { reason: `not an object: ${typeof raw}` } };
  }
  const category = (raw as Record<string, unknown>).category
    ?? (raw as Record<string, unknown>).kind;
  if (typeof category !== 'string') {
    return { error: { reason: 'missing `category` / `kind`' } };
  }
  if (category !== 'prompt' && category !== 'rule' && category !== 'skill') {
    return { error: { reason: `unknown category: ${category}` } };
  }
  return { error: { reason: `invalid fields for category ${category}` } };
}
