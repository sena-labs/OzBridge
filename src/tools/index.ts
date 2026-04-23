import * as vscode from 'vscode';
import {
  IOzCliService,
  IConfigManager,
  IContextCollector,
  IRunPoller,
} from '../types/index.js';
import { RunLocalTool } from './runLocalTool.js';
import { RunCloudTool } from './runCloudTool.js';
import { GetRunTool } from './getRunTool.js';
import { ListRunsTool } from './listRunsTool.js';

export { RunLocalTool } from './runLocalTool.js';
export { RunCloudTool } from './runCloudTool.js';
export { GetRunTool } from './getRunTool.js';
export { ListRunsTool } from './listRunsTool.js';
export type { RunLocalInput } from './runLocalTool.js';
export type { RunCloudInput } from './runCloudTool.js';
export type { GetRunInput } from './getRunTool.js';
export type { ListRunsInput } from './listRunsTool.js';

/**
 * Registers the 4 Warp Language Model Tools with VS Code.
 *
 * Each `registerTool` call returns a `vscode.Disposable` that we push into
 * `context.subscriptions`, so the tools are automatically unregistered when
 * the extension deactivates.
 *
 * Tool names MUST match the `contributes.languageModelTools[].name` entries
 * in `package.json`.
 *
 * @param context  Extension context for lifecycle management.
 * @param cli      Oz CLI service (wraps `oz` binary).
 * @param cfgMgr   Configuration manager (lazy-reads `ozBridge.*`).
 * @param ctx      IDE context collector (workspace, file, selection, diagnostics).
 * @param poller   Cloud run poller with exponential backoff.
 */
export function registerWarpTools(
  context: vscode.ExtensionContext,
  cli: IOzCliService,
  cfgMgr: IConfigManager,
  ctx: IContextCollector,
  poller: IRunPoller,
): void {
  context.subscriptions.push(
    vscode.lm.registerTool(RunLocalTool.name, new RunLocalTool(cli, cfgMgr, ctx)),
  );
  context.subscriptions.push(
    vscode.lm.registerTool(RunCloudTool.name, new RunCloudTool(cli, cfgMgr, ctx, poller)),
  );
  context.subscriptions.push(
    vscode.lm.registerTool(GetRunTool.name, new GetRunTool(cli, cfgMgr)),
  );
  context.subscriptions.push(
    vscode.lm.registerTool(ListRunsTool.name, new ListRunsTool(cli)),
  );
}
