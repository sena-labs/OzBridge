import * as vscode from 'vscode';
import {
  IOzCliService,
  OzRunStatus,
  OzSchedule,
  OzEnvironment,
  OzMcpServer,
} from '../types/index.js';
import { ActiveRunsTracker, TrackedRun } from '../services/activeRunsTracker.js';

/**
 * Top-level categories rendered by {@link OzRunsTreeProvider}.
 *
 * The `kind` discriminator drives both the icon and the `contextValue`
 * assigned to the `TreeItem`, which `package.json` uses to gate context-menu
 * commands (e.g. *Cancel* is visible only on `activeRun` nodes).
 */
export type OzTreeNode =
  | CategoryNode
  | RunNode
  | ScheduleNode
  | EnvironmentNode
  | McpNode
  | MessageNode;

interface BaseNode {
  readonly id: string;
  readonly label: string;
}

interface CategoryNode extends BaseNode {
  readonly kind: 'category';
  readonly category: 'activeRuns' | 'history' | 'schedules' | 'environments' | 'mcp';
}

interface RunNode extends BaseNode {
  readonly kind: 'run';
  readonly runId: string;
  readonly status: OzRunStatus;
  readonly active: boolean;
}

interface ScheduleNode extends BaseNode {
  readonly kind: 'schedule';
  readonly schedule: OzSchedule;
}

interface EnvironmentNode extends BaseNode {
  readonly kind: 'environment';
  readonly environment: OzEnvironment;
}

interface McpNode extends BaseNode {
  readonly kind: 'mcp';
  readonly server: OzMcpServer;
}

interface MessageNode extends BaseNode {
  readonly kind: 'message';
}

/**
 * `TreeDataProvider` that renders 5 top-level categories in the Warp sidebar:
 *
 * 1. **Active Runs** — `QUEUED` + `INPROGRESS` (live via {@link ActiveRunsTracker}).
 * 2. **History** — `SUCCEEDED` + `FAILED` (last N, from the same tracker).
 * 3. **Schedules** — `oz schedule list`.
 * 4. **Environments** — `oz environment list`.
 * 5. **MCP Servers** — `oz mcp list`.
 *
 * The tree is refreshed whenever the tracker fires `onDidChange`, when the
 * user invokes the `ozBridge.tree.refresh` command, or when a schedule /
 * environment mutation happens.
 */
export class OzRunsTreeProvider implements vscode.TreeDataProvider<OzTreeNode>, vscode.Disposable {
  static readonly HISTORY_LIMIT = 20;

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<OzTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly subscriptions: vscode.Disposable[] = [];
  private disposed = false;

