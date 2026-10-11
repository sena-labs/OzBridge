import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { OzCliService } from '../../src/services/ozCliService.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';
import { createMockConfigManager } from '../helpers.js';

// ---------------------------------------------------------------------------
// Mock child_process (spawn + execFileSync used by resolveOzPath)
// ---------------------------------------------------------------------------
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFileSync: vi.fn(() => { throw new Error('not found'); }),
}));

// Mock node:fs (existsSync used by resolveOzPath)
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

import { spawn } from 'node:child_process';

const mockSpawn = vi.mocked(spawn);

// ---------------------------------------------------------------------------
// Helper: creates a mock process that emits stdout/stderr and closes
// ---------------------------------------------------------------------------
function createMockProcess(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: Error;
} = {}) {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
    pid: 9999,
  });

  mockSpawn.mockReturnValue(proc as any);

  // Emit events asynchronously (after exec() has registered the listeners)
  process.nextTick(() => {
    if (opts.error) {
      proc.emit('error', opts.error);
      return;
    }
    if (opts.stdout) proc.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.stderr) proc.stderr.emit('data', Buffer.from(opts.stderr));
    proc.emit('close', opts.exitCode ?? 0);
  });

  return proc;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
let cli: OzCliService;

beforeEach(() => {
  vi.clearAllMocks();
  cli = new OzCliService(createMockConfigManager());
});

