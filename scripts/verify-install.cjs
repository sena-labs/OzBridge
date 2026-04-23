/* eslint-disable */
/**
 * Verification harness for the installed Warp Bridge VSIX.
 *
 * Loads the bundled `dist/extension.js` with a minimal `vscode` stub that
 * mirrors the surface the extension expects at activation time, then calls
 * `activate(context)` and collects every contribution (commands registered,
 * tree views, status bar items, chat participants, LM tools, handoff).
 *
 * Exit code 0 on success, 1 on any check failure.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const extRoot = process.argv[2];
if (!extRoot) {
  console.error('Usage: node verify-install.cjs <extracted-extension-dir>');
  process.exit(2);
}

const manifestPath = path.join(extRoot, 'extension', 'package.json');
const bundlePath = path.join(extRoot, 'extension', 'dist', 'extension.js');

function log(icon, label, detail) {
  console.log(`${icon} ${label.padEnd(52)} ${detail ?? ''}`);
}

const failures = [];
let asserted = 0;
function assert(cond, label, detail) {
  asserted += 1;
  if (cond) {
    log('  ✓', label, detail ?? '');
  } else {
    log('  ✗', label, detail ?? '');
    failures.push(label);
  }
}

console.log('--- Manifest checks ---');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert(manifest.name === 'oz-bridge', 'name', manifest.name);
assert(manifest.publisher === 'sena-labs', 'publisher', manifest.publisher);
assert(manifest.version === '0.5.0', 'version', manifest.version);
assert(/^[\^~]?1\.96/.test(manifest.engines.vscode), 'engines.vscode', manifest.engines.vscode);
assert(manifest.main === './dist/extension.js', 'main', manifest.main);
assert(Array.isArray(manifest.contributes.chatParticipants), 'chatParticipants declared');
assert(
  manifest.contributes.chatParticipants[0].id === 'oz-bridge.ozbridge',
  'chat participant id', manifest.contributes.chatParticipants[0].id,
);
const slashCommands = (manifest.contributes.chatParticipants[0].commands || []).map((c) => c.name).sort();
const expectedSlash = ['cloud','config','history','init','mcp','models','run','schedule','status'];
assert(
  JSON.stringify(slashCommands) === JSON.stringify(expectedSlash),
  'slash commands', slashCommands.join(','),
);

const tools = (manifest.contributes.languageModelTools || []).map((t) => t.name).sort();
const expectedTools = ['ozbridge_get_run', 'ozbridge_list_runs', 'ozbridge_run_cloud', 'ozbridge_run_local'];
assert(
  JSON.stringify(tools) === JSON.stringify(expectedTools),
  'languageModelTools', tools.join(','),
);

const viewContainer = manifest.contributes.viewsContainers?.activitybar?.[0];
assert(viewContainer?.id === 'ozBridgeSidebar', 'Activity Bar container', viewContainer?.id);
const view = manifest.contributes.views?.ozBridgeSidebar?.[0];
assert(view?.id === 'ozBridge.runsView', 'Sidebar view id', view?.id);

const commandIds = (manifest.contributes.commands || []).map((c) => c.command).sort();
const mustHaveCommands = [
  'ozBridge.handoff',
  'ozBridge.tree.copyId',
  'ozBridge.tree.deleteSchedule',
  'ozBridge.tree.handoff',
  'ozBridge.tree.openInBrowser',
  'ozBridge.tree.pauseSchedule',
  'ozBridge.tree.refresh',
  'ozBridge.tree.showRun',
  'ozBridge.tree.unpauseSchedule',
];
for (const id of mustHaveCommands) {
  assert(commandIds.includes(id), `declares command ${id}`);
}

const props = manifest.contributes.configuration?.properties || {};
for (const key of [
  'ozBridge.ozPath',
  'ozBridge.defaultModel',
  'ozBridge.defaultProfile',
  'ozBridge.defaultEnvironment',
  'ozBridge.timeoutMs',
  'ozBridge.maxOutputChars',
]) {
  assert(Object.prototype.hasOwnProperty.call(props, key), `configuration ${key}`);
}

console.log('\n--- Bundle load + activate() ---');
const bundleSrc = fs.readFileSync(bundlePath, 'utf8');
assert(bundleSrc.length > 10_000, 'bundle size > 10 KB', `${bundleSrc.length}B`);
assert(bundleSrc.includes('oz-bridge.ozbridge'), 'bundle mentions participant id');
assert(bundleSrc.includes('ozBridge.runsView'), 'bundle mentions sidebar view id');
assert(bundleSrc.includes('ozbridge_run_local'), 'bundle mentions ozbridge_run_local');
assert(bundleSrc.includes('warp://action/new_tab'), 'bundle embeds Warp URL scheme');

// ---------------------------------------------------------------------------
// Build a minimal `vscode` stub sufficient for activate() to succeed.
// ---------------------------------------------------------------------------
const registry = {
  commands: new Map(),
  tools: new Map(),
  treeProviders: new Map(),
  participants: [],
  statusBarItems: [],
  externalsOpened: [],
};

class Disposable { constructor(fn) { this._fn = fn; } dispose() { this._fn?.(); } }
class EventEmitter {
  constructor() { this._listeners = []; }
  get event() {
    return (listener) => {
      this._listeners.push(listener);
      return new Disposable(() => {
        this._listeners = this._listeners.filter((l) => l !== listener);
      });
    };
  }
  fire(e) { for (const l of this._listeners) { try { l(e); } catch {} } }
  dispose() { this._listeners = []; }
}
class Uri {
  constructor(scheme, fsPath, raw) {
    this.scheme = scheme;
    this.fsPath = fsPath;
    this.path = fsPath;
    // Preserve the original raw string when `Uri.parse` is used so callers
    // can round-trip query strings via toString().
    this._raw = raw ?? `${scheme}://${fsPath}`;
  }
  static parse(value) {
    const scheme = value.includes(':') ? value.split(':')[0] : 'file';
    return new Uri(scheme, value, value);
  }
  static file(p) { return new Uri('file', p); }
  static joinPath(base, ...segs) { return new Uri(base.scheme, [base.fsPath, ...segs].join('/')); }
  toString() { return this._raw; }
}
class MarkdownString { constructor(v = '') { this.value = String(v); } appendMarkdown(s){ this.value += s; return this; } appendText(s){ this.value += s; return this; } appendCodeblock(s,l=''){ this.value += '\n```'+l+'\n'+s+'\n```\n'; return this; } }
class ThemeColor { constructor(id) { this.id = id; } }
class ThemeIcon { constructor(id) { this.id = id; } }
class TreeItem { constructor(label, state) { this.label = label; this.collapsibleState = state; } }
class LanguageModelTextPart { constructor(v) { this.value = v; } }
class LanguageModelToolResult { constructor(content) { this.content = content; } }

const vscode = {
  Disposable,
  EventEmitter,
  Uri,
  MarkdownString,
  ThemeColor,
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  LanguageModelTextPart,
  LanguageModelToolResult,
  workspace: {
    getConfiguration: (_section) => ({ get: (_k, def) => def }),
    onDidChangeConfiguration: () => new Disposable(),
    workspaceFolders: undefined,
    fs: { stat: () => Promise.reject(new Error('n/a')), createDirectory: () => Promise.resolve(), writeFile: () => Promise.resolve() },
  },
  window: {
    activeTextEditor: undefined,
    createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, dispose: () => {} }),
    showWarningMessage: () => Promise.resolve(undefined),
    showInformationMessage: () => Promise.resolve(undefined),
    showErrorMessage: () => Promise.resolve(undefined),
    showInputBox: () => Promise.resolve(undefined),
    createStatusBarItem: (alignment, priority) => {
      const item = { alignment, priority, text: '', show: () => {}, hide: () => {}, dispose: () => {} };
      registry.statusBarItems.push(item);
      return item;
    },
    registerTreeDataProvider: (id, provider) => {
      registry.treeProviders.set(id, provider);
      return new Disposable();
    },
    createTreeView: (id) => ({ dispose: () => {}, reveal: () => {}, onDidChangeSelection: () => new Disposable(), onDidChangeVisibility: () => new Disposable(), visible: false, selection: [] }),
  },
  languages: { getDiagnostics: () => [] },
  chat: {
    createChatParticipant: (id, handler) => {
      const p = { id, handler, iconPath: undefined, followupProvider: undefined, dispose: () => {} };
      registry.participants.push(p);
      return p;
    },
  },
  commands: {
    registerCommand: (id, cb) => { registry.commands.set(id, cb); return new Disposable(() => registry.commands.delete(id)); },
    executeCommand: (id, ...args) => {
      const cb = registry.commands.get(id);
      return cb ? Promise.resolve(cb(...args)) : Promise.resolve(undefined);
    },
  },
  env: {
    language: 'en',
    openExternal: (uri) => { registry.externalsOpened.push(uri); return Promise.resolve(true); },
    clipboard: { writeText: () => Promise.resolve(), readText: () => Promise.resolve('') },
  },
  lm: {
    registerTool: (name, tool) => { registry.tools.set(name, tool); return new Disposable(() => registry.tools.delete(name)); },
  },
  CancellationTokenSource: class { constructor() { this.token = { isCancellationRequested: false, onCancellationRequested: () => new Disposable() }; } cancel(){ this.token.isCancellationRequested = true; } dispose(){} },
};

// Hook require() so the bundle can `require('vscode')`
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'vscode') return 'vscode';
  return originalResolve.call(this, request, parent, ...rest);
};
const originalLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, ...rest);
};

let extModule;
try {
  extModule = require(bundlePath);
} catch (err) {
  log('  ✗', 'require(dist/extension.js)', err.message);
  process.exit(1);
}
assert(typeof extModule.activate === 'function', 'exports activate');
assert(typeof extModule.deactivate === 'function', 'exports deactivate');

// Invoke activate() with a minimal ExtensionContext. `extensionUri` is
// needed by the Chat Participant's `iconPath` resolution (joinPath call).
const ctx = {
  subscriptions: [],
  extensionUri: Uri.file(extRoot + '/extension'),
  extensionPath: extRoot + '/extension',
  globalState: { get: () => undefined, update: () => Promise.resolve() },
  workspaceState: { get: () => undefined, update: () => Promise.resolve() },
  secrets: { get: () => Promise.resolve(undefined), store: () => Promise.resolve(), delete: () => Promise.resolve() },
  environmentVariableCollection: { replace: () => {}, append: () => {}, prepend: () => {}, get: () => undefined, forEach: () => {}, delete: () => {}, clear: () => {} },
  asAbsolutePath: (p) => extRoot + '/extension/' + p,
  storagePath: undefined,
  globalStoragePath: undefined,
  logPath: undefined,
};
try {
  extModule.activate(ctx);
} catch (err) {
  log('  ✗', 'activate(context) throws', err.message);
  process.exit(1);
}
assert(registry.participants.some((p) => p.id === 'oz-bridge.ozbridge'), 'registers @ozbridge participant');
assert(registry.tools.has('ozbridge_run_local'), 'registers ozbridge_run_local tool');
assert(registry.tools.has('ozbridge_run_cloud'), 'registers ozbridge_run_cloud tool');
assert(registry.tools.has('ozbridge_get_run'), 'registers ozbridge_get_run tool');
assert(registry.tools.has('ozbridge_list_runs'), 'registers ozbridge_list_runs tool');
assert(registry.treeProviders.has('ozBridge.runsView'), 'registers sidebar tree provider');
assert(registry.statusBarItems.length >= 1, 'creates status bar item', `count=${registry.statusBarItems.length}`);
for (const id of mustHaveCommands) {
  assert(registry.commands.has(id), `command ${id} is live`);
}
assert(registry.commands.has('ozBridge.sidebar.focus'), 'command ozBridge.sidebar.focus is live');
assert(registry.commands.has('ozBridge.openConversation'), 'command ozBridge.openConversation is live');
assert(ctx.subscriptions.length > 10, 'subscriptions registered', `count=${ctx.subscriptions.length}`);

// ---------------------------------------------------------------------------
// Functional smoke tests of key surfaces
// ---------------------------------------------------------------------------
console.log('\n--- Functional smoke tests ---');
(async () => {
  // 1) Handoff palette invocation with cancelled input box → must be a no-op
  vscode.window.showInputBox = () => Promise.resolve(undefined);
  const before = registry.externalsOpened.length;
  await vscode.commands.executeCommand('ozBridge.handoff');
  assert(registry.externalsOpened.length === before, 'palette handoff no-op on cancel');

  // 2) Handoff tree invocation with a run node → opens warp:// URI
  await vscode.commands.executeCommand('ozBridge.tree.handoff', {
    kind: 'run', id: 'run:r1', label: 'r1', runId: 'r1', status: 'SUCCEEDED', active: false,
  });
  const openedUri = registry.externalsOpened[registry.externalsOpened.length - 1];
  const openedStr = String(openedUri ?? '');
  // URLSearchParams encodes spaces as `+`; decodeURIComponent doesn't reverse
  // that by itself, so swap `+` back to a space before checking for the
  // human-readable command.
  const decoded = decodeURIComponent(openedStr.replace(/\+/g, ' '));
  assert(openedStr.includes('warp://action/new_tab'), 'tree handoff opens warp:// URI');
  assert(decoded.includes('oz run get'), 'handoff command=oz run get …', decoded.slice(0, 120));

  // 3) Tree provider returns the 5 expected categories
  const provider = registry.treeProviders.get('ozBridge.runsView');
  const roots = await provider.getChildren();
  const categoryIds = roots.map((n) => n.id).sort();
  const expected = [
    'category:activeRuns', 'category:environments', 'category:history',
    'category:mcp', 'category:schedules',
  ];
  assert(JSON.stringify(categoryIds) === JSON.stringify(expected), 'sidebar has 5 categories', categoryIds.join(','));

  // 4) Calling deactivate() must not throw
  try { extModule.deactivate(); log('  ✓', 'deactivate() returns cleanly'); }
  catch (err) { log('  ✗', 'deactivate()', err.message); failures.push('deactivate'); }

  // ---------------------------------------------------------------------------
  // Final verdict
  // ---------------------------------------------------------------------------
  console.log('\n--- Verdict ---');
  if (failures.length === 0) {
    console.log(`PASS — all ${asserted} checks satisfied.`);
    process.exit(0);
  } else {
    console.log(`FAIL — ${failures.length}/${asserted} check(s) failed:`);
    for (const f of failures) console.log('  * ' + f);
    process.exit(1);
  }
})();
