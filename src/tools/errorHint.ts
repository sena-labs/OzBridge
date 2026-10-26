import { OzCliErrorKind } from '../types/index.js';

// Kept free of the `vscode` module so the standalone MCP server bundle
// (packages/oz-mcp-server) can import it. Re-exported from baseTool.ts.

/**
 * Suggests a remediation hint for each {@link OzCliErrorKind}.
 * Intentionally terse so the LLM can act on it.
 */
export function errorHint(kind: OzCliErrorKind): string | undefined {
  switch (kind) {
    case OzCliErrorKind.NOT_FOUND:
      return 'Install Warp from https://www.warp.dev/download and ensure `oz` is in PATH.';
    case OzCliErrorKind.NOT_AUTHENTICATED:
      return 'Run `oz login` in a terminal to authenticate with Warp.';
    case OzCliErrorKind.INSUFFICIENT_CREDITS:
      return 'Warp account is out of credits or quota. Top up at https://app.warp.dev/settings/billing then retry.';
    case OzCliErrorKind.STALLED:
      return 'The Oz CLI produced no output for the idle window. Check Warp credits, network, and whether the Warp desktop app is waiting on an interactive prompt outside VS Code.';
    case OzCliErrorKind.TIMEOUT:
      return 'Increase `ozBridge.timeoutMs` or `ozBridge.cloudPollingTimeoutMs` in settings. Also check whether the Warp account has credits left — a depleted account can cause the CLI to hang until the timeout fires.';
    case OzCliErrorKind.CANCELLED:
      return 'The operation was cancelled by the user.';
    case OzCliErrorKind.PARSE_ERROR:
      return 'The Oz CLI returned unexpected output. Update Warp to the latest version.';
    default:
      return undefined;
  }
}
