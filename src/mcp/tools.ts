import {
  IOzCliService,
  IConfigManager,
  OzCliError,
  OzCliErrorKind,
  OzRunStatus,
} from '../types/index.js';

/**
 * Public shape of a tool entry as exposed by the MCP `tools/list` method.
 * Follows the Model Context Protocol schema (draft 2024-11-05 / 2025-03-26).
 */
export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Standard MCP content block. We only use `text` blocks — binary/resource
 * content is out of scope for this release.
 */
export interface McpTextContent {
  type: 'text';
  text: string;
}

/**
 * Result of invoking a tool via `tools/call`. `isError` signals that the
 * content carries an error payload while still being a valid JSON-RPC
 * response (not an `error` envelope), which is how MCP clients expect
 * tool-level failures to be reported.
 */
export interface McpToolResult {
  content: McpTextContent[];
  isError?: boolean;
}

/**
 * Concrete handler bound to the Oz CLI. Registered via
 * {@link buildToolRegistry}.
 */
export type McpToolHandler = (input: Record<string, unknown>) => Promise<McpToolResult>;

/**
 * A single registry entry. The `descriptor` is broadcast in `tools/list`,
 * the `invoke` callback is dispatched by `tools/call`.
 */
export interface McpToolEntry {
  descriptor: McpToolDescriptor;
  invoke: McpToolHandler;
}

/**
 * Dependencies used by every tool handler. Tools never see `vscode`
 * directly — the whole MCP surface is framework-agnostic and can be reused
 * by a future standalone MCP binary.
 */
export interface McpToolDeps {
  cli: IOzCliService;
  cfgMgr: IConfigManager;
}

// ---------------------------------------------------------------------------
// Tool descriptors (`tools/list`)
// ---------------------------------------------------------------------------

const DESCRIPTORS: Record<string, McpToolDescriptor> = {
  oz_agent_run: {
    name: 'oz_agent_run',
    description:
      'Run a Warp Oz agent locally and return its output. Executes `oz agent run` ' +
      'with the supplied prompt inside the host extension\'s workspace.',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'Natural-language instruction for the agent.' },
        model: { type: 'string', description: 'Optional model override.' },
        profile: { type: 'string', description: 'Optional Oz agent profile name.' },
        skill: { type: 'string', description: 'Optional agent skill id (e.g. `5-test-agent`).' },
      },
    },
  },
  oz_agent_run_cloud: {
    name: 'oz_agent_run_cloud',
    description:
      'Launch a cloud Warp Oz agent. CONSUMES WARP CREDITS. Returns the run id ' +
      'immediately; use `oz_run_get` to poll terminal status.',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'Natural-language instruction for the cloud agent.' },
        model: { type: 'string', description: 'Optional model override.' },
        environment: { type: 'string', description: 'Cloud environment id or name.' },
        skill: { type: 'string', description: 'Optional agent skill id.' },
      },
    },
  },
  oz_run_get: {
    name: 'oz_run_get',
    description: 'Fetch the status and output of a Warp Oz run by id. Read-only.',
    inputSchema: {
      type: 'object',
      required: ['runId'],
      properties: {
        runId: { type: 'string', description: 'Warp run identifier.' },
      },
    },
  },
  oz_run_list: {
    name: 'oz_run_list',
    description:
      'List recent Warp Oz runs, optionally filtered by status. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['all', 'active', 'completed', 'QUEUED', 'INPROGRESS', 'SUCCEEDED', 'FAILED', 'UNKNOWN'],
          description: 'Filter. `active` = QUEUED|INPROGRESS, `completed` = SUCCEEDED|FAILED.',
        },
        limit: { type: 'number', description: 'Maximum number of rows returned.' },
      },
    },
  },
};

/**
 * Builds the registry that the MCP server consults for both `tools/list`
 * and `tools/call`. Exposes a map keyed by tool name so lookups are O(1).
 */