  constructor(
    private readonly cli: IOzCliService,
    private readonly tracker: ActiveRunsTracker,
  ) {
    this.subscriptions.push(
      this.tracker.onDidChange(() => this._onDidChangeTreeData.fire()),
      this.tracker.onDidError(() => this._onDidChangeTreeData.fire()),
    );
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true;
    for (const s of this.subscriptions) { s.dispose(); }
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(element: OzTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case 'category': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
        item.id = element.id;
        item.iconPath = new vscode.ThemeIcon(categoryIcon(element.category));
        item.contextValue = `warpCategory:${element.category}`;
        item.tooltip = `${element.label} category`;
        // v1.0 deliverable S — WCAG 2.1 AA: explicit a11y label/role
        // so screen readers announce a meaningful semantic value.
        item.accessibilityInformation = {
          label: `${element.label} category`,
          role: 'treeitem',
        };
        return item;
      }
      case 'run': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.id = element.id;
        item.description = element.status;
        item.iconPath = new vscode.ThemeIcon(runIcon(element.status));
        item.tooltip = `Run ${element.runId} — ${element.status}`;
        item.contextValue = element.active ? 'warpRun:active' : 'warpRun:completed';
        item.command = {
          command: 'ozBridge.tree.showRun',
          title: 'Show Run',
          arguments: [element.runId],
        };
        item.accessibilityInformation = {
          label: `Run ${element.label}, status ${element.status}${element.active ? ', active' : ''}`,
          role: 'treeitem',
        };
        return item;
      }
      case 'schedule': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.id = element.id;
        item.description = element.schedule.cron;
        item.iconPath = new vscode.ThemeIcon(element.schedule.paused ? 'debug-pause' : 'clock');
        item.tooltip = `${element.schedule.name} — ${element.schedule.cron}\n${element.schedule.prompt}`;
        item.contextValue = element.schedule.paused ? 'warpSchedule:paused' : 'warpSchedule:running';
        item.accessibilityInformation = {
          label: `Schedule ${element.schedule.name}, cron ${element.schedule.cron}, ${element.schedule.paused ? 'paused' : 'running'}`,
          role: 'treeitem',
        };
        return item;
      }
      case 'environment': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.id = element.id;
        item.description = element.environment.scope || undefined;
        item.iconPath = new vscode.ThemeIcon('server-environment');
        item.tooltip = `${element.environment.name} (${element.environment.id})`;
        item.contextValue = 'warpEnvironment';
        item.accessibilityInformation = {
          label: `Environment ${element.environment.name}${element.environment.scope ? `, scope ${element.environment.scope}` : ''}`,
          role: 'treeitem',
        };
        return item;
      }
      case 'mcp': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.id = element.id;
        item.iconPath = new vscode.ThemeIcon('plug');
        item.tooltip = `MCP server ${element.server.name} (${element.server.uuid})`;
        item.contextValue = 'warpMcp';
        item.accessibilityInformation = {
          label: `MCP server ${element.server.name}`,
          role: 'treeitem',
        };
        return item;
      }
      case 'message': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.id = element.id;
        item.iconPath = new vscode.ThemeIcon('info');
        item.contextValue = 'warpMessage';
        item.tooltip = element.label;
        item.accessibilityInformation = {
          label: `Information: ${element.label}`,
          role: 'treeitem',
        };
        return item;
      }
    }
  }

  async getChildren(element?: OzTreeNode): Promise<OzTreeNode[]> {
    if (!element) {
      return [
        cat('activeRuns', 'Active Runs'),
        cat('history', 'History'),
        cat('schedules', 'Schedules'),
        cat('environments', 'Environments'),
        cat('mcp', 'MCP Servers'),
      ];
    }

    if (element.kind !== 'category') {
      return [];
    }

    switch (element.category) {
      case 'activeRuns':
        return this.activeRunNodes();
      case 'history':
        return this.historyNodes();
      case 'schedules':
        return this.scheduleNodes();
      case 'environments':
        return this.environmentNodes();
      case 'mcp':
        return this.mcpNodes();
    }
  }

  // ---------------------------------------------------------------------
  // Category resolvers
  // ---------------------------------------------------------------------

  private activeRunNodes(): OzTreeNode[] {
    const active = this.tracker.latest.filter((r) => r.status === 'QUEUED' || r.status === 'INPROGRESS');
    if (active.length === 0) {
      return [msg('activeRuns:empty', 'No active runs')];
    }
    return active.map((r) => runNode(r, true));
  }

  private historyNodes(): OzTreeNode[] {
    const completed = this.tracker.latest
      .filter((r) => r.status === 'SUCCEEDED' || r.status === 'FAILED')
      .slice(0, OzRunsTreeProvider.HISTORY_LIMIT);
    if (completed.length === 0) {
      return [msg('history:empty', 'No completed runs yet')];
    }
    return completed.map((r) => runNode(r, false));
  }

  private async scheduleNodes(): Promise<OzTreeNode[]> {
    try {
      const list = await this.cli.scheduleList();
      if (list.items.length === 0) {
        return [msg('schedules:empty', 'No schedules configured')];
      }
      return list.items.map<ScheduleNode>((s) => ({
        kind: 'schedule',
        id: `schedule:${s.id}`,
        label: s.name,
        schedule: s,
      }));
    } catch (err) {
      return [msg('schedules:error', errorLabel(err))];
    }
  }

  private async environmentNodes(): Promise<OzTreeNode[]> {
    try {
      const list = await this.cli.environmentList();
      if (list.items.length === 0) {
        return [msg('environments:empty', 'No environments configured')];
      }
      return list.items.map<EnvironmentNode>((e) => ({
        kind: 'environment',
        id: `environment:${e.id}`,
        label: e.name,
        environment: e,
      }));
    } catch (err) {
      return [msg('environments:error', errorLabel(err))];
    }
  }

  private async mcpNodes(): Promise<OzTreeNode[]> {
    try {
      const list = await this.cli.mcpList();
      if (list.items.length === 0) {
        return [msg('mcp:empty', 'No MCP servers configured')];
      }
      return list.items.map<McpNode>((m) => ({
        kind: 'mcp',
        id: `mcp:${m.uuid}`,
        label: m.name,
        server: m,
      }));
    } catch (err) {
      return [msg('mcp:error', errorLabel(err))];
    }
  }
}

// ===========================================================================
// Node factories
// ===========================================================================

function cat(
  category: CategoryNode['category'],
  label: string,
): CategoryNode {
  return { kind: 'category', id: `category:${category}`, label, category };
}

function msg(id: string, label: string): MessageNode {
  return { kind: 'message', id: `message:${id}`, label };
}

function runNode(run: TrackedRun, active: boolean): RunNode {
  return {
    kind: 'run',
    id: `run:${run.id}`,
    label: run.id,
    runId: run.id,
    status: run.status,
    active,
  };
}

// ===========================================================================
// Presentation helpers
// ===========================================================================

function categoryIcon(category: CategoryNode['category']): string {
  switch (category) {
    case 'activeRuns': return 'pulse';
    case 'history': return 'history';
    case 'schedules': return 'calendar';
    case 'environments': return 'server-environment';
    case 'mcp': return 'plug';
  }
}

function runIcon(status: OzRunStatus): string {
  switch (status) {
    case 'QUEUED': return 'clock';
    case 'INPROGRESS': return 'sync~spin';
    case 'SUCCEEDED': return 'check';
    case 'FAILED': return 'error';
    default: return 'question';
  }
}

function errorLabel(err: unknown): string {
  if (err instanceof Error) { return `Error: ${err.message}`; }
  return `Error: ${String(err)}`;
}
