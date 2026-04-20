/**
 * Mock completo del modulo 'vscode' per unit testing.
 * Usato come alias in vitest.config.ts.
 */
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// EventEmitter
// ---------------------------------------------------------------------------
export class EventEmitter<T = unknown> {
  private _listeners: Array<(e: T) => void> = [];

  event = (listener: (e: T) => void) => {
    this._listeners.push(listener);
    return { dispose: () => { this._listeners = this._listeners.filter(l => l !== listener); } };
  };

  fire(data: T) {
    for (const l of this._listeners) { l(data); }
  }

  dispose() {
    this._listeners = [];
  }
}

// ---------------------------------------------------------------------------
// Uri
// ---------------------------------------------------------------------------
export class Uri {
  readonly scheme: string;
  readonly fsPath: string;
  readonly path: string;

  private constructor(scheme: string, fsPath: string) {
    this.scheme = scheme;
    this.fsPath = fsPath;
    this.path = fsPath;
  }

  static parse(value: string): Uri { return new Uri('https', value); }
  static file(p: string): Uri { return new Uri('file', p); }
  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(base.scheme, [base.fsPath, ...segments].join('/'));
  }

  toString() { return this.fsPath; }
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

// ---------------------------------------------------------------------------
// CancellationTokenSource
// ---------------------------------------------------------------------------
export class CancellationTokenSource {
  private _listeners: Array<() => void> = [];

  token = {
    isCancellationRequested: false,
    onCancellationRequested: (listener: () => void) => {
      this._listeners.push(listener);
      return { dispose: vi.fn() };
    },
  };

  cancel() {
    this.token.isCancellationRequested = true;
    for (const l of this._listeners) { l(); }
  }

  dispose() { this._listeners = []; }
}

// ---------------------------------------------------------------------------
// workspace
// ---------------------------------------------------------------------------
export class RelativePattern {
  constructor(
    public readonly base: string | { uri: Uri },
    public readonly pattern: string,
  ) {}
}

export const workspace = {
  getConfiguration: vi.fn((_section?: string) => ({
    get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
  })),
  openTextDocument: vi.fn((_arg: unknown) => Promise.resolve({ uri: Uri.file('/tmp/mock'), getText: vi.fn(() => '') })),
  onDidChangeConfiguration: vi.fn((_cb?: any) => ({ dispose: vi.fn() })),
  workspaceFolders: undefined as Array<{ uri: Uri; name: string; index: number }> | undefined,
  fs: {
    stat: vi.fn(),
    createDirectory: vi.fn(),
    writeFile: vi.fn(),
  },
  createFileSystemWatcher: vi.fn((_glob: unknown, _ignoreCreate?: boolean, _ignoreChange?: boolean, _ignoreDelete?: boolean) => {
    const makeListener = () => {
      const listeners: Array<() => void> = [];
      const emitter = (cb: () => void) => {
        listeners.push(cb);
        return { dispose: vi.fn(() => { const i = listeners.indexOf(cb); if (i >= 0) { listeners.splice(i, 1); } }) };
      };
      (emitter as any).fire = () => { for (const l of listeners) { l(); } };
      return emitter;
    };
    const onDidCreate = makeListener();
    const onDidChange = makeListener();
    const onDidDelete = makeListener();
    return {
      onDidCreate,
      onDidChange,
      onDidDelete,
      dispose: vi.fn(),
      // Test-only helpers to trigger events.
      _fireCreate: () => (onDidCreate as any).fire(),
      _fireChange: () => (onDidChange as any).fire(),
      _fireDelete: () => (onDidDelete as any).fire(),
    };
  }),
};

// ---------------------------------------------------------------------------
// StatusBar / ThemeColor / ThemeIcon / TreeItem
// ---------------------------------------------------------------------------
export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export class ThemeColor {
  constructor(public readonly id: string) {}
}