export function buildToolRegistry(deps: McpToolDeps): Map<string, McpToolEntry> {
  const registry = new Map<string, McpToolEntry>();

  registry.set('oz_agent_run', {
    descriptor: DESCRIPTORS.oz_agent_run,
    invoke: async (input) => {
      try {
        const prompt = requireString(input, 'prompt');
        const defaults = defaultsFor(deps);
        const result = await deps.cli.agentRun({
          prompt,
          model: optionalString(input, 'model') ?? defaults.model,
          profile: optionalString(input, 'profile') ?? defaults.profile,
          skill: optionalString(input, 'skill'),
        });
        return okText(formatRunPayload(result));
      } catch (err) {
        return errorText(err);
      }
    },
  });

  registry.set('oz_agent_run_cloud', {
    descriptor: DESCRIPTORS.oz_agent_run_cloud,
    invoke: async (input) => {
      try {
        const prompt = requireString(input, 'prompt');
        const defaults = defaultsFor(deps);
        const env = optionalString(input, 'environment') || defaults.environment || undefined;
        const result = await deps.cli.agentRunCloud({
          prompt,
          model: optionalString(input, 'model') ?? defaults.model,
          environment: env,
          noEnvironment: !env,
          skill: optionalString(input, 'skill'),
          open: false,
        });
        return okText(formatRunPayload(result));
      } catch (err) {
        return errorText(err);
      }
    },
  });

  registry.set('oz_run_get', {
    descriptor: DESCRIPTORS.oz_run_get,
    invoke: async (input) => {
      try {
        const runId = requireString(input, 'runId').trim();
        if (!runId) { return errorText(new Error('runId is required')); }
        return okText(formatRunPayload(await deps.cli.runGet(runId)));
      } catch (err) {
        return errorText(err);
      }
    },
  });

  registry.set('oz_run_list', {
    descriptor: DESCRIPTORS.oz_run_list,
    invoke: async (input) => {
      const status = (optionalString(input, 'status') ?? 'all') as
        'all' | 'active' | 'completed' | OzRunStatus;
      const limitNum = typeof input.limit === 'number' ? input.limit : undefined;
      try {
        const list = await deps.cli.runList();
        const filtered = filterByStatus(list.items, status);
        const capped = limitNum && limitNum > 0 ? filtered.slice(0, limitNum) : filtered;
        return okText(JSON.stringify({
          filter: status,
          count: capped.length,
          items: capped,
        }, null, 2));
      } catch (err) {
        return errorText(err);
      }
    },
  });

  return registry;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireString(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== 'string') {
    throw new Error(`missing or non-string field: ${key}`);
  }
  return v;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function defaultsFor(deps: McpToolDeps): { model?: string; profile?: string; environment?: string } {
  const cfg = deps.cfgMgr.getConfig();
  return {
    model: cfg.defaultModel && cfg.defaultModel !== 'auto' ? cfg.defaultModel : undefined,
    profile: cfg.defaultProfile && cfg.defaultProfile !== 'Default' ? cfg.defaultProfile : undefined,
    environment: cfg.defaultEnvironment || undefined,
  };
}

function okText(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function errorText(err: unknown): McpToolResult {
  if (err instanceof OzCliError) {
    return {
      content: [
        { type: 'text', text: `Oz CLI error (${err.kind}): ${err.message}${err.stderr ? `\n${err.stderr.substring(0, 500)}` : ''}` },
      ],
      isError: true,
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
}

function formatRunPayload(result: { runId: string | null; status: OzRunStatus; output: string; exitCode: number; durationMs: number }): string {
  return JSON.stringify({
    runId: result.runId,
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    output: truncate(result.output, 4_000),
  }, null, 2);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) { return s; }
  return `${s.substring(0, max)}\n… (${s.length - max} chars truncated)`;
}

function filterByStatus<T extends { status: OzRunStatus }>(
  items: T[],
  filter: 'all' | 'active' | 'completed' | OzRunStatus,
): T[] {
  switch (filter) {
    case 'all': return items;
    case 'active': return items.filter((r) => r.status === 'QUEUED' || r.status === 'INPROGRESS');
    case 'completed': return items.filter((r) => r.status === 'SUCCEEDED' || r.status === 'FAILED');
    default: return items.filter((r) => r.status === filter);
  }
}

// Make OzCliErrorKind referenced so TS sees the import is used even if nothing
// in src/types/index.ts re-exports it conditionally.
void OzCliErrorKind;
