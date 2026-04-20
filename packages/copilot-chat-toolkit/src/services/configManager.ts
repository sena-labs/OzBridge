import * as vscode from 'vscode';
import { IConfigManager } from '../types.js';

/**
 * Generic VS Code settings manager with caching and change events.
 *
 * Reads settings from a named configuration section, caches them,
 * and fires {@link onConfigChanged} when the section changes.
 *
 * @typeParam C - Shape of the configuration object.
 */
export class BaseConfigManager<C extends object> implements IConfigManager<C> {
  private cachedConfig: C | null = null;
  private readonly emitter = new vscode.EventEmitter<C>();
  private readonly disposable: vscode.Disposable;

  public readonly onConfigChanged: vscode.Event<C> = this.emitter.event;

  /**
   * @param sectionName - VS Code configuration section (e.g. `'myExtension'`).
   * @param defaults - Default values for every property.
   */
  constructor(
    protected readonly sectionName: string,
    protected readonly defaults: C,
  ) {
    this.disposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(this.sectionName)) {
        this.invalidate();
        this.fireChange();
      }
    });
  }

  getConfig(): C {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }
    const cfg = vscode.workspace.getConfiguration(this.sectionName);
    this.cachedConfig = this.readConfig(cfg);
    return this.cachedConfig;
  }

  /**
   * Override to customize how properties are read from the workspace config.
   * Default implementation iterates over the keys of {@link defaults}.
   */
  protected readConfig(cfg: vscode.WorkspaceConfiguration): C {
    const result = {} as Record<string, unknown>;
    for (const key of Object.keys(this.defaults as object)) {
      result[key] = cfg.get(key, (this.defaults as Record<string, unknown>)[key]);
    }
    return result as C;
  }

  /**
   * Discards the cached snapshot so the next {@link getConfig} call
   * recomputes it from scratch. Subclasses call this when an external
   * input (e.g. a watched workspace YAML) changes and settings must be
   * re-read.
   */
  protected invalidate(): void {
    this.cachedConfig = null;
  }

  /**
   * Emits `onConfigChanged` with the freshly-computed snapshot. Used in
   * tandem with {@link invalidate} whenever an external change happens
   * outside the VS Code settings subscription.
   */
  protected fireChange(): void {
    this.emitter.fire(this.getConfig());
  }

  dispose(): void {
    this.disposable.dispose();
    this.emitter.dispose();
  }
}
