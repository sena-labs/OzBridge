import { IOzCliService, IConfigManager, OzRunStatus } from '../types/index.js';

/**
 * Context required by {@link expandPromptVariables} to resolve tokens.
 */
export interface PromptExpanderContext {
  cli: IOzCliService;
  cfgMgr: IConfigManager;
}

/**
 * Result of a single expansion pass. `replacements` maps each token the user
 * wrote (e.g. `#oz.run/abc`) to the substituted payload so callers can log
 * exactly what was expanded.
 */
export interface PromptExpansionResult {
  /** The prompt after substitution. Equal to the input when no token matched. */
  text: string;
  /** Token → substitution (by insertion order). */
  replacements: Array<{ token: string; value: string }>;
}

/**
 * Recognised tokens (matched case-sensitively, bounded by non-word chars).
 *
 * - `#warp.env` → `warpBridge.defaultEnvironment` (config value, empty = `(none)`).
 * - `#warp.profile` → `warpBridge.defaultProfile`.
 * - `#warp.model` → `warpBridge.defaultModel`.
 * - `#oz.history` → a Markdown table of the last 10 runs from `oz run list`.
 * - `#oz.run/<id>` → JSON payload returned by `oz run get <id>` (truncated).
 *
 * Any failure while resolving a dynamic token (network/CLI) is surfaced as an
 * inline `_error_` note inside the prompt rather than throwing, so the user's
 * intent isn't lost.
 */
const TOKEN_REGEX = /#(warp\.env|warp\.profile|warp\.model|oz\.history|oz\.run\/[A-Za-z0-9_\-]+)/g;

const HISTORY_LIMIT = 10;
const RUN_PAYLOAD_MAX_CHARS = 2_000;

/**
 * Replaces every recognised `#warp.*` / `#oz.*` token in `prompt` with its
 * resolved value. Unknown tokens are left untouched.
 *
 * The function is intentionally async because `#oz.history` and
 * `#oz.run/<id>` require CLI calls. To avoid amplifying latency each dynamic
 * token is resolved at most once per call and cached in-memory within the
 * scope of this expansion.
 */
export async function expandPromptVariables(
  prompt: string,
  ctx: PromptExpanderContext,
): Promise<PromptExpansionResult> {
  const matches = Array.from(new Set(prompt.match(TOKEN_REGEX) ?? []));
  if (matches.length === 0) {
    return { text: prompt, replacements: [] };
  }

  const resolutions = new Map<string, string>();
  for (const token of matches) {
    try {
      resolutions.set(token, await resolveToken(token, ctx));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      resolutions.set(token, `_error resolving ${token}: ${message}_`);
    }
  }

  const replacements: Array<{ token: string; value: string }> = [];
  const text = prompt.replace(TOKEN_REGEX, (match) => {
    const value = resolutions.get(match);
    if (value === undefined) { return match; }
    replacements.push({ token: match, value });
    return value;
  });

  return { text, replacements };
}

/**
 * Resolves a single token. Exported for unit testing.
 */
export async function resolveToken(token: string, ctx: PromptExpanderContext): Promise<string> {
  if (token === '#warp.env') {
    const env = ctx.cfgMgr.getConfig().defaultEnvironment;
    return env || '(no default environment)';
  }
  if (token === '#warp.profile') {
    return ctx.cfgMgr.getConfig().defaultProfile || '(no default profile)';
  }
  if (token === '#warp.model') {
    return ctx.cfgMgr.getConfig().defaultModel || '(no default model)';
  }
  if (token === '#oz.history') {
    return await renderHistoryTable(ctx);
  }
  if (token.startsWith('#oz.run/')) {
    const id = token.slice('#oz.run/'.length);
    return await renderRunDetail(id, ctx);
  }
  return token;
}

async function renderHistoryTable(ctx: PromptExpanderContext): Promise<string> {
  const list = await ctx.cli.runList();
  const items = list.items.slice(0, HISTORY_LIMIT);
  if (items.length === 0) {
    return list.rawText ? `_${list.rawText}_` : '_No runs found._';
  }
  const rows = items.map((r) => `| \`${r.id}\` | ${statusLabel(r.status)} |`);
  return [
    '| Run ID | Status |',
    '| --- | --- |',
    ...rows,
  ].join('\n');
}

async function renderRunDetail(runId: string, ctx: PromptExpanderContext): Promise<string> {
  const trimmedId = runId.trim();
  if (!trimmedId) { return '_invalid run id_'; }
  const result = await ctx.cli.runGet(trimmedId);
  const payload = JSON.stringify({
    runId: result.runId,
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    output: truncateOutput(result.output),
  }, null, 2);
  return ['```json', payload, '```'].join('\n');
}

function truncateOutput(output: string): string {
  if (output.length <= RUN_PAYLOAD_MAX_CHARS) { return output; }
  return `${output.substring(0, RUN_PAYLOAD_MAX_CHARS)}\n… (${output.length - RUN_PAYLOAD_MAX_CHARS} chars truncated)`;
}

function statusLabel(status: OzRunStatus): string {
  switch (status) {
    case 'QUEUED': return '⏳ QUEUED';
    case 'INPROGRESS': return '⏳ INPROGRESS';
    case 'SUCCEEDED': return '✅ SUCCEEDED';
    case 'FAILED': return '❌ FAILED';
    default: return '❓ UNKNOWN';
  }
}
