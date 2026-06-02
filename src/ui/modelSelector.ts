import * as vscode from 'vscode';
import { IOzCliService, IConfigManager } from '../types/index.js';
import { fetchModelIds } from '../services/modelCatalog.js';
import { getErrorMessage } from '../utils/error.js';

/** Command id for the model QuickPick. */
export const SELECT_MODEL_COMMAND = 'ozBridge.selectModel';

/**
 * Builds the QuickPick items for the available model ids, marking the
 * currently-active default. Pure — exported for unit tests.
 */
export function buildModelQuickPickItems(
  ids: ReadonlyArray<string>,
  current: string,
): vscode.QuickPickItem[] {
  return ids.map((id) => ({
    label: id,
    description: id === current ? '(current)' : undefined,
  }));
}

/**
 * Registers the `OzBridge: Select Model` command plus a status-bar item that
 * shows the active model and opens the picker on click.
 *
 * The QuickPick fetches the live catalogue (`oz model list`) and writes the
 * chosen id into the user's `ozBridge.defaultModel` setting. When a workspace
 * `.warp/warp-bridge.yaml` overrides `defaultModel`, the effective value would
 * not change, so we surface a warning telling the user where the override
 * lives instead of silently appearing to do nothing.
 *
 * Returned disposables should be pushed into `context.subscriptions`.
 */
export function registerModelSelectorCommands(
  cli: IOzCliService,
  cfgMgr: IConfigManager,
): vscode.Disposable[] {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  status.name = 'OzBridge Model';
  status.command = SELECT_MODEL_COMMAND;

  const renderStatus = (): void => {
    const model = cfgMgr.getConfig().defaultModel || 'auto';
    status.text = `$(sparkle) ${model}`;
    status.tooltip = new vscode.MarkdownString(
      `${vscode.l10n.t('OzBridge model')}: \`${model}\`\n\n${vscode.l10n.t('Click to change.')}`,
    );
    status.accessibilityInformation = {
      label: vscode.l10n.t('OzBridge model: {0}. Click to change.', model),
      role: 'button',
    };
  };
  renderStatus();
  status.show();

  const command = vscode.commands.registerCommand(SELECT_MODEL_COMMAND, async () => {
    let ids: string[];
    try {
      ids = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('OzBridge: fetching models…') },
        () => fetchModelIds(cli),
      );
    } catch (err) {
      await vscode.window.showErrorMessage(
        vscode.l10n.t('OzBridge: could not list models: {0}', getErrorMessage(err)),
      );
      return;
    }
    if (ids.length === 0) {
      await vscode.window.showWarningMessage(vscode.l10n.t('OzBridge: the Oz CLI reported no models.'));
      return;
    }

    const current = cfgMgr.getConfig().defaultModel;
    const picked = await vscode.window.showQuickPick(buildModelQuickPickItems(ids, current), {
      title: vscode.l10n.t('OzBridge · Select default model'),
      placeHolder: vscode.l10n.t('Pick the model OzBridge passes to Oz (auto = let Warp choose)'),
      matchOnDescription: true,
    });
    if (!picked) {
      return;
    }

    try {
      await vscode.workspace
        .getConfiguration('ozBridge')
        .update('defaultModel', picked.label, vscode.ConfigurationTarget.Global);
    } catch (err) {
      await vscode.window.showErrorMessage(
        vscode.l10n.t('OzBridge: failed to save the model: {0}', getErrorMessage(err)),
      );
      return;
    }

    renderStatus();
    const effective = cfgMgr.getConfig().defaultModel;
    if (effective !== picked.label) {
      await vscode.window.showWarningMessage(
        vscode.l10n.t(
          'Saved, but a workspace .warp/warp-bridge.yaml overrides the model to "{0}". Edit that file (or use the MCP tool) to change the effective model.',
          effective,
        ),
      );
    } else {
      await vscode.window.showInformationMessage(
        vscode.l10n.t('OzBridge default model set to {0}.', picked.label),
      );
    }
  });

  const configSub = cfgMgr.onConfigChanged(() => renderStatus());

  return [command, status, configSub];
}
