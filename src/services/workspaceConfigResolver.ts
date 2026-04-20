import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WarpBridgeConfig } from '../types/index.js';
import { logInfo, logWarn } from './logger.js';
import { parseFlatYaml, YamlScalar } from './yamlParser.js';

/**
 * Allowed keys in `.warp/warp-bridge.yaml`. Matches a subset of
 * {@link WarpBridgeConfig} that makes sense to commit into a repo:
 * shared defaults and MCP surface toggles.
 *
 * Excluded on purpose:
 * - `ozPath` — platform-specific, belongs in user settings.
 * - `mcpBearerToken` — secret, must never be committed; if you need to
 *   share it across machines, source it via an env variable read by your
 *   shell and feed it into VS Code settings directly.
 */
export const ALLOWED_OVERRIDE_KEYS = new Set<keyof WarpBridgeConfig>([
  'defaultModel',
  'defaultProfile',
  'defaultEnvironment',
  'timeoutMs',
  'idleTimeoutMs',
  'maxOutputChars',
  'cloudPollingIntervalMs',
  'cloudPollingTimeoutMs',
  'mcpEnabled',
  'mcpPort',
  'mcpBindAddress',
]);

/** Relative path of the YAML file inside a workspace folder. */
export const WORKSPACE_CONFIG_PATH = path.join('.warp', 'warp-bridge.yaml');

/**
 * Validates a raw YAML value against the expected type of a
 * {@link WarpBridgeConfig} key and either returns it coerced or logs a
 * warning and returns `undefined` so the key is skipped.
 */
function coerce(key: keyof WarpBridgeConfig, value: YamlScalar): unknown | undefined {
  switch (key) {
    case 'defaultModel':
    case 'defaultProfile':
    case 'defaultEnvironment':
    case 'mcpBindAddress':
      if (typeof value === 'string') { return value; }
      break;
    case 'timeoutMs':
    case 'idleTimeoutMs':
    case 'maxOutputChars':
    case 'cloudPollingIntervalMs':
    case 'cloudPollingTimeoutMs':
    case 'mcpPort':
      if (typeof value === 'number' && Number.isFinite(value)) { return value; }
      break;
    case 'mcpEnabled':
      if (typeof value === 'boolean') { return value; }
      break;
  }
  logWarn(`workspace config: ignoring \`${key}\`: got ${typeof value}, expected ${expectedKind(key)}`);
  return undefined;
}

function expectedKind(key: keyof WarpBridgeConfig): string {
  switch (key) {
    case 'mcpEnabled': return 'boolean';
    case 'timeoutMs':
    case 'idleTimeoutMs':
    case 'maxOutputChars':
    case 'cloudPollingIntervalMs':
    case 'cloudPollingTimeoutMs':
    case 'mcpPort':
      return 'number';
    default:
      return 'string';
  }
}

/**
 * Watches `<workspaceFolder>/.warp/warp-bridge.yaml` and exposes the
 * parsed overrides to the extension. Unknown keys and keys with the
 * wrong type are skipped with a warning so a typo never hard-breaks the
 * extension.
 *
 * The resolver is safe to instantiate with no workspace open — in that
 * case `getOverrides()` just returns `{}` and `onDidChange` never fires.
 */
export class WorkspaceConfigResolver implements vscode.Disposable {
  private overrides: Partial<WarpBridgeConfig> = {};
  private readonly watcher: vscode.FileSystemWatcher | undefined;
  private readonly emitter = new vscode.EventEmitter<Partial<WarpBridgeConfig>>();
  private readonly disposables: vscode.Disposable[] = [];
  private disposed = false;

  /** Fires with the new override snapshot whenever the YAML file changes. */
  readonly onDidChange: vscode.Event<Partial<WarpBridgeConfig>> = this.emitter.event;

  constructor(private readonly workspaceRoot: string | undefined) {
    if (!workspaceRoot) { return; }
    // Initial read (synchronous so ConfigManager's first `getConfig()`
    // already reflects overrides).
    this.reload();

    if (typeof vscode.workspace.createFileSystemWatcher === 'function') {
      this.watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceRoot, WORKSPACE_CONFIG_PATH),
        false,
        false,
        false,
      );
      this.disposables.push(
        this.watcher.onDidCreate(() => this.reloadAndEmit()),
        this.watcher.onDidChange(() => this.reloadAndEmit()),
        this.watcher.onDidDelete(() => this.reloadAndEmit()),
        this.watcher,
      );
    }
  }

  /** Snapshot of the last-read overrides. Empty when no file is present. */
  getOverrides(): Partial<WarpBridgeConfig> {
    return { ...this.overrides };
  }

  /** Re-reads the file without emitting. Exposed for tests & manual refresh. */
  refresh(): Partial<WarpBridgeConfig> {
    this.reload();
    return this.getOverrides();
  }

  dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true;
    for (const d of this.disposables) {
      try { d.dispose(); } catch { /* ignore */ }
    }
    this.emitter.dispose();
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private reloadAndEmit(): void {
    if (this.disposed) { return; }
    this.reload();
    this.emitter.fire(this.getOverrides());
  }

  private reload(): void {
    this.overrides = {};
    if (!this.workspaceRoot) { return; }
    const filePath = path.join(this.workspaceRoot, WORKSPACE_CONFIG_PATH);
    let source: string;
    try {
      source = fs.readFileSync(filePath, 'utf8');
    } catch {
      // File missing or unreadable — silently fall back to empty overrides.
      return;
    }
    const result = parseFlatYaml(source);
    for (const err of result.errors) {
      logWarn(`workspace config parse error (line ${err.line}): ${err.message}`);
    }
    const overrides: Partial<WarpBridgeConfig> = {};
    for (const [key, value] of Object.entries(result.data)) {
      if (!ALLOWED_OVERRIDE_KEYS.has(key as keyof WarpBridgeConfig)) {
        logWarn(`workspace config: ignoring unknown key \`${key}\``);
        continue;
      }
      const coerced = coerce(key as keyof WarpBridgeConfig, value);
      if (coerced !== undefined) {
        (overrides as Record<string, unknown>)[key] = coerced;
      }
    }
    this.overrides = overrides;
    const count = Object.keys(overrides).length;
    if (count > 0) {
      logInfo(`Loaded ${count} workspace config override${count === 1 ? '' : 's'} from ${WORKSPACE_CONFIG_PATH}`);
    }
  }
}

/**
 * Helper that picks the first workspace folder's fsPath, or undefined when
 * VS Code is running without a workspace (e.g. single-file mode).
 */
export function firstWorkspaceFolderPath(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}
