import type { IOzCliService } from '../types/index.js';
import type { CliDriveRunner } from './cliDriveSource.js';
import type { DriveCategory } from './warpDriveSource.js';

/**
 * Adapter that exposes the `drive` subcommands of {@link IOzCliService}
 * as a {@link CliDriveRunner}, so the {@link CliDriveSource} can be
 * driven by the real Oz CLI without depending on `child_process` or
 * `vscode` itself.
 *
 * Errors propagated by the underlying service (notably
 * `OzCliError` / `CliErrorKind.NOT_FOUND` and "unknown command" stderr
 * payloads) are passed through unchanged so the existing detection in
 * {@link CliDriveSource.isNotAvailableError} can convert them to the
 * graceful filesystem fallback.
 */
export class OzCliDriveRunner implements CliDriveRunner {
  constructor(private readonly cli: IOzCliService) {}

  list(category: DriveCategory): Promise<unknown> {
    return this.cli.driveList(category);
  }

  get(id: string): Promise<string> {
    return this.cli.driveGet(id);
  }
}