export class ThemeIcon {
  constructor(public readonly id: string, public readonly color?: ThemeColor) {}
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class TreeItem {
  label: string | { label: string };
  id?: string;
  iconPath?: ThemeIcon | Uri | { light: Uri; dark: Uri };
  description?: string | boolean;
  tooltip?: string | MarkdownString;
  contextValue?: string;
  command?: { command: string; title: string; arguments?: unknown[] };
  collapsibleState?: TreeItemCollapsibleState;
  constructor(label: string | { label: string }, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

interface MockStatusBarItem {
  alignment: StatusBarAlignment;
  priority?: number;
  text: string;
  tooltip?: string | MarkdownString;
  command?: string | { command: string; title: string };
  backgroundColor?: ThemeColor;
  color?: string | ThemeColor;
  name?: string;
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

const statusBarItems: MockStatusBarItem[] = [];

// ---------------------------------------------------------------------------
// window
// ---------------------------------------------------------------------------
export const window = {
  activeTextEditor: undefined as any,
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  })),
  showWarningMessage: vi.fn((..._args: unknown[]) => Promise.resolve(undefined)),
  showInformationMessage: vi.fn((..._args: unknown[]) => Promise.resolve(undefined)),
  showErrorMessage: vi.fn((..._args: unknown[]) => Promise.resolve(undefined)),
  showInputBox: vi.fn((_options?: unknown) => Promise.resolve(undefined as string | undefined)),
  showQuickPick: vi.fn((_items: unknown, _options?: unknown) => Promise.resolve(undefined as any)),
  showTextDocument: vi.fn((_doc: unknown) => Promise.resolve({ selection: undefined, edit: vi.fn() })),
  showOpenDialog: vi.fn((_options?: unknown) => Promise.resolve(undefined as unknown as Uri[] | undefined)),
  createStatusBarItem: vi.fn((alignment?: StatusBarAlignment, priority?: number): MockStatusBarItem => {
    const item: MockStatusBarItem = {
      alignment: alignment ?? StatusBarAlignment.Right,
      priority,
      text: '',
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(() => {
        const i = statusBarItems.indexOf(item);
        if (i >= 0) { statusBarItems.splice(i, 1); }
      }),
    };
    statusBarItems.push(item);
    return item;
  }),
  registerTreeDataProvider: vi.fn((_viewId: string, _provider: unknown) => ({ dispose: vi.fn() })),
  createTreeView: vi.fn((_viewId: string, _options: unknown) => ({
    dispose: vi.fn(),
    reveal: vi.fn(),
    onDidChangeSelection: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
    visible: false,
    selection: [] as unknown[],
  })),
  createWebviewPanel: vi.fn((_viewType: string, _title: string, _column: unknown, _options?: unknown) => {
    const messageEmitter = new EventEmitter<unknown>();
    const disposeEmitter = new EventEmitter<void>();
    const panel = {
      webview: {
        cspSource: 'vscode-webview://mock',
        html: '',
        onDidReceiveMessage: messageEmitter.event,
        postMessage: vi.fn(),
        _fireMessage: (m: unknown) => messageEmitter.fire(m),
      },
      reveal: vi.fn(),
      onDidDispose: disposeEmitter.event,
      dispose: vi.fn(() => { disposeEmitter.fire(); }),
      _disposeEmitter: disposeEmitter,
    };
    return panel;
  }),
  /** Test-only: access the mock status bar items created so far. */
  _statusBarItems: statusBarItems,
};

export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
  Two = 2,
  Three = 3,
}

// ---------------------------------------------------------------------------
// languages
// ---------------------------------------------------------------------------
export const languages = {
  getDiagnostics: vi.fn((): any[] => []),
};

// ---------------------------------------------------------------------------
// chat
// ---------------------------------------------------------------------------
export const chat = {
  createChatParticipant: vi.fn((_id: string, _handler: unknown) => ({
    iconPath: undefined as unknown,
    followupProvider: undefined as unknown,
    dispose: vi.fn(),
  })),
};

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------
const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();

