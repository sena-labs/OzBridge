import * as vscode from 'vscode';

/**
 * Global-state key set when the Getting Started walkthrough is opened
 * automatically on the user's first activation of Warp Bridge.
 *
 * Once the key is `true` the extension never auto-opens the walkthrough
 * again — users can still launch it manually from **Help → Get Started**.
 */
export const WALKTHROUGH_STATE_KEY = 'warpBridge.walkthrough.shown';

/** Fully qualified walkthrough id contributed in `package.json`. */
export const WALKTHROUGH_ID = 'sena-labs.warp-vsc-bridge#warpBridge.gettingStarted';

export interface GlobalStateLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export interface WalkthroughHostLike {
  executeCommand(command: string, ...args: unknown[]): Thenable<unknown>;
}

export interface MaybeGatedWalkthroughDeps {
  globalState: GlobalStateLike;
  host?: WalkthroughHostLike;
}

/**
 * Opens the Getting Started walkthrough exactly once per install.
 *
 * Returns `true` when the walkthrough was opened, `false` when it was
 * skipped because the gate has already been flipped.
 */
export async function maybeOpenGettingStartedWalkthrough(
  deps: MaybeGatedWalkthroughDeps,
): Promise<boolean> {
  const { globalState, host } = deps;
  if (!globalState || typeof globalState.get !== 'function' || typeof globalState.update !== 'function') {
    return false;
  }
  if (globalState.get<boolean>(WALKTHROUGH_STATE_KEY) === true) {
    return false;
  }
  await globalState.update(WALKTHROUGH_STATE_KEY, true);
  const commands = host ?? vscode.commands;
  try {
    await commands.executeCommand(
      'workbench.action.openWalkthrough',
      WALKTHROUGH_ID,
      false,
    );
  } catch {
    // Swallow: first-run UX must never block activation.
    return false;
  }
  return true;
}
