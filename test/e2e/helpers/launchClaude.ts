import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
// Import from the pre-compiled standalone lib (vscode shim already bundled)
// so Playwright workers can require this without a VS Code extension host.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { McpServer, buildToolRegistry } = require('../../../packages/oz-mcp-server/dist/lib.js') as typeof import('../../../packages/oz-mcp-server/src/lib.js');
import type {
  IOzCliService,
  IConfigManager,
  OzBridgeConfig,
  OzRunResult,
  OzListResult,
} from '../../../src/types/index.js';

/**
 * E2E harness for Claude Code, the Anthropic CLI.
 *
 * Claude Code is a terminal application — not an Electron app — so the
 * Playwright + `_electron` driver used for the VS Code and Cursor suites
 * does not apply. This harness instead:
 *
 *   1. Boots an in-process {@link McpServer} bound to an ephemeral port,
 *      backed by a fixture {@link IOzCliService} so no real Oz CLI is
 *      ever invoked.
 *   2. Writes a temporary `~/.claude.json` containing an `oz-bridge`
 *      entry pointed at the freshly-bound endpoint.
 *   3. Spawns `claude` as a subprocess with `HOME` (or `USERPROFILE`)
 *      pointed at the tmp directory, then captures stdout/stderr and
 *      the exit code.
 *
 * Gated: returns `undefined` from {@link getClaudeBinary} when
 * `OZBRIDGE_E2E_CLAUDE_BIN` is unset, so the spec can `test.skip`
 * cleanly on CI machines without `claude` installed.
 */

export function getClaudeBinary(): string | undefined {
  const candidate = process.env.OZBRIDGE_E2E_CLAUDE_BIN;
  return candidate && candidate.trim().length > 0 ? candidate.trim() : undefined;
}

export interface LaunchedClaudeHarness {
  /** Endpoint URL the MCP server is listening on. */
  url: string;
  /** Bearer token if any (currently always empty for the harness). */
  bearerToken?: string;
  /** Path to the tmp `.claude.json` that registers `oz-bridge`. */
  claudeConfigPath: string;
  /** Tmp HOME directory to be passed via env to subprocess. */
  homeDir: string;
  /** Run `claude --print <prompt>` and capture stdout/stderr/exitCode. */
  runClaude: (args: string[], opts?: { timeoutMs?: number; stdin?: string }) => Promise<ClaudeRun>;
  /** Stops the server, removes tmp files. Idempotent. */
  dispose: () => Promise<void>;
}