describe('OzCliService', () => {
  // =========================================================================
  // checkAvailability()
  // =========================================================================
  describe('checkAvailability()', () => {
    it('returns available=true when --help succeeds', async () => {
      createMockProcess({ stdout: 'Usage: oz <COMMAND>\n' });
      const result = await cli.checkAvailability();
      expect(result.available).toBe(true);
      expect(result.version).toBeNull();
      expect(result.path).toBe('oz');
    });

    it('returns available=false when spawn fails', async () => {
      createMockProcess({ error: new Error('ENOENT: not found') });
      const result = await cli.checkAvailability();
      expect(result.available).toBe(false);
      expect(result.version).toBeNull();
    });

    it('returns available=true even when stdout is empty', async () => {
      createMockProcess({ stdout: '' });
      const result = await cli.checkAvailability();
      expect(result.available).toBe(true);
      expect(result.version).toBeNull();
      expect(result.path).toBe('oz');
    });
  });

  // =========================================================================
  // agentRun()
  // =========================================================================
  describe('agentRun()', () => {
    it('runs agent run with the prompt and parses the JSON result', async () => {
      createMockProcess({
        stdout: JSON.stringify({ id: 'run-1', status: 'SUCCEEDED', output: 'Result' }),
      });

      const result = await cli.agentRun({ prompt: 'fix the bug' });

      expect(result.runId).toBe('run-1');
      expect(result.status).toBe('SUCCEEDED');
      expect(result.output).toBe('Result');
      expect(result.exitCode).toBe(0);

      // Check the args passed to spawn. The output format is now carried
      // by the WARP_OUTPUT_FORMAT env var (see exec()), no longer repeated
      // on every argv — so `--output-format` must NOT appear anymore.
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('agent');
      expect(args).toContain('run');
      expect(args).toContain('-p');
      expect(args).toContain('fix the bug');
      expect(args).not.toContain('--output-format');

      // The env passed to spawn must set WARP_OUTPUT_FORMAT=json
      const spawnOpts = mockSpawn.mock.calls[0][2] as { env?: Record<string, string> };
      expect(spawnOpts.env?.WARP_OUTPUT_FORMAT).toBe('json');
    });

    it('passes --model when specified', async () => {
      createMockProcess({ stdout: '{"status":"SUCCEEDED"}' });
      await cli.agentRun({ prompt: 'test', model: 'gpt-4' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--model');
      expect(args).toContain('gpt-4');
    });

    it('passes --profile when specified', async () => {
      createMockProcess({ stdout: '{"status":"SUCCEEDED"}' });
      await cli.agentRun({ prompt: 'test', profile: 'custom' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--profile');
      expect(args).toContain('custom');
    });

    it('passes --skill when specified', async () => {
      createMockProcess({ stdout: '{"status":"SUCCEEDED"}' });
      await cli.agentRun({ prompt: 'test', skill: '1-spec-agent' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--skill');
      expect(args).toContain('1-spec-agent');
    });

    it('handles non-JSON output (plain text)', async () => {
      createMockProcess({ stdout: 'Plain text output from agent' });
      const result = await cli.agentRun({ prompt: 'hello' });
      expect(result.runId).toBeNull();
      expect(result.status).toBe('SUCCEEDED');
      expect(result.output).toBe('Plain text output from agent');
    });

    it('handles the alternative run_id in the JSON', async () => {
      createMockProcess({ stdout: '{"run_id":"alt-123","status":"QUEUED"}' });
      const result = await cli.agentRun({ prompt: 'test' });
      expect(result.runId).toBe('alt-123');
    });

    it('sets status FAILED for a non-zero exit code with text output', async () => {
      createMockProcess({ stdout: 'Something went wrong', exitCode: 1, stderr: 'err' });
      await expect(cli.agentRun({ prompt: 'test' })).rejects.toThrow(OzCliError);
    });
  });

  // =========================================================================
  // agentRunCloud()
  // =========================================================================
  describe('agentRunCloud()', () => {
    it('runs run-cloud with the correct parameters', async () => {
      createMockProcess({ stdout: '{"id":"cloud-1","status":"QUEUED"}' });
      await cli.agentRunCloud({ prompt: 'deploy it', environment: 'prod' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('run-cloud');
      expect(args).toContain('-e');
      expect(args).toContain('prod');
    });

    it('passes --model when specified', async () => {
      createMockProcess({ stdout: '{"status":"SUCCEEDED"}' });
      await cli.agentRunCloud({ prompt: 'test', model: 'gpt-4' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--model');
      expect(args).toContain('gpt-4');
    });

    it('passes --skill when specified', async () => {
      createMockProcess({ stdout: '{"status":"SUCCEEDED"}' });
      await cli.agentRunCloud({ prompt: 'test', skill: '1-spec-agent' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--skill');
      expect(args).toContain('1-spec-agent');
    });

    it('passes --no-environment when noEnvironment is true', async () => {
      createMockProcess({ stdout: '{"status":"SUCCEEDED"}' });
      await cli.agentRunCloud({ prompt: 'test', noEnvironment: true });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--no-environment');
      expect(args).not.toContain('-e');
    });

    it('prefers -e over --no-environment when both are provided', async () => {
      createMockProcess({ stdout: '{"status":"SUCCEEDED"}' });
      await cli.agentRunCloud({ prompt: 'test', environment: 'prod', noEnvironment: true });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('-e');
      expect(args).toContain('prod');
      expect(args).not.toContain('--no-environment');
    });

    it('passes --open when open is true', async () => {
      createMockProcess({ stdout: '{"status":"SUCCEEDED"}' });
      await cli.agentRunCloud({ prompt: 'test', open: true });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--open');
    });

    it('does not pass --open when open is not specified', async () => {
      createMockProcess({ stdout: '{"status":"SUCCEEDED"}' });
      await cli.agentRunCloud({ prompt: 'test' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).not.toContain('--open');
    });
  });

  // =========================================================================
  // runList() / runGet()
  // =========================================================================
  describe('runList()', () => {
    it('returns a list of runs', async () => {
      createMockProcess({ stdout: '[{"id":"r1","status":"SUCCEEDED"},{"id":"r2","status":"FAILED"}]' });
      const result = await cli.runList();
      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('r1');
    });

    it('handles the output "No runs found."', async () => {
      createMockProcess({ stdout: 'No runs found.' });
      const result = await cli.runList();
      expect(result.items).toHaveLength(0);
      expect(result.rawText).toBe('No runs found.');
    });
  });

  describe('runGet()', () => {
    it('gets the details of a run', async () => {
      createMockProcess({ stdout: '{"id":"run-x","status":"SUCCEEDED","output":"done"}' });
      const result = await cli.runGet('run-x');
      expect(result.runId).toBe('run-x');
    });

    it('rejects IDs with invalid characters (injection protection)', async () => {
      await expect(cli.runGet('id; rm -rf /')).rejects.toThrow(OzCliError);
      await expect(cli.runGet('id; rm -rf /')).rejects.toThrow('Invalid runId');
    });

    it('accepts alphanumeric IDs with hyphens and underscores', async () => {
      createMockProcess({ stdout: '{"id":"run_abc-123","status":"SUCCEEDED"}' });
      const result = await cli.runGet('run_abc-123');
      expect(result.runId).toBe('run_abc-123');
    });

    it('derives status from the `state` field (run get / run list payloads)', async () => {
      // Live regression: `oz run get` returns `{"run_id":...,"state":"SUCCEEDED"}`
      // (no `status` key). Status must not be mis-reported as UNKNOWN.
      createMockProcess({ stdout: '{"run_id":"r-1","state":"SUCCEEDED","title":"x"}' });
      const result = await cli.runGet('r-1');
      expect(result.runId).toBe('r-1');
      expect(result.status).toBe('SUCCEEDED');
    });
  });

  // =========================================================================
  // Schedule methods
  // =========================================================================
  describe('scheduleCreate()', () => {
    it('creates a schedule', async () => {
      createMockProcess({
        stdout: JSON.stringify({ id: 'sched-1', name: 'daily', cron: '0 9 * * *', prompt: 'lint', paused: false }),
      });
      const result = await cli.scheduleCreate({ name: 'daily', cron: '0 9 * * *', prompt: 'lint' });
      expect(result.id).toBe('sched-1');
      expect(result.name).toBe('daily');
    });

    it('throws when the output cannot be parsed', async () => {
      createMockProcess({ stdout: 'Something unexpected' });
      await expect(cli.scheduleCreate({ name: 'x', cron: '* * * * *', prompt: 'y' }))
        .rejects.toThrow(OzCliError);
    });

    it('rejects a name with invalid characters (validateCliArg)', async () => {
      await expect(
        cli.scheduleCreate({ name: 'bad;name', cron: '0 9 * * *', prompt: 'lint' }),
      ).rejects.toThrow('Invalid schedule name');
    });

    it('passes --skill and -e when specified', async () => {
      createMockProcess({
        stdout: JSON.stringify({ id: 'sched-opt', name: 'job', cron: '0 9 * * *', prompt: 'run', paused: false }),
      });
      await cli.scheduleCreate({ name: 'job', cron: '0 9 * * *', prompt: 'run', skill: 'test-skill', environment: 'staging' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--skill');
      expect(args).toContain('test-skill');
      expect(args).toContain('-e');
      expect(args).toContain('staging');
    });
  });

  describe('schedulePause/Unpause/Delete', () => {
    it('rejects an invalid ID for pause', async () => {
      await expect(cli.schedulePause('bad id!')).rejects.toThrow('Invalid schedule id');
    });

    it('rejects an invalid ID for unpause', async () => {
      await expect(cli.scheduleUnpause('x y')).rejects.toThrow('Invalid schedule id');
    });

    it('rejects an invalid ID for delete', async () => {
      await expect(cli.scheduleDelete('../etc')).rejects.toThrow('Invalid schedule id');
    });

    it('accepts valid IDs', async () => {
      createMockProcess();
      await cli.schedulePause('sched-1');
      expect(mockSpawn).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Discovery methods
  // =========================================================================
  describe('modelList()', () => {
    it('returns the model list', async () => {
      createMockProcess({ stdout: '[{"id":"gpt-4"},{"id":"claude-3"}]' });
      const result = await cli.modelList();
      expect(result.items).toHaveLength(2);
    });
  });

  describe('mcpList()', () => {
    it('returns the MCP server list', async () => {
      createMockProcess({ stdout: '[{"uuid":"u1","name":"mcp-1"}]' });
      const result = await cli.mcpList();
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe('mcp-1');
    });
  });

  // =========================================================================
  // Error handling in exec()
  // =========================================================================
  describe('exec() error handling', () => {
    it('detects ENOENT as NOT_FOUND', async () => {
      createMockProcess({ error: new Error('ENOENT: spawn oz failed') });
      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(OzCliError);
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.NOT_FOUND);
      }
    });

    it('detects "not logged in" as NOT_AUTHENTICATED', async () => {
      createMockProcess({ stderr: 'Error: not logged in', exitCode: 1 });
      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(OzCliError);
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.NOT_AUTHENTICATED);
      }
    });

    it('detects "unauthorized" as NOT_AUTHENTICATED', async () => {
      createMockProcess({ stderr: 'Unauthorized access', exitCode: 1 });
      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should throw');
      } catch (err) {
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.NOT_AUTHENTICATED);
      }
    });

    // P1 fix: new authentication patterns
    it('detects "please log in" as NOT_AUTHENTICATED (P1)', async () => {
      createMockProcess({ stderr: 'Error: please log in to continue', exitCode: 1 });
      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(OzCliError);
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.NOT_AUTHENTICATED);
      }
    });

    it('detects "must log in" as NOT_AUTHENTICATED (P1)', async () => {
      createMockProcess({ stderr: 'You must log in before using this feature', exitCode: 1 });
      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(OzCliError);
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.NOT_AUTHENTICATED);
      }
    });

    it('does NOT detect a generic "login" as NOT_AUTHENTICATED (P1 regression)', async () => {
      // "login" on its own must not trigger NOT_AUTHENTICATED — the P1 fix removed this pattern
      createMockProcess({ stderr: 'Error fetching login page data', exitCode: 1 });
      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(OzCliError);
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.CLI_ERROR);
      }
    });

    it('detects "out of credits" as INSUFFICIENT_CREDITS', async () => {
      createMockProcess({ stderr: 'Error: account is out of credits', exitCode: 1 });
      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(OzCliError);
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.INSUFFICIENT_CREDITS);
      }
    });

    it('does NOT classify exit 402 without a credits message as INSUFFICIENT_CREDITS', async () => {
      // Warp’s insufficient_credits is documented as HTTP 403 with a
      // canonical "add-on credits" body. A bare 402 is NOT enough to
      // claim the user is out of credits — surface CLI_ERROR instead.
      createMockProcess({ stderr: 'HTTP 402', exitCode: 402 });
      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should throw');
      } catch (err) {
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.CLI_ERROR);
        expect((err as OzCliError).exitCode).toBe(402);
      }
    });

    it('detects 403 with "add-on credits" as INSUFFICIENT_CREDITS', async () => {
      createMockProcess({
        stderr: 'HTTP 403: Your team has run out of add-on credits.',
        exitCode: 403,
      });
      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should throw');
      } catch (err) {
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.INSUFFICIENT_CREDITS);
      }
    });

    it('returns CLI_ERROR for a generic non-zero exit code', async () => {
      createMockProcess({ stderr: 'Unknown error', exitCode: 2 });
      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should throw');
      } catch (err) {
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.CLI_ERROR);
        expect((err as OzCliError).exitCode).toBe(2);
      }
    });

    it('uses shell: true on Windows, false elsewhere (.cmd compat)', async () => {
      createMockProcess({ stdout: '{}' });
      await cli.agentRun({ prompt: 'test' });
      const options = mockSpawn.mock.calls[0][2] as any;
      // resolveOzPath falls back to 'oz' when execFileSync is mocked to throw.
      // 'oz' does not end in .exe, so needsShell = true on Windows, false elsewhere.
      const expected = process.platform === 'win32';
      expect(options.shell).toBe(expected);
    });

    it('sets windowsHide: true', async () => {
      createMockProcess({ stdout: '{}' });
      await cli.agentRun({ prompt: 'test' });
      const options = mockSpawn.mock.calls[0][2] as any;
      expect(options.windowsHide).toBe(true);
    });

    it('fails closed (no spawn) when a shell spawn would receive a newline on Windows', async () => {
      // ozPath resolves to bare 'oz' (execFileSync mocked to throw) → on win32
      // needsShell=true. A newline in the prompt would split the cmd.exe line.
      const spy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      try {
        await expect(cli.agentRun({ prompt: 'do x\nthen calc.exe' }))
          .rejects.toMatchObject({ kind: OzCliErrorKind.CLI_ERROR });
        expect(mockSpawn).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  });

  // =========================================================================
  // parseStatus() (indirectly via toRunResult)
  // =========================================================================
  describe('status parsing', () => {
    it('parses QUEUED', async () => {
      createMockProcess({ stdout: '{"status":"QUEUED"}' });
      expect((await cli.agentRun({ prompt: 't' })).status).toBe('QUEUED');
    });

    it('parses INPROGRESS', async () => {
      createMockProcess({ stdout: '{"status":"INPROGRESS"}' });
      expect((await cli.agentRun({ prompt: 't' })).status).toBe('INPROGRESS');
    });

    it('maps an unknown status to UNKNOWN', async () => {
      createMockProcess({ stdout: '{"status":"WTFSTATUS"}' });
      expect((await cli.agentRun({ prompt: 't' })).status).toBe('UNKNOWN');
    });

    it('maps a non-string status to UNKNOWN', async () => {
      createMockProcess({ stdout: '{"status":42}' });
      expect((await cli.agentRun({ prompt: 't' })).status).toBe('UNKNOWN');
    });

    it('is case-insensitive (lowercase → uppercase)', async () => {
      createMockProcess({ stdout: '{"status":"succeeded"}' });
      expect((await cli.agentRun({ prompt: 't' })).status).toBe('SUCCEEDED');
    });
  });

  // =========================================================================
  // toListResult() — wrapped object to array
  // =========================================================================
  // =========================================================================
  // Discovery methods — scheduleList, profileList, environmentList, integrationList
  // =========================================================================
  describe('scheduleList()', () => {
    it('returns the schedule list', async () => {
      createMockProcess({ stdout: '[{"id":"s1","name":"daily","cron":"0 9 * * *","paused":false}]' });
      const result = await cli.scheduleList();
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toHaveProperty('name', 'daily');
    });
  });

  describe('profileList()', () => {
    it('returns the profile list', async () => {
      createMockProcess({ stdout: '[{"id":"p1","name":"Default"}]' });
      const result = await cli.profileList();
      expect(result.items).toHaveLength(1);
    });
  });

  describe('environmentList()', () => {
    it('returns the environment list', async () => {
      createMockProcess({ stdout: '[{"id":"e1","name":"staging"}]' });
      const result = await cli.environmentList();
      expect(result.items).toHaveLength(1);
    });
  });

  describe('integrationList()', () => {
    it('returns the integration list', async () => {
      createMockProcess({ stdout: '[{"provider":"GitHub","status":"Connected"}]' });
      const result = await cli.integrationList();
      expect(result.items).toHaveLength(1);
    });
  });

  // =========================================================================
  // toListResult() edge cases
  // =========================================================================
  describe('toListResult() edge cases', () => {
    it('wraps a single object in an array', async () => {
      createMockProcess({ stdout: '{"id":"single"}' });
      const result = await cli.modelList();
      expect(result.items).toHaveLength(1);
    });

    it('returns rawText undefined when stdout is empty', async () => {
      createMockProcess({ stdout: '' });
      const result = await cli.modelList();
      expect(result.items).toHaveLength(0);
      expect(result.rawText).toBeUndefined();
    });
  });

  // =========================================================================
  // NDJSON parsing (oz agent run outputs newline-delimited JSON events)
  // =========================================================================
  describe('NDJSON agent run parsing', () => {
    const NDJSON_SUCCEEDED = [
      '{"type":"system","event_type":"conversation_started","conversation_id":"abc-123"}',
      '{"type":"agent","text":"Let me check the file.\\n"}',
      '{"type":"tool_call","tool":"read_files","files":[{"path":"main.ts"}]}',
      '{"type":"tool_result","tool":"read_files","status":"complete","output":"..."}',
      '{"type":"agent","text":"This file implements the main entry point.\\n"}',
    ].join('\n');

    const NDJSON_WITH_ERROR = [
      '{"type":"system","event_type":"conversation_started","conversation_id":"err-456"}',
      '{"type":"agent","text":"I will try to run the command.\\n"}',
      '{"type":"tool_call","tool":"run_command","command":"npm test"}',
      '{"type":"tool_result","tool":"run_command","status":"error","output":"ENOENT"}',
    ].join('\n');

    it('parses NDJSON and returns SUCCEEDED', async () => {
      createMockProcess({ stdout: NDJSON_SUCCEEDED });
      const result = await cli.agentRun({ prompt: 'explain this file' });
      expect(result.status).toBe('SUCCEEDED');
      expect(result.runId).toBe('abc-123');
      expect(result.output).toContain('Let me check the file.');
      expect(result.output).toContain('This file implements the main entry point.');
    });

    it('extracts only the agent texts as output', async () => {
      createMockProcess({ stdout: NDJSON_SUCCEEDED });
      const result = await cli.agentRun({ prompt: 'explain' });
      // Should NOT contain tool_call/tool_result raw JSON
      expect(result.output).not.toContain('tool_call');
      expect(result.output).not.toContain('tool_result');
    });

    it('detects errors in tool_result', async () => {
      createMockProcess({ stdout: NDJSON_WITH_ERROR });
      const result = await cli.agentRun({ prompt: 'run tests' });
      expect(result.status).toBe('FAILED');
      expect(result.runId).toBe('err-456');
    });

    it('keeps conversation_id as runId', async () => {
      createMockProcess({ stdout: NDJSON_SUCCEEDED });
      const result = await cli.agentRun({ prompt: 'test' });
      expect(result.runId).toBe('abc-123');
    });

    it('keeps the events in the raw field', async () => {
      createMockProcess({ stdout: NDJSON_SUCCEEDED });
      const result = await cli.agentRun({ prompt: 'test' });
      expect(result.raw).toHaveProperty('events');
      expect((result.raw as any).events).toHaveLength(5);
    });

    it('falls back to single-JSON when there is only one line', async () => {
      createMockProcess({ stdout: '{"status":"SUCCEEDED","output":"done"}' });
      const result = await cli.agentRun({ prompt: 'test' });
      expect(result.status).toBe('SUCCEEDED');
      expect(result.output).toBe('done');
    });
  });

  // =========================================================================
  // runGet() — arg shape regression (issue: was passing --id instead of
  // positional argument, causing warp CLI to exit with code 2)
  // =========================================================================
  describe('runGet() — argument shape', () => {
    it('passes runId as a positional argument (not --id)', async () => {
      createMockProcess({ stdout: '{"id":"uuid-abc","status":"SUCCEEDED"}' });
      await cli.runGet('uuid-abc');
      const args = mockSpawn.mock.calls[0][1] as string[];
      // Positional: ['run', 'get', 'uuid-abc', '--output-format', 'json']
      expect(args[2]).toBe('uuid-abc');
      expect(args).not.toContain('--id');
    });
  });

  // =========================================================================
  // schedule pause/unpause/delete — arg shape regression
  // (upstream warpdotdev/warp uses positional `schedule_id`, not `--id`).
  // Passing `--id` makes the upstream CLI exit with `unexpected argument`.
  // =========================================================================
  describe('schedulePause/Unpause/Delete — argument shape', () => {
    it('schedulePause passes the ID as a positional argument', async () => {
      createMockProcess();
      await cli.schedulePause('sched-1');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toEqual(['schedule', 'pause', 'sched-1']);
      expect(args).not.toContain('--id');
    });

    it('scheduleUnpause passes the ID as a positional argument', async () => {
      createMockProcess();
      await cli.scheduleUnpause('sched-2');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toEqual(['schedule', 'unpause', 'sched-2']);
      expect(args).not.toContain('--id');
    });

    it('scheduleDelete passes the ID as a positional argument', async () => {
      createMockProcess();
      await cli.scheduleDelete('sched-3');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toEqual(['schedule', 'delete', 'sched-3']);
      expect(args).not.toContain('--id');
    });
  });

  // =========================================================================
  // agentRunCloud() — banner UUID extraction and id normalization
  // (issue: runId mismatch between chat banner and sidebar)
  // =========================================================================
  describe('agentRunCloud() — banner UUID precedence', () => {
    it('prefers the run ID from the CLI banner over the JSON id', async () => {
      // Simulate CLI emitting both a banner line and a JSON id that differ
      const stdout =
        'Spawned ambient agent with run ID: BANNER-UUID-001\n' +
        '{"id":"JSON-UUID-999","status":"INPROGRESS"}';
      createMockProcess({ stdout });
      const result = await cli.agentRunCloud({ prompt: 'test' });
      // Banner UUID wins, normalized to lowercase
      expect(result.runId).toBe('banner-uuid-001');
    });

    it('normalizes the banner run ID to lowercase', async () => {
      createMockProcess({
        stdout: 'Spawned ambient agent with run ID: UPPER-CASE-ID\n{"status":"INPROGRESS"}',
      });
      const result = await cli.agentRunCloud({ prompt: 'test' });
      expect(result.runId).toBe('upper-case-id');
    });

    it('uses the JSON id when there is no banner', async () => {
      createMockProcess({ stdout: '{"id":"json-only-id","status":"INPROGRESS"}' });
      const result = await cli.agentRunCloud({ prompt: 'test' });
      expect(result.runId).toBe('json-only-id');
    });

    it('extracts the banner even when the text is in stderr', async () => {
      createMockProcess({
        stdout: '{"id":"json-id","status":"INPROGRESS"}',
        stderr: 'Spawned ambient agent with run ID: stderr-uuid-42',
      });
      const result = await cli.agentRunCloud({ prompt: 'test' });
      expect(result.runId).toBe('stderr-uuid-42');
    });
  });

  // =========================================================================
  // extractCloudBannerRunId() — static helper
  // =========================================================================
  describe('OzCliService.extractCloudBannerRunId()', () => {
    it('extracts the ID from the classic banner', () => {
      const id = OzCliService.extractCloudBannerRunId(
        'Spawned ambient agent with run ID: abc-def-123',
      );
      expect(id).toBe('abc-def-123');
    });

    it('is case-insensitive', () => {
      const id = OzCliService.extractCloudBannerRunId(
        'SPAWNED AMBIENT AGENT WITH RUN ID: MyRunId',
      );
      expect(id).toBe('myrunid');
    });

    it('returns null when the banner is not present', () => {
      expect(OzCliService.extractCloudBannerRunId('{"id":"no-banner"}')).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(OzCliService.extractCloudBannerRunId('')).toBeNull();
    });
  });

  // =========================================================================
  // WARP_OUTPUT_FORMAT env propagation (replaces repeated --output-format)
  // =========================================================================
  describe('WARP_OUTPUT_FORMAT env propagation', () => {
    it('sets WARP_OUTPUT_FORMAT=json for list commands', async () => {
      createMockProcess({ stdout: '[]' });
      await cli.runList();
      const opts = mockSpawn.mock.calls[0][2] as { env?: Record<string, string> };
      expect(opts.env?.WARP_OUTPUT_FORMAT).toBe('json');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).not.toContain('--output-format');
    });

    it('does NOT set WARP_OUTPUT_FORMAT for --help (checkAvailability)', async () => {
      createMockProcess({ stdout: 'usage: oz...' });
      await cli.checkAvailability();
      const opts = mockSpawn.mock.calls[0][2] as { env?: Record<string, string> };
      expect(opts.env?.WARP_OUTPUT_FORMAT).toBeUndefined();
    });

    it('does NOT set WARP_OUTPUT_FORMAT for driveGet (raw markdown)', async () => {
      createMockProcess({ stdout: '# Markdown body' });
      await cli.driveGet('drive-1');
      const opts = mockSpawn.mock.calls[0][2] as { env?: Record<string, string> };
      expect(opts.env?.WARP_OUTPUT_FORMAT).toBeUndefined();
    });

    it('buildChildEnv strips sensitive keys', () => {
      const env = OzCliService.buildChildEnv('json', {
        PATH: '/usr/bin',
        GITHUB_TOKEN: 'ghp_secret',
        OPENAI_API_KEY: 'sk-secret',
        WARP_API_KEY: 'warp-keep-me',
      } as NodeJS.ProcessEnv);
      expect(env.PATH).toBe('/usr/bin');
      expect(env.WARP_API_KEY).toBe('warp-keep-me');
      expect(env.GITHUB_TOKEN).toBeUndefined();
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.WARP_OUTPUT_FORMAT).toBe('json');
    });

    it('buildChildEnv with outputFormat=null does not set WARP_OUTPUT_FORMAT', () => {
      const env = OzCliService.buildChildEnv(null, { PATH: '/usr/bin' } as NodeJS.ProcessEnv);
      expect(env.WARP_OUTPUT_FORMAT).toBeUndefined();
    });

    it('buildChildEnv(null) strips an inherited WARP_OUTPUT_FORMAT (raw-output callers)', () => {
      const env = OzCliService.buildChildEnv(null, {
        PATH: '/usr/bin', WARP_OUTPUT_FORMAT: 'json',
      } as NodeJS.ProcessEnv);
      expect(env.WARP_OUTPUT_FORMAT).toBeUndefined();
    });

    it('buildChildEnv with outputFormat=ndjson sets it', () => {
      const env = OzCliService.buildChildEnv('ndjson', { PATH: '/usr/bin' } as NodeJS.ProcessEnv);
      expect(env.WARP_OUTPUT_FORMAT).toBe('ndjson');
    });
  });

  // =========================================================================
  // --jq <FILTER> opt-in passthrough on read-only methods
  // =========================================================================
  describe('--jq filter passthrough', () => {
    it('runList propagates --jq when provided', async () => {
      createMockProcess({ stdout: '[]' });
      await cli.runList({ jq: '.runs[].id' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--jq');
      expect(args[args.indexOf('--jq') + 1]).toBe('.runs[].id');
    });

    it('runGet propagates --jq', async () => {
      createMockProcess({ stdout: '{"id":"r1"}' });
      await cli.runGet('r1', { jq: '.status' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--jq');
      expect(args[args.indexOf('--jq') + 1]).toBe('.status');
    });

    it('integrationList propagates --jq', async () => {
      createMockProcess({ stdout: '[]' });
      await cli.integrationList({ jq: '.[].name' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--jq');
    });

    it('rejects a jq filter with shell metacharacters', async () => {
      await expect(cli.runList({ jq: '. ; rm -rf /' })).rejects.toThrow(/Invalid jq filter/);
      await expect(cli.runList({ jq: '. && evil' })).rejects.toThrow(/Invalid jq filter/);
      await expect(cli.runList({ jq: '. > out' })).rejects.toThrow(/Invalid jq filter/);
      await expect(cli.runList({ jq: '$(evil)' })).rejects.toThrow(/Invalid jq filter/);
      await expect(cli.runList({ jq: '`evil`' })).rejects.toThrow(/Invalid jq filter/);
    });

    it('accepts legitimate jq filters with pipes internal to jq', async () => {
      createMockProcess({ stdout: '[]' });
      // jq uses `|` as its internal pipe operator; it must be allowed
      await cli.runList({ jq: '.runs[] | select(.status=="SUCCEEDED") | .id' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--jq');
    });
  });

  // =========================================================================
  // integrationList fallback for feature-flagged subcommand
  // =========================================================================
  describe('integrationList() — feature-flag fallback', () => {
    it('returns empty items when the CLI emits "unrecognized subcommand"', async () => {
      createMockProcess({
        exitCode: 2,
        stderr: "error: unrecognized subcommand 'integration'",
      });
      const result = await cli.integrationList();
      expect(result.items).toEqual([]);
    });

    it('returns empty items for "unknown subcommand"', async () => {
      createMockProcess({
        exitCode: 2,
        stderr: 'error: unknown subcommand integration',
      });
      const result = await cli.integrationList();
      expect(result.items).toEqual([]);
    });

    it('propagates real errors (unrelated to the feature flag)', async () => {
      createMockProcess({ exitCode: 1, stderr: 'unauthorized' });
      await expect(cli.integrationList()).rejects.toThrow(OzCliError);
    });
  });

  // =========================================================================
  // agentRun() ndjson streaming via onProgress callback
  // =========================================================================
  describe('agentRun() — onProgress streaming (json mode)', () => {
    it('uses WARP_OUTPUT_FORMAT=json (NOT ndjson) even with onProgress, and still streams every line', async () => {
      // Regression: ndjson mode makes warp.exe follow the run and never exit
      // (hang). json mode emits the same incremental lines but exits cleanly,
      // so we must request json and still forward each line to onProgress.
      createMockProcess({
        stdout:
          '{"type":"system","event_type":"conversation_started","conversation_id":"c-1"}\n' +
          '{"type":"agent","text":"hello"}\n' +
          '{"type":"agent","text":"done"}\n',
      });
      const events: string[] = [];
      await cli.agentRun({ prompt: 'go', onProgress: (line) => events.push(line) });

      const opts = mockSpawn.mock.calls[0][2] as { env?: Record<string, string> };
      expect(opts.env?.WARP_OUTPUT_FORMAT).toBe('json');
      // All 3 NDJSON lines must still reach the progress callback.
      expect(events).toHaveLength(3);
      expect(events[0]).toContain('"conversation_started"');
      expect(events[1]).toContain('"hello"');
      expect(events[2]).toContain('"done"');
    });

    it('uses json (not ndjson) without onProgress', async () => {
      createMockProcess({ stdout: '{"status":"SUCCEEDED"}' });
      await cli.agentRun({ prompt: 'go' });
      const opts = mockSpawn.mock.calls[0][2] as { env?: Record<string, string> };
      expect(opts.env?.WARP_OUTPUT_FORMAT).toBe('json');
    });

    it('errors in the onProgress callback do not block the run', async () => {
      createMockProcess({
        stdout:
          '{"type":"system","event_type":"conversation_started","conversation_id":"c-1"}\n' +
          '{"type":"agent","text":"ok"}\n',
      });
      const result = await cli.agentRun({
        prompt: 'go',
        onProgress: () => { throw new Error('UI bug'); },
      });
      expect(result.exitCode).toBe(0);
    });

    it('stops onProgress after the stdout cap (OZ-mem)', async () => {
      const proc = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: vi.fn(),
        pid: 9999,
      });
      mockSpawn.mockReturnValue(proc as any);

      process.nextTick(() => {
        proc.stdout.emit('data', Buffer.from('x'.repeat(10 * 1024 * 1024 - 1)));
        proc.stdout.emit('data', Buffer.from('y\n{"type":"agent","text":"after-cap"}\n'));
        proc.emit('close', 0);
      });

      let callbackCount = 0;
      let sawDiscardedLine = false;
      await cli.agentRun({
        prompt: 'go',
        onProgress: (line) => {
          callbackCount += 1;
          sawDiscardedLine ||= line.includes('after-cap');
        },
      });

      expect(callbackCount).toBe(1);
      expect(sawDiscardedLine).toBe(false);
    });
  });

  // =========================================================================
  // isUnrecognizedSubcommandError() — static helper
  // =========================================================================
  describe('OzCliService.isUnrecognizedSubcommandError()', () => {
    it('recognizes "unrecognized subcommand"', () => {
      const err = new OzCliError(OzCliErrorKind.CLI_ERROR, "unrecognized subcommand 'foo'", 2, '');
      expect(OzCliService.isUnrecognizedSubcommandError(err)).toBe(true);
    });
    it('recognizes "unknown command"', () => {
      const err = new OzCliError(OzCliErrorKind.CLI_ERROR, 'x', 2, 'error: unknown command bar');
      expect(OzCliService.isUnrecognizedSubcommandError(err)).toBe(true);
    });
    it('does not recognize generic errors', () => {
      const err = new OzCliError(OzCliErrorKind.CLI_ERROR, 'network failure', 1, '');
      expect(OzCliService.isUnrecognizedSubcommandError(err)).toBe(false);
    });
    it('does not recognize errors of another kind (e.g. NOT_AUTHENTICATED)', () => {
      const err = new OzCliError(OzCliErrorKind.NOT_AUTHENTICATED, 'unrecognized subcommand', 1, '');
      expect(OzCliService.isUnrecognizedSubcommandError(err)).toBe(false);
    });
  });

  // =========================================================================
  // scheduleGet / scheduleUpdate
  // =========================================================================
  describe('scheduleGet()', () => {
    it('rejects an invalid ID', async () => {
      await expect(cli.scheduleGet('bad id!')).rejects.toThrow('Invalid schedule id');
    });

    it('returns the parsed schedule', async () => {
      createMockProcess({
        stdout: JSON.stringify({ id: 's1', name: 'daily', cron: '0 9 * * *', prompt: 'lint', paused: false }),
      });
      const r = await cli.scheduleGet('s1');
      expect(r.id).toBe('s1');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toEqual(['schedule', 'get', 's1']);
    });

    it('throws PARSE_ERROR on unparseable output', async () => {
      createMockProcess({ stdout: 'not json' });
      await expect(cli.scheduleGet('s1')).rejects.toThrow(OzCliError);
    });
  });

  describe('scheduleUpdate()', () => {
    it('rejects an invalid ID', async () => {
      await expect(cli.scheduleUpdate({ id: 'bad id!' })).rejects.toThrow('Invalid schedule id');
    });

    it('sends only the specified fields', async () => {
      createMockProcess({
        stdout: JSON.stringify({ id: 's1', name: 'new-name', cron: '0 9 * * *', prompt: 'p', paused: false }),
      });
      await cli.scheduleUpdate({ id: 's1', name: 'new-name' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args.slice(0, 3)).toEqual(['schedule', 'update', 's1']);
      expect(args).toContain('--name');
      expect(args).toContain('new-name');
      expect(args).not.toContain('--cron');
      expect(args).not.toContain('-p');
    });

    it('supports --remove-environment / --remove-skill', async () => {
      createMockProcess({
        stdout: JSON.stringify({ id: 's1', name: 'n', cron: '0 9 * * *', prompt: 'p', paused: false }),
      });
      await cli.scheduleUpdate({ id: 's1', removeEnvironment: true, removeSkill: true });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--remove-environment');
      expect(args).toContain('--remove-skill');
    });

    it('rejects a cron with invalid characters', async () => {
      await expect(
        cli.scheduleUpdate({ id: 's1', cron: '0 9 * * *; rm -rf /' }),
      ).rejects.toThrow('Invalid cron expression');
    });
  });

  // =========================================================================
  // artifactGet / artifactDownload + normalizeArtifact
  // =========================================================================
  describe('artifactGet()', () => {
    it('rejects an invalid uid', async () => {
      await expect(cli.artifactGet('bad uid!')).rejects.toThrow('Invalid artifact uid');
    });

    it('normalizes the alternative keys', async () => {
      createMockProcess({
        stdout: JSON.stringify({ id: 'a1', filename: 'log.txt', mime_type: 'text/plain', size: 42, runId: 'r1' }),
      });
      const r = await cli.artifactGet('a1');
      expect(r.uid).toBe('a1');
      expect(r.name).toBe('log.txt');
      expect(r.contentType).toBe('text/plain');
      expect(r.sizeBytes).toBe(42);
      expect(r.runId).toBe('r1');
    });

    it('uses the passed uid when it is missing from the payload', async () => {
      createMockProcess({ stdout: JSON.stringify({ name: 'x' }) });
      const r = await cli.artifactGet('a-fallback');
      expect(r.uid).toBe('a-fallback');
    });

    it('throws PARSE_ERROR on unparseable output', async () => {
      createMockProcess({ stdout: 'nope' });
      await expect(cli.artifactGet('a1')).rejects.toThrow(OzCliError);
    });
  });

  describe('artifactDownload()', () => {
    it('rejects an invalid uid', async () => {
      await expect(cli.artifactDownload('bad uid!', '/tmp/out')).rejects.toThrow('Invalid artifact uid');
    });

    it('rejects an empty outPath', async () => {
      await expect(cli.artifactDownload('a1', '')).rejects.toThrow(/Invalid outPath/);
      await expect(cli.artifactDownload('a1', '   ')).rejects.toThrow(/Invalid outPath/);
    });

    it('rejects an outPath with a NUL byte', async () => {
      await expect(cli.artifactDownload('a1', '/tmp/x\u0000bad')).rejects.toThrow(/NUL byte/);
    });

    it('calls the CLI with -o and returns outPath', async () => {
      createMockProcess({ stdout: '' });
      const result = await cli.artifactDownload('a1', '/tmp/out.bin');
      expect(result).toBe('/tmp/out.bin');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toEqual(['artifact', 'download', 'a1', '-o', '/tmp/out.bin']);
    });
  });

  // =========================================================================
  // Secrets — argv must never contain the value (stdin only)
  // =========================================================================
  describe('secret*()', () => {
    function createMockProcessWithStdin(opts: { stdout?: string; exitCode?: number } = {}) {
      const stdinWrites: string[] = [];
      const stdin = {
        write: vi.fn((chunk: string | Buffer) => {
          stdinWrites.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
          return true;
        }),
        end: vi.fn(),
      };
      const proc = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        stdin,
        kill: vi.fn(),
        pid: 9999,
      });
      mockSpawn.mockReturnValue(proc as any);
      process.nextTick(() => {
        if (opts.stdout) { proc.stdout.emit('data', Buffer.from(opts.stdout)); }
        proc.emit('close', opts.exitCode ?? 0);
      });
      return { proc, stdin, stdinWrites };
    }

    it('secretList calls `secret list`', async () => {
      createMockProcess({ stdout: '[]' });
      const r = await cli.secretList();
      expect(r.items).toEqual([]);
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toEqual(['secret', 'list']);
    });

    it('secretList propagates --jq', async () => {
      createMockProcess({ stdout: '[]' });
      await cli.secretList({ jq: '.[].name' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--jq');
    });

    it('secretCreate does NOT put the value in argv (stdin only)', async () => {
      const { stdinWrites } = createMockProcessWithStdin({ stdout: '' });
      await cli.secretCreate({ name: 'API_KEY', value: 'super-secret-VALUE' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toEqual(['secret', 'create', 'API_KEY', '-t', 'raw-value']);
      expect(stdinWrites.join('')).toBe('super-secret-VALUE');
      for (const a of args) {
        expect(a).not.toContain('super-secret-VALUE');
      }
    });

    it('secretCreate rejects invalid names', async () => {
      await expect(cli.secretCreate({ name: 'bad;name', value: 'v' })).rejects.toThrow('Invalid secret name');
    });

    it('secretCreate rejects an empty value', async () => {
      await expect(cli.secretCreate({ name: 'N', value: '' })).rejects.toThrow(/cannot be empty/);
    });

    it('secretCreate propagates --team / -d', async () => {
      createMockProcessWithStdin({ stdout: '' });
      await cli.secretCreate({ name: 'N', value: 'v', description: 'desc', scope: 'team' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--team');
      expect(args).toContain('-d');
      expect(args).toContain('desc');
    });

    it('secretUpdate with value uses --value and pipes via stdin', async () => {
      const { stdinWrites } = createMockProcessWithStdin({ stdout: '' });
      await cli.secretUpdate({ name: 'N', value: 'new-value' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--value');
      expect(args).not.toContain('new-value');
      expect(stdinWrites.join('')).toBe('new-value');
    });

    it('secretUpdate with only description does NOT use --value and pipes nothing', async () => {
      const { stdinWrites } = createMockProcessWithStdin({ stdout: '' });
      await cli.secretUpdate({ name: 'N', description: 'new desc' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).not.toContain('--value');
      expect(args).toContain('-d');
      expect(args).toContain('new desc');
      expect(stdinWrites.length).toBe(0);
    });

    it('secretUpdate requires at least value or description', async () => {
      await expect(cli.secretUpdate({ name: 'N' })).rejects.toThrow(/value or description/);
    });

    it('secretDelete always passes --force', async () => {
      createMockProcess({ stdout: '' });
      await cli.secretDelete('API_KEY');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toEqual(['secret', 'delete', 'API_KEY', '--force']);
    });

    it('secretDelete propagates scope personal', async () => {
      createMockProcess({ stdout: '' });
      await cli.secretDelete('K', { scope: 'personal' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--personal');
    });
  });
});

// ===========================================================================
// Read-only JSON command that prints output but never exits (Warp run-list
// hang). Repro: this Warp CLI version prints the full JSON for `run list` /
// `run get` etc. but the spawned process never terminates, so exec() waited
// for a `close` event that never fired until the 90s idle timer wrongly
// reported STALLED ("OzBridge: unavailable", dashboard "no output for 90s").
// exec() must resolve as soon as stdout is a complete JSON value and reap the
// lingering child instead of waiting for an exit that never comes.
// ===========================================================================
describe('OzCliService — read-only JSON command that never exits', () => {
  function createHangingProcess() {
    const proc = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
      pid: 4242,
    });
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);
    return proc;
  }

  it('runList resolves on complete JSON and reaps the process (no close event)', async () => {
    const proc = createHangingProcess();
    process.nextTick(() => {
      // Full envelope arrives in one burst, then the process hangs forever.
      proc.stdout.emit('data', Buffer.from('{"runs":[{"id":"run-1","status":"SUCCEEDED"}]}'));
    });
    const result = await cli.runList();
    expect(result.items).toEqual([{ id: 'run-1', status: 'SUCCEEDED' }]);
    expect(proc.kill).toHaveBeenCalled();
  });

  it('runGet resolves on a complete JSON object without a close event', async () => {
    const proc = createHangingProcess();
    process.nextTick(() => {
      proc.stdout.emit('data', Buffer.from('{"id":"run-9","status":"FAILED","output":"boom"}'));
    });
    const result = await cli.runGet('run-9');
    expect(result.status).toBe('FAILED');
    expect(proc.kill).toHaveBeenCalled();
  });

  it('assembles chunked JSON across multiple data events before resolving', async () => {
    const proc = createHangingProcess();
    process.nextTick(() => {
      proc.stdout.emit('data', Buffer.from('{"runs":[')); // incomplete — must not resolve yet
      process.nextTick(() => {
        proc.stdout.emit('data', Buffer.from('{"id":"run-2","status":"QUEUED"}]}'));
      });
    });
    const result = await cli.runList();
    expect(result.items).toEqual([{ id: 'run-2', status: 'QUEUED' }]);
  });

  it('fails fast with NOT_AUTHENTICATED on an auth error in stderr (process never closes)', async () => {
    const proc = createHangingProcess();
    process.nextTick(() => {
      // Warp prints the auth error to stderr then hangs forever.
      proc.stderr.emit('data', Buffer.from('Authentication failed: Failed to fetch user response data\n'));
    });
    await expect(cli.runList()).rejects.toMatchObject({ kind: OzCliErrorKind.NOT_AUTHENTICATED });
    expect(proc.kill).toHaveBeenCalled();
  });

  it('scheduleCreate resolves on complete JSON when warp emits it but never exits', async () => {
    const proc = createHangingProcess();
    process.nextTick(() => {
      proc.stdout.emit('data', Buffer.from(
        '{"id":"s-1","name":"daily","cron":"0 9 * * *","prompt":"lint","paused":false}',
      ));
    });
    const r = await cli.scheduleCreate({ name: 'daily', cron: '0 9 * * *', prompt: 'lint' });
    expect(r.id).toBe('s-1');
    expect(proc.kill).toHaveBeenCalled();
  });

  it('salvages a streaming agent run answer when warp emits the reply but never exits', async () => {
    vi.useFakeTimers();
    try {
      const proc = createHangingProcess();
      const events: string[] = [];
      const p = cli.agentRun({ prompt: 'go', onProgress: (l) => events.push(l) });
      await Promise.resolve(); // let exec() register its stdout listeners
      // Warp streams run_started + the agent reply, then hangs (no `close`).
      proc.stdout.emit('data', Buffer.from(
        '{"type":"system","event_type":"run_started","run_id":"r1"}\n'
        + '{"type":"agent","text":"DONE-ANSWER"}\n',
      ));
      // Advance past the completion grace (8s) — no idle/global timeout yet.
      await vi.advanceTimersByTimeAsync(9_000);
      const result = await p;
      expect(result.status).toBe('SUCCEEDED');
      expect(result.output).toContain('DONE-ANSWER');
      expect(events).toHaveLength(2);
      expect(proc.kill).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