export const commands = {
  registerCommand: vi.fn((command: string, callback: (...args: unknown[]) => unknown) => {
    registeredCommands.set(command, callback);
    return {
      dispose: vi.fn(() => { registeredCommands.delete(command); }),
    };
  }),
  executeCommand: vi.fn((command: string, ...args: unknown[]) => {
    const handler = registeredCommands.get(command);
    if (handler) {
      return Promise.resolve(handler(...args));
    }
    return Promise.resolve(undefined);
  }),
  /** Test-only: introspection into currently registered commands. */
  _getCommand: (name: string) => registeredCommands.get(name),
  _listCommands: () => Array.from(registeredCommands.keys()),
  _resetCommands: () => { registeredCommands.clear(); },
};

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------
export const env = {
  language: 'en',
  openExternal: vi.fn(() => Promise.resolve(true)),
  clipboard: {
    writeText: vi.fn((_text: string) => Promise.resolve()),
    readText: vi.fn(() => Promise.resolve('')),
  },
};

// ---------------------------------------------------------------------------
// Disposable
// ---------------------------------------------------------------------------
export class Disposable {
  constructor(private readonly callOnDispose: () => void) {}
  dispose() { this.callOnDispose(); }
}

// ---------------------------------------------------------------------------
// MarkdownString
// ---------------------------------------------------------------------------
export class MarkdownString {
  value: string;
  isTrusted?: boolean;
  supportThemeIcons?: boolean;
  supportHtml?: boolean;

  constructor(value = '', supportThemeIcons?: boolean) {
    this.value = value;
    this.supportThemeIcons = supportThemeIcons;
  }

  appendText(value: string): MarkdownString {
    this.value += value;
    return this;
  }

  appendMarkdown(value: string): MarkdownString {
    this.value += value;
    return this;
  }

  appendCodeblock(value: string, language = ''): MarkdownString {
    this.value += '\n```' + language + '\n' + value + '\n```\n';
    return this;
  }
}

// ---------------------------------------------------------------------------
// Language Model Tool primitives
// ---------------------------------------------------------------------------
export class LanguageModelTextPart {
  constructor(public readonly value: string) {}
}

export class LanguageModelPromptTsxPart {
  constructor(public readonly value: unknown) {}
}

export class LanguageModelToolResult {
  constructor(public readonly content: Array<LanguageModelTextPart | LanguageModelPromptTsxPart>) {}
}

/**
 * In-memory registry of tools registered via `lm.registerTool`.
 * Exposed so tests can grab a specific tool by name and invoke it directly.
 */
const registeredTools = new Map<string, unknown>();

export const lm = {
  registerTool: vi.fn((name: string, tool: unknown) => {
    registeredTools.set(name, tool);
    return {
      dispose: vi.fn(() => {
        registeredTools.delete(name);
      }),
    };
  }),
  tools: [] as Array<{ name: string }>,
  invokeTool: vi.fn((_name: string, _options: unknown, _token?: unknown) =>
    Promise.resolve(new LanguageModelToolResult([])),
  ),
  /** Test-only helpers — not part of the real VS Code API. */
  _getTool: (name: string) => registeredTools.get(name),
  _reset: () => { registeredTools.clear(); },
};

// ---------------------------------------------------------------------------
// l10n
// ---------------------------------------------------------------------------
/**
 * Mock for `vscode.l10n`. Mirrors the runtime contract enough for unit tests:
 * `t(message, ...args)` interpolates `{0}`, `{1}` placeholders into the
 * source string. Falls back to identity when no args are passed.
 */
type L10nObjectArg = { message: string; args?: unknown[]; comment?: string | string[] };
function interpolate(template: string, args: unknown[]): string {
  if (args.length === 0) { return template; }
  return template.replace(/\{(\d+)\}/g, (_, idx) => {
    const v = args[Number(idx)];
    return v === undefined ? '' : String(v);
  });
}
export const l10n = {
  t: vi.fn((message: string | L10nObjectArg, ...args: unknown[]): string => {
    if (typeof message === 'string') { return interpolate(message, args); }
    return interpolate(message.message, message.args ?? []);
  }),
  bundle: undefined as Record<string, string> | undefined,
  uri: undefined as Uri | undefined,
};
