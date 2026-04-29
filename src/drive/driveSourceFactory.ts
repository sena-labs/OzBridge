import {
  DrivePrompt,
  DriveRule,
  DriveSkill,
  IDriveSource,
} from './warpDriveSource.js';
import {
  CliDriveNotAvailableError,
  CliDriveRunner,
  CliDriveSource,
} from './cliDriveSource.js';
import {
  FileSystemDriveOptions,
  FileSystemDriveSource,
} from './fileSystemDriveSource.js';
import { logInfo, logWarn } from '../services/logger.js';

/**
 * Options for {@link createOzBridgeDriveSource}. All fields are optional so
 * the factory can safely run at activation time even with no workspace
 * and no Oz CLI runner available.
 */
export interface CreateOzBridgeDriveSourceOptions {
  /**
   * Runner used to reach the Oz CLI `drive` subcommand. Omit it to skip
   * the CLI source altogether and rely solely on the filesystem
   * fallback. Present only once the Oz CLI exposes drive endpoints —
   * until then `extension.ts` calls the factory without a runner.
   */
  runner?: CliDriveRunner;

  /**
   * Overrides for the filesystem source. Useful from tests (temp
   * directories) and potentially from the factory itself if we ever
   * support per-workspace `.warp/drive/` directories.
   */
  filesystem?: FileSystemDriveOptions;
}

/**
 * `IDriveSource` that tries a primary backend first and transparently
 * falls back to a secondary backend **only** when the primary reports
 * that the drive feature is unavailable
 * ({@link CliDriveNotAvailableError}).
 *
 * Any other error from the primary is propagated unchanged — callers
 * still see authentication or network failures rather than having them
 * masked by the fallback.
 */
export class CompositeDriveSource implements IDriveSource {
  readonly label: string;
  private fallbackWarned = false;

  constructor(
    private readonly primary: IDriveSource,
    private readonly fallback: IDriveSource,
  ) {
    this.label = `${primary.label}+${fallback.label}`;
  }

  listPrompts(): Promise<DrivePrompt[]> {
    return this.tryPrimary((s) => s.listPrompts());
  }
  listRules(): Promise<DriveRule[]> {
    return this.tryPrimary((s) => s.listRules());
  }
  listSkills(): Promise<DriveSkill[]> {
    return this.tryPrimary((s) => s.listSkills());
  }
  read(id: string): Promise<string> {
    return this.tryPrimary((s) => s.read(id));
  }

  private async tryPrimary<T>(op: (s: IDriveSource) => Promise<T>): Promise<T> {
    try {
      return await op(this.primary);
    } catch (err) {
      if (err instanceof CliDriveNotAvailableError) {
        if (!this.fallbackWarned) {
          this.fallbackWarned = true;
          logWarn('Warp Drive CLI unavailable: using filesystem fallback for this session.');
        }
        return op(this.fallback);
      }
      throw err;
    }
  }
}

/**
 * Builds the {@link IDriveSource} the rest of the extension will
 * consume. The returned value is always safe to use from tests and
 * production — no network calls happen inside the factory itself.
 *
 * Behaviour:
 * - With `opts.runner` set: returns a composite that prefers the Oz CLI
 *   source and falls back to the filesystem source on
 *   {@link CliDriveNotAvailableError}. Any other CLI error propagates.
 * - Without `opts.runner`: returns just the filesystem source. This is
 *   the current production configuration, since the Oz CLI has not yet
 *   shipped the `drive` subcommand.
 *
 * The chosen source's label is logged once at activation to make the
 * active configuration obvious in the OzBridge output channel.
 */
export function createOzBridgeDriveSource(opts: CreateOzBridgeDriveSourceOptions = {}): IDriveSource {
  const fs = new FileSystemDriveSource(opts.filesystem);
  if (!opts.runner) {
    logInfo('Warp Drive source: filesystem (Oz CLI drive subcommand unavailable)');
    return fs;
  }
  const cli = new CliDriveSource(opts.runner);
  const composite = new CompositeDriveSource(cli, fs);
  logInfo(`Warp Drive source: ${composite.label}`);
  return composite;
}
