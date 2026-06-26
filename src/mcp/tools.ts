import {
  IOzCliService,
  IConfigManager,
  OzCliError,
  OzCliErrorKind,
  OzRunStatus,
} from '../types/index.js';
import { fetchModelIds } from '../services/modelCatalog.js';
import { setWorkspaceOverride } from '../services/workspaceConfigWriter.js';

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
  /**
   * Absolute workspace root used by {@link buildToolRegistry} to persist the
   * default model into `<workspaceRoot>/.warp/warp-bridge.yaml`. The extension
   * passes the active VS Code workspace folder; the standalone server passes
   * its `--cwd`. When absent, `oz_set_default_model` reports an error instead
   * of writing to an unknown location.
   */
  workspaceRoot?: string;
}

// ---------------------------------------------------------------------------
// Tool descriptors (`tools/list`)
// ---------------------------------------------------------------------------

const DESCRIPTORS: Record<string, McpToolDescriptor> = {
  oz_agent_run: {
    name: 'oz_agent_run',
    description:
      'Run a Warp Oz AI agent locally in the host workspace and return its full output ' +
      'synchronously. Runs `oz agent run` with your prompt and blocks until the agent finishes. ' +
      'Use for local coding tasks — refactor, write/run tests, debug, explain code — that should ' +
      'NOT consume cloud credits; for cloud execution call `oz_agent_run_cloud` instead. '+
      'NOT read-only: the agent may create or modify files in the workspace. ' +
      'Requires the `oz` CLI on PATH (install Warp).',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: {
          type: 'string',
          description: 'Natural-language instruction for the agent, e.g. "add unit tests for src/auth.ts".',
        },
        model: {
          type: 'string',
          description:
            'AI model id to use, from `oz_list_models` (e.g. `claude-4-8-opus-max`). ' +
            'Omit to use the configured default (`auto` lets Warp choose).',
        },
        profile: {
          type: 'string',
          description:
            'Oz agent profile name (managed in the Warp app under Settings → AI → Profiles). ' +
            'Omit to use the default profile.',
        },
        skill: {
          type: 'string',
          description:
            'Agent skill id from the 7-stage pipeline (e.g. `5-test-agent`). ' +
            'Omit to let the CLI choose one based on the prompt.',
        },
      },
    },
  },
  oz_agent_run_cloud: {
    name: 'oz_agent_run_cloud',
    description:
      "Launch a Warp Oz AI agent in Warp's cloud (not on the local machine). " +
      '⚠️ CONSUMES WARP CREDITS — confirm with the user before calling. ' +
      'Returns the run id immediately WITHOUT waiting for completion; poll the terminal status ' +
      'and output with `oz_run_get`, or find the run later via `oz_run_list`. ' +
      'Requires the `oz` CLI on PATH and a Warp account with cloud credits.',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: {
          type: 'string',
          description: 'Natural-language instruction for the cloud agent.',
        },
        model: {
          type: 'string',
          description:
            'AI model id to use, from `oz_list_models`. Omit to use the configured default.',
        },
        environment: {
          type: 'string',
          description:
            'Cloud environment id or name to run in. ' +
            'Omit to use the configured default, or the first available environment.',
        },
        skill: {
          type: 'string',
          description: 'Agent skill id (e.g. `5-test-agent`). Omit to auto-select from the prompt.',
        },
      },
    },
  },
  oz_run_get: {
    name: 'oz_run_get',
    description:
      'Fetch the current status and output of a single Warp Oz run by its id. ' +
      'Read-only and idempotent — safe to call repeatedly while polling a cloud run to ' +
      'completion (SUCCEEDED / FAILED). Typically called after `oz_agent_run_cloud`, which ' +
      'returns the run id; ids also come from `oz_run_list`.',
    inputSchema: {
      type: 'object',
      required: ['runId'],
      properties: {
        runId: {
          type: 'string',
          description: 'Run identifier as returned by `oz_agent_run_cloud` or `oz_run_list`.',
        },
      },
    },
  },
  oz_run_list: {
    name: 'oz_run_list',
    description:
      'List recent Warp Oz runs (id, status, timing), newest first. Read-only. ' +
      'Use to discover run ids to pass to `oz_run_get`, or to review recent agent activity.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['all', 'active', 'completed', 'QUEUED', 'INPROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'PAUSED', 'SKIPPED', 'UNKNOWN'],
          description:
            'Filter by run status. `all` (default) = no filter; `active` = QUEUED|INPROGRESS; ' +
            '`completed` = SUCCEEDED|FAILED; or pass one exact status value.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of runs to return after filtering (positive integer). Omit for no cap.',
        },
      },
    },
  },
  oz_list_models: {
    name: 'oz_list_models',
    description:
      'List the AI model ids available to the connected Warp Oz account (from `oz model list`) ' +
      'and report the current default. Read-only; takes no arguments. ' +
      'Call this first to discover valid ids before passing `model` to `oz_agent_run` / ' +
      '`oz_agent_run_cloud`, or before `oz_set_default_model`.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  oz_set_default_model: {
    name: 'oz_set_default_model',
    description:
      'Set the default Oz model for every OzBridge surface by writing `defaultModel` into the ' +
      'workspace `.warp/warp-bridge.yaml` (the highest-precedence config source). ' +
      'Persistent side effect: edits that file on disk. The id is validated against ' +
      '`oz model list` when reachable. Requires a workspace root (an extension workspace, or ' +
      '`--cwd` for the standalone server).',
    inputSchema: {
      type: 'object',
      required: ['model'],
      properties: {
        model: {
          type: 'string',
          description:
            'Model id to set as default — one of the ids from `oz_list_models` ' +
            '(e.g. `claude-4-8-opus-max`, `gpt-5-5-high`), or `auto` to let Warp choose.',
        },
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

  registry.set('oz_list_models', {
    descriptor: DESCRIPTORS.oz_list_models,
    invoke: async () => {
      try {
        const models = await fetchModelIds(deps.cli);
        const current = deps.cfgMgr.getConfig().defaultModel;
        return okText(JSON.stringify({ count: models.length, current, models }, null, 2));
      } catch (err) {
        return errorText(err);
      }
    },
  });

  registry.set('oz_set_default_model', {
    descriptor: DESCRIPTORS.oz_set_default_model,
    invoke: async (input) => {
      try {
        const model = requireString(input, 'model').trim();
        if (!model) {
          return errorText(new Error('model is required'));
        }
        if (!deps.workspaceRoot) {
          return errorText(new Error(
            'Cannot persist the default model: the MCP server has no workspace root. '
            + 'Start it from a workspace (extension) or pass --cwd (standalone).',
          ));
        }
        // Best-effort validation: reject typos when the catalog is reachable;
        // if `oz model list` fails, still honour the write rather than block.
        try {
          const models = await fetchModelIds(deps.cli);
          // `auto` is always valid (lets Warp choose) even if the catalogue
          // snapshot happens not to list it.
          if (model !== 'auto' && models.length > 0 && !models.includes(model)) {
            return errorText(new Error(
              `Unknown model '${model}'. Call oz_list_models to see the ${models.length} available ids.`,
            ));
          }
        } catch { /* catalog unreachable — proceed without validation */ }
        const file = await setWorkspaceOverride(deps.workspaceRoot, 'defaultModel', model);
        return okText(
          `Default model set to '${model}' (written to ${file}). `
          + 'New runs use it immediately; a running standalone server may need a restart.',
        );
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
