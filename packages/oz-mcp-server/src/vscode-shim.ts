/**
 * Minimal shim for the 'vscode' module.
 *
 * OzCliService, ConfigManager, WorkspaceConfigResolver and the copilot-chat-toolkit
 * logger all import `vscode`, but only use a handful of surface-area items.
 * This shim satisfies those imports so the standalone MCP server can be bundled
 * without the VS Code extension host.
 */

// ── Disposable ────────────────────────────────────────────────────────────────

export interface Disposable {
  dispose(): void;
}

// ── Event / EventEmitter ──────────────────────────────────────────────────────

export type Event<T> = (
  listener: (e: T) => void,
  thisArgs?: unknown,
  disposables?: Disposable[],
) => Disposable;

export class EventEmitter<T> {
  private _listeners: Array<(e: T) => void> = [];

  readonly event: Event<T> = (listener) => {
    this._listeners.push(listener);
    return {
      dispose: () => {
        this._listeners = this._listeners.filter((l) => l !== listener);
      },
    };
  };

  fire(data: T): void {
    for (const l of this._listeners.slice()) {
      l(data);
    }
  }

  dispose(): void {
    this._listeners = [];
  }
}

// ── CancellationToken ─────────────────────────────────────────────────────────

export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  readonly onCancellationRequested: Event<void>;
}

const _noop = () => ({ dispose: () => {} });

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CancellationToken {
  export const None: CancellationToken = {
    isCancellationRequested: false,
    onCancellationRequested: _noop,
  };
  export const Cancelled: CancellationToken = {
    isCancellationRequested: true,
    onCancellationRequested: _noop,
  };
}

// ── OutputChannel ─────────────────────────────────────────────────────────────

export interface OutputChannel {
  appendLine(value: string): void;
  dispose(): void;
}

// ── WorkspaceConfiguration ────────────────────────────────────────────────────

export interface WorkspaceConfiguration {
  get<T>(section: string): T | undefined;
  get<T>(section: string, defaultValue: T): T;
}

// ── RelativePattern ───────────────────────────────────────────────────────────

export class RelativePattern {
  constructor(
    public readonly base: string,
    public readonly pattern: string,
  ) {}
}

// ── workspace ─────────────────────────────────────────────────────────────────

export const workspace = {
  getConfiguration(_section?: string): WorkspaceConfiguration {
    return {
      get: (_key: string, def?: unknown) => def as never,
    };
  },

  workspaceFolders: undefined as undefined,

  createFileSystemWatcher(
    _pattern: unknown,
    _ignoreCreate?: boolean,
    _ignoreChange?: boolean,
    _ignoreDelete?: boolean,
  ) {
    return {
      onDidCreate: _noop,
      onDidChange: _noop,
      onDidDelete: _noop,
      dispose: () => {},
    };
  },
};

// ── Uri ───────────────────────────────────────────────────────────────────────

export const Uri = {
  file: (p: string) => ({ fsPath: p, toString: () => `file://${p}` }),
};

// ── window (stub — not used in standalone MCP path) ──────────────────────────

export const window = {
  activeTextEditor: undefined as undefined,
  showErrorMessage: (_msg: string) => Promise.resolve(undefined),
  showWarningMessage: (_msg: string) => Promise.resolve(undefined),
  showInformationMessage: (_msg: string) => Promise.resolve(undefined),
};

// ── languages (stub) ─────────────────────────────────────────────────────────

export const languages = {
  getDiagnostics: (_uri?: unknown) => [] as unknown[],
};

// ── DiagnosticSeverity (stub) ─────────────────────────────────────────────────

export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
} as const;

// ── chat (stub) ───────────────────────────────────────────────────────────────

export const chat = {
  createChatParticipant: (_id: string, _handler: unknown) => ({
    dispose: () => {},
    onDidReceiveFeedback: _noop,
  }),
};
