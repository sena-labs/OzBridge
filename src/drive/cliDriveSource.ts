import { OzCliError, OzCliErrorKind } from '../types/index.js';
import { logWarn } from '../services/logger.js';
import {
  DriveCategory,
  DriveEntry,
  DrivePrompt,
  DriveRule,
  DriveSkill,
  IWarpDriveSource,
  parseDriveEntryStrict,
} from './warpDriveSource.js';

// ===========================================================================
// Wire protocol abstraction
// ===========================================================================
//
// `CliDriveSource` intentionally talks to an abstract {@link CliDriveRunner}
// rather than to `OzCliService` directly. That keeps the source free of
// `child_process` and `vscode` imports, makes it trivial to unit-test with a
// hand-rolled fake, and — once the Oz CLI ships the `drive` subcommand — lets
// us wire a real delegate from `OzCliService` without touching this file.

/**
 * Thin interface the CLI source uses to reach the Oz binary. Each method
 * receives a list of extra CLI arguments (after `oz drive`) and returns the
 * parsed JSON payload (for listings) or the raw markdown body (for reads).
 *
 * Both methods are expected to throw an {@link OzCliError} on failure;
 * implementations should map `exit code 64` / `unknown command` responses to
 * `OzCliErrorKind.NOT_FOUND` so the source can surface a
 * {@link CliDriveNotAvailableError} and let the factory fall back to the
 * filesystem source.
 */
export interface CliDriveRunner {
  /**
   * Invokes `oz drive list <category> --output-format json` (or an
   * equivalent) and returns the parsed JSON payload.
   */
  list(category: DriveCategory): Promise<unknown>;

  /**
   * Invokes `oz drive get <id>` and returns the raw markdown body.
   */
  get(id: string): Promise<string>;
}

/**
 * Error thrown by {@link CliDriveSource} when the Oz CLI does not expose
 * the `drive` subcommand. The factory catches this and falls back to the
 * filesystem source; no other caller should need to distinguish it.
 */
export class CliDriveNotAvailableError extends Error {
  readonly kind = 'CLI_DRIVE_NOT_AVAILABLE' as const;

  constructor(message = 'Oz CLI does not expose the `drive` subcommand; falling back to filesystem source.') {
    super(message);
    this.name = 'CliDriveNotAvailableError';
  }
}

// ===========================================================================
// Implementation
// ===========================================================================

/** Maximum number of entries we render in the sidebar per category. */
const LIST_SOFT_LIMIT = 200;

/**
 * `IWarpDriveSource` implementation backed by the Oz CLI.
 *
 * The source routes every `listX` call through the same `listCategory`
 * helper, which:
 * 1. Invokes the runner with the right category token.
 * 2. Translates `OzCliErrorKind.NOT_FOUND` responses into a
 *    {@link CliDriveNotAvailableError} so the factory can fall back.
 * 3. Feeds every returned row through {@link parseDriveEntryStrict},
 *    logs the ones that are rejected, and keeps only the valid entries.
 * 4. Caps the result at {@link LIST_SOFT_LIMIT} so a runaway upstream
 *    doesn't explode the sidebar.
 */
export class CliDriveSource implements IWarpDriveSource {
  readonly label = 'oz-cli';

  constructor(private readonly runner: CliDriveRunner) {}

  async listPrompts(): Promise<DrivePrompt[]> {
    const entries = await this.listCategory('prompt');
    return entries.filter(isPrompt);
  }

  async listRules(): Promise<DriveRule[]> {
    const entries = await this.listCategory('rule');
    return entries.filter(isRule);
  }

  async listSkills(): Promise<DriveSkill[]> {
    const entries = await this.listCategory('skill');
    return entries.filter(isSkill);
  }

  async read(id: string): Promise<string> {
    const trimmed = id.trim();
    if (!trimmed) {
      throw new Error('CliDriveSource.read: empty id');
    }
    try {
      return await this.runner.get(trimmed);
    } catch (err) {
      if (isNotAvailableError(err)) {
        throw new CliDriveNotAvailableError();
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private async listCategory(category: DriveCategory): Promise<DriveEntry[]> {
    let payload: unknown;
    try {
      payload = await this.runner.list(category);
    } catch (err) {
      if (isNotAvailableError(err)) {
        throw new CliDriveNotAvailableError();
      }
      throw err;
    }

    // Accept the three JSON shapes Oz-style CLIs typically produce:
    //   1. an array of entries                       → [{ … }, …]
    //   2. `{ items: [...] }`                        → listing with meta
    //   3. `{ <category>s: [...] }` (e.g. `prompts`) → category-keyed
    const rows = extractRows(payload, category);
    if (rows.length === 0) {
      return [];
    }
    const accepted: DriveEntry[] = [];
    for (const row of rows.slice(0, LIST_SOFT_LIMIT)) {
      const result = parseDriveEntryStrict(row, 'cli');
      if ('entry' in result) {
        if (result.entry.category === category) {
          accepted.push(result.entry);
        } else {
          logWarn(`cliDriveSource: dropped ${category} entry with mismatched category=${result.entry.category}`);
        }
      } else {
        logWarn(`cliDriveSource: dropped ${category} entry — ${result.error.reason}`);
      }
    }
    if (rows.length > LIST_SOFT_LIMIT) {
      logWarn(`cliDriveSource: truncated ${category} listing to ${LIST_SOFT_LIMIT} of ${rows.length} entries`);
    }
    return accepted;
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

function extractRows(payload: unknown, category: DriveCategory): unknown[] {
  if (Array.isArray(payload)) { return payload; }
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.items)) { return obj.items; }
    const keyed = obj[`${category}s`];
    if (Array.isArray(keyed)) { return keyed; }
  }
  return [];
}

function isNotAvailableError(err: unknown): boolean {
  if (err instanceof OzCliError) {
    // Treat the canonical `NOT_FOUND` (binary missing) *and* CLI_ERROR kinds
    // that carry an "unknown command" stderr as "drive subcommand absent".
    if (err.kind === OzCliErrorKind.NOT_FOUND) { return true; }
    if (err.kind === OzCliErrorKind.CLI_ERROR) {
      const stderr = (err.stderr ?? '').toLowerCase();
      return stderr.includes('unknown command') || stderr.includes('no such subcommand');
    }
  }
  return false;
}

function isPrompt(entry: DriveEntry): entry is DrivePrompt {
  return entry.category === 'prompt';
}
function isRule(entry: DriveEntry): entry is DriveRule {
  return entry.category === 'rule';
}
function isSkill(entry: DriveEntry): entry is DriveSkill {
  return entry.category === 'skill';
}