export interface ClaudeRun {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

/**
 * Stand-in {@link IOzCliService} that returns deterministic fixtures so
 * the MCP tools resolve without a real Oz CLI. Only the methods the
 * harness exercises are implemented; the rest throw to surface
 * unexpected coverage gaps.
 */
function createFixtureCli(): IOzCliService {
  const notImpl = (name: string) => () => {
    throw new Error(`fixture cli: ${name} not implemented in Claude Code harness`);
  };
  const sampleRun: OzRunResult = {
    id: 'fixture-run-1',
    status: 'SUCCEEDED',
    output: 'fixture run output',
    durationMs: 42,
    raw: '{}',
  } as unknown as OzRunResult;
  const sampleList: OzListResult = {
    runs: [sampleRun],
    truncated: false,
  } as unknown as OzListResult;

  return {
    agentRun: async () => sampleRun,
    agentRunCloud: async () => ({ ...sampleRun, id: 'fixture-cloud-run-1' } as OzRunResult),
    getRun: async () => sampleRun,
    listRuns: async () => sampleList,
    isAvailable: async () => true,
    cancelAll: notImpl('cancelAll'),
    runDriveCommand: notImpl('runDriveCommand'),
    runRaw: notImpl('runRaw'),
  } as unknown as IOzCliService;
}

function createFixtureConfigManager(): IConfigManager {
  const cfg: OzBridgeConfig = {
    ozPath: 'oz',
    defaultModel: 'opus-4',
    defaultProfile: 'default',
    defaultEnvironment: '',
    timeoutMs: 30_000,
    idleTimeoutMs: 10_000,
    maxOutputChars: 15_000,
    cloudPollingIntervalMs: 5_000,
    cloudPollingTimeoutMs: 60_000,
    mcpEnabled: true,
    mcpPort: 0,
    mcpBindAddress: '127.0.0.1',
    mcpBearerToken: '',
    mcpMaxSseSessions: 16,
  } as unknown as OzBridgeConfig;
  return {
    getConfig: () => cfg,
    onConfigChanged: () => ({ dispose: () => undefined }),
  } as unknown as IConfigManager;
}

export async function launchClaudeHarness(): Promise<LaunchedClaudeHarness> {
  const claudeBin = getClaudeBinary();
  if (!claudeBin) {
    throw new Error(
      'launchClaudeHarness: OZBRIDGE_E2E_CLAUDE_BIN not set. '
      + 'Point it at the `claude` binary (typically `which claude`).',
    );
  }
  // Verify the binary is reachable up-front. Otherwise `child_process.spawn`
  // either fails inside the timer (Linux/macOS, ENOENT on `'error'`) or
  // surfaces a confusing exit code 9009 (Windows): both produce noisier
  // failures than a clear `Error` thrown synchronously here.
  try {
    await fs.access(claudeBin);
  } catch {
    throw new Error(`launchClaudeHarness: claude binary not found at ${claudeBin}`);
  }

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozbridge-e2e-claude-'));
  const homeDir = path.join(tmpRoot, 'home');
  await fs.mkdir(homeDir, { recursive: true });
  const claudeConfigPath = path.join(homeDir, '.claude.json');

  const registry = buildToolRegistry({
    cli: createFixtureCli(),
    cfgMgr: createFixtureConfigManager(),
  });
  const server = new McpServer(registry, { name: 'oz-bridge', version: 'e2e' }, {
    port: 0,
    bindAddress: '127.0.0.1',
    maxSseSessions: 16,
  });
  await server.start();
  const ep = server.endpoint;
  if (!ep) {
    throw new Error('launchClaudeHarness: MCP server failed to bind');
  }
  const url = `http://${ep.address}:${ep.port}/sse`;

  await fs.writeFile(
    claudeConfigPath,
    `${JSON.stringify({
      mcpServers: {
        'oz-bridge': { type: 'sse', url },
      },
    }, null, 2)}\n`,
    'utf8',
  );

  const runClaude: LaunchedClaudeHarness['runClaude'] = async (args, opts = {}) => {
    const timeoutMs = opts.timeoutMs ?? 60_000;
    return new Promise<ClaudeRun>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let killed = false;

      const child: ChildProcess = spawn(claudeBin, args, {
        env: {
          ...process.env,
          HOME: homeDir,
          USERPROFILE: homeDir,
          // Make Claude Code resolve its config from our tmp HOME.
          CLAUDE_HOME: homeDir,
        },
        windowsHide: true,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        killed = true;
        try { child.kill('SIGTERM'); } catch { /* already exited */ }
        setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* */ } }, 1500).unref();
      }, timeoutMs);
      timer.unref?.();

      child.stdout?.on('data', (b: Buffer) => { stdout += b.toString(); });
      child.stderr?.on('data', (b: Buffer) => { stderr += b.toString(); });

      if (opts.stdin !== undefined) {
        try { child.stdin?.write(opts.stdin); child.stdin?.end(); } catch { /* */ }
      }

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: killed ? null : code, timedOut });
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr: stderr + `\n[harness] spawn error: ${err.message}\n`,
          exitCode: null,
          timedOut,
        });
      });
    });
  };

  const dispose = async (): Promise<void> => {
    try { await server.stop(); } catch { /* ignore */ }
    try { await fs.rm(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  return { url, claudeConfigPath, homeDir, runClaude, dispose };
}
