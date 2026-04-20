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
export const workspace = {
  getConfiguration: vi.fn((_section?: string) => ({
    get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
  })),
  onDidChangeConfiguration: vi.fn((_cb?: any) => ({ dispose: vi.fn() })),
  workspaceFolders: undefined as Array<{ uri: Uri; name: string; index: number }> | undefined,
  fs: {
    stat: vi.fn(),
    createDirectory: vi.fn(),
    writeFile: vi.fn(),
  },
};

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
};

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
export const commands = {
  registerCommand: vi.fn((_command: string, _callback: (...args: any[]) => any) => ({
    dispose: vi.fn(),
  })),
};

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------
export const env = {
  language: 'en',
  openExternal: vi.fn(() => Promise.resolve(true)),
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
