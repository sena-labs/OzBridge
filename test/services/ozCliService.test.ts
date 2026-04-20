import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { OzCliService } from '../../src/services/ozCliService.js';
import { OzCliError, OzCliErrorKind, DEFAULT_CONFIG } from '../../src/types/index.js';
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
// Helper: crea un processo mock che emette stdout/stderr e chiude
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

  // Emetti eventi in modo asincrono (dopo che exec() ha registrato i listener)
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
    it('dovrebbe tornare available=true quando --help riesce', async () => {
      createMockProcess({ stdout: 'Usage: oz <COMMAND>\n' });
      const result = await cli.checkAvailability();
      expect(result.available).toBe(true);
      expect(result.version).toBeNull();
      expect(result.path).toBe('oz');
    });

    it('dovrebbe tornare available=false se spawn fallisce', async () => {
      createMockProcess({ error: new Error('ENOENT: not found') });
      const result = await cli.checkAvailability();
      expect(result.available).toBe(false);
      expect(result.version).toBeNull();
    });

    it('dovrebbe tornare available=true anche se stdout è vuoto', async () => {
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
    it('dovrebbe eseguire agent run con prompt e parsare risultato JSON', async () => {
      createMockProcess({
        stdout: JSON.stringify({ id: 'run-1', status: 'SUCCEEDED', output: 'Result' }),
      });

      const result = await cli.agentRun({ prompt: 'fix the bug' });

      expect(result.runId).toBe('run-1');
      expect(result.status).toBe('SUCCEEDED');
      expect(result.output).toBe('Result');
      expect(result.exitCode).toBe(0);

      // Verifica args passati a spawn
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('agent');
      expect(args).toContain('run');
      expect(args).toContain('-p');
      expect(args).toContain('fix the bug');
      expect(args).toContain('--output-format');
      expect(args).toContain('json');
    });

    it('dovrebbe passare --model se specificato', async () => {
      createMockProcess({ stdout: '{"status":"SUCCEEDED"}' });
      await cli.agentRun({ prompt: 'test', model: 'gpt-4' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--model');
      expect(args).toContain('gpt-4');
    });

    it('dovrebbe passare --profile se specificato', async () => {
      createMockProcess({ stdout: '{"status":"SUCCEEDED"}' });
      await cli.agentRun({ prompt: 'test', profile: 'custom' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--profile');
      expect(args).toContain('custom');
    });

    it('dovrebbe passare --skill se specificato', async () => {
      createMockProcess({ stdout: '{"status":"SUCCEEDED"}' });
      await cli.agentRun({ prompt: 'test', skill: '1-spec-agent' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--skill');
      expect(args).toContain('1-spec-agent');
    });

    it('dovrebbe gestire output non-JSON (testo puro)', async () => {
      createMockProcess({ stdout: 'Plain text output from agent' });
      const result = await cli.agentRun({ prompt: 'hello' });
      expect(result.runId).toBeNull();
      expect(result.status).toBe('SUCCEEDED');
      expect(result.output).toBe('Plain text output from agent');
    });

    it('dovrebbe gestire run_id alternativo nel JSON', async () => {
      createMockProcess({ stdout: '{"run_id":"alt-123","status":"QUEUED"}' });
      const result = await cli.agentRun({ prompt: 'test' });
      expect(result.runId).toBe('alt-123');
    });

    it('dovrebbe impostare status FAILED per exit code non-zero con output testuale', async () => {
      createMockProcess({ stdout: 'Something went wrong', exitCode: 1, stderr: 'err' });
      await expect(cli.agentRun({ prompt: 'test' })).rejects.toThrow(OzCliError);
    });
  });

  // =========================================================================
  // agentRunCloud()
  // =========================================================================
  describe('agentRunCloud()', () => {
    it('dovrebbe eseguire run-cloud con parametri corretti', async () => {
      createMockProcess({ stdout: '{"id":"cloud-1","status":"QUEUED"}' });
      await cli.agentRunCloud({ prompt: 'deploy it', environment: 'prod' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('run-cloud');
      expect(args).toContain('-e');
      expect(args).toContain('prod');
    });

    it('dovrebbe passare --model se specificato', async () => {
      createMockProcess({ stdout: '{"status":"SUCCEEDED"}' });
      await cli.agentRunCloud({ prompt: 'test', model: 'gpt-4' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--model');
      expect(args).toContain('gpt-4');
    });

    it('dovrebbe passare --skill se specificato', async () => {
      createMockProcess({ stdout: '{"status":"SUCCEEDED"}' });
      await cli.agentRunCloud({ prompt: 'test', skill: '1-spec-agent' });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--skill');
      expect(args).toContain('1-spec-agent');
    });

    it('dovrebbe passare --no-environment se noEnvironment è true', async () => {
      createMockProcess({ stdout: '{"status":"SUCCEEDED"}' });
      await cli.agentRunCloud({ prompt: 'test', noEnvironment: true });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--no-environment');
      expect(args).not.toContain('-e');
    });

    it('dovrebbe preferire -e su --no-environment se entrambi forniti', async () => {
      createMockProcess({ stdout: '{"status":"SUCCEEDED"}' });
      await cli.agentRunCloud({ prompt: 'test', environment: 'prod', noEnvironment: true });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('-e');
      expect(args).toContain('prod');
      expect(args).not.toContain('--no-environment');
    });

    it('dovrebbe passare --open se open è true', async () => {
      createMockProcess({ stdout: '{"status":"SUCCEEDED"}' });
      await cli.agentRunCloud({ prompt: 'test', open: true });
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--open');
    });

    it('dovrebbe non passare --open se open non specificato', async () => {
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
    it('dovrebbe tornare lista di run', async () => {
      createMockProcess({ stdout: '[{"id":"r1","status":"SUCCEEDED"},{"id":"r2","status":"FAILED"}]' });
      const result = await cli.runList();
      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('r1');
    });

    it('dovrebbe gestire output "No runs found."', async () => {
      createMockProcess({ stdout: 'No runs found.' });
      const result = await cli.runList();
      expect(result.items).toHaveLength(0);
      expect(result.rawText).toBe('No runs found.');
    });
  });

  describe('runGet()', () => {
    it('dovrebbe ottenere dettaglio di un run', async () => {
      createMockProcess({ stdout: '{"id":"run-x","status":"SUCCEEDED","output":"done"}' });
      const result = await cli.runGet('run-x');
      expect(result.runId).toBe('run-x');
    });

    it('dovrebbe rifiutare ID con caratteri non validi (injection protection)', async () => {
      await expect(cli.runGet('id; rm -rf /')).rejects.toThrow(OzCliError);
      await expect(cli.runGet('id; rm -rf /')).rejects.toThrow('Invalid runId');
    });

    it('dovrebbe accettare ID alfanumerici con trattini e underscore', async () => {
      createMockProcess({ stdout: '{"id":"run_abc-123","status":"SUCCEEDED"}' });
      const result = await cli.runGet('run_abc-123');
      expect(result.runId).toBe('run_abc-123');
    });
  });

  // =========================================================================
  // Schedule methods
  // =========================================================================
  describe('scheduleCreate()', () => {
    it('dovrebbe creare uno schedule', async () => {
      createMockProcess({
        stdout: JSON.stringify({ id: 'sched-1', name: 'daily', cron: '0 9 * * *', prompt: 'lint', paused: false }),
      });
      const result = await cli.scheduleCreate({ name: 'daily', cron: '0 9 * * *', prompt: 'lint' });
      expect(result.id).toBe('sched-1');
      expect(result.name).toBe('daily');
    });

    it('dovrebbe lanciare se output non parsabile', async () => {
      createMockProcess({ stdout: 'Something unexpected' });
      await expect(cli.scheduleCreate({ name: 'x', cron: '* * * * *', prompt: 'y' }))
        .rejects.toThrow(OzCliError);
    });

    it('dovrebbe rifiutare nome con caratteri non validi (validateCliArg)', async () => {
      await expect(
        cli.scheduleCreate({ name: 'bad;name', cron: '0 9 * * *', prompt: 'lint' }),
      ).rejects.toThrow('Invalid schedule name');
    });

    it('dovrebbe passare --skill e -e se specificati', async () => {
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
    it('dovrebbe rifiutare ID non valido per pause', async () => {
      await expect(cli.schedulePause('bad id!')).rejects.toThrow('Invalid schedule id');
    });

    it('dovrebbe rifiutare ID non valido per unpause', async () => {
      await expect(cli.scheduleUnpause('x y')).rejects.toThrow('Invalid schedule id');
    });

    it('dovrebbe rifiutare ID non valido per delete', async () => {
      await expect(cli.scheduleDelete('../etc')).rejects.toThrow('Invalid schedule id');
    });

    it('dovrebbe accettare ID validi', async () => {
      createMockProcess();
      await cli.schedulePause('sched-1');
      expect(mockSpawn).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Discovery methods
  // =========================================================================
  describe('modelList()', () => {
    it('dovrebbe tornare lista modelli', async () => {
      createMockProcess({ stdout: '[{"id":"gpt-4"},{"id":"claude-3"}]' });
      const result = await cli.modelList();
      expect(result.items).toHaveLength(2);
    });
  });

  describe('mcpList()', () => {
    it('dovrebbe tornare lista server MCP', async () => {
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
    it('dovrebbe rilevare ENOENT come NOT_FOUND', async () => {
      createMockProcess({ error: new Error('ENOENT: spawn oz failed') });
      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(OzCliError);
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.NOT_FOUND);
      }
    });

    it('dovrebbe rilevare "not logged in" come NOT_AUTHENTICATED', async () => {
      createMockProcess({ stderr: 'Error: not logged in', exitCode: 1 });
      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(OzCliError);
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.NOT_AUTHENTICATED);
      }
    });

    it('dovrebbe rilevare "unauthorized" come NOT_AUTHENTICATED', async () => {
      createMockProcess({ stderr: 'Unauthorized access', exitCode: 1 });
      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should throw');
      } catch (err) {
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.NOT_AUTHENTICATED);
      }
    });

    // P1 fix: nuovi pattern di autenticazione
    it('dovrebbe rilevare "please log in" come NOT_AUTHENTICATED (P1)', async () => {
      createMockProcess({ stderr: 'Error: please log in to continue', exitCode: 1 });
      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(OzCliError);
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.NOT_AUTHENTICATED);
      }
    });

    it('dovrebbe rilevare "must log in" come NOT_AUTHENTICATED (P1)', async () => {
      createMockProcess({ stderr: 'You must log in before using this feature', exitCode: 1 });
      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(OzCliError);
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.NOT_AUTHENTICATED);
      }
    });

    it('dovrebbe NON rilevare "login" generico come NOT_AUTHENTICATED (P1 regression)', async () => {
      // "login" da solo non deve triggerare NOT_AUTHENTICATED — la fix P1 ha rimosso questo pattern
      createMockProcess({ stderr: 'Error fetching login page data', exitCode: 1 });
      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(OzCliError);
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.CLI_ERROR);
      }
    });

    it('dovrebbe rilevare "out of credits" come INSUFFICIENT_CREDITS', async () => {
      createMockProcess({ stderr: 'Error: account is out of credits', exitCode: 1 });
      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(OzCliError);
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.INSUFFICIENT_CREDITS);
      }
    });

    it('dovrebbe rilevare exit code 402 come INSUFFICIENT_CREDITS', async () => {
      createMockProcess({ stderr: 'HTTP 402', exitCode: 402 });
      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should throw');
      } catch (err) {
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.INSUFFICIENT_CREDITS);
      }
    });

    it('dovrebbe tornare CLI_ERROR per exit code non-zero generico', async () => {
      createMockProcess({ stderr: 'Unknown error', exitCode: 2 });
      try {
        await cli.agentRun({ prompt: 'test' });
        expect.fail('should throw');
      } catch (err) {
        expect((err as OzCliError).kind).toBe(OzCliErrorKind.CLI_ERROR);
        expect((err as OzCliError).exitCode).toBe(2);
      }
    });

    it('dovrebbe usare shell: true su Windows, false altrove (compat .cmd)', async () => {
      createMockProcess({ stdout: '{}' });
      await cli.agentRun({ prompt: 'test' });
      const options = mockSpawn.mock.calls[0][2] as any;
      // resolveOzPath falls back to 'oz' when execFileSync is mocked to throw.
      // 'oz' does not end in .exe, so needsShell = true on Windows, false elsewhere.
      const expected = process.platform === 'win32';
      expect(options.shell).toBe(expected);
    });

    it('dovrebbe impostare windowsHide: true', async () => {
      createMockProcess({ stdout: '{}' });
      await cli.agentRun({ prompt: 'test' });
      const options = mockSpawn.mock.calls[0][2] as any;
      expect(options.windowsHide).toBe(true);
    });
  });

  // =========================================================================
  // parseStatus() (indirettamente tramite toRunResult)
  // =========================================================================
  describe('status parsing', () => {
    it('dovrebbe parsare QUEUED', async () => {
      createMockProcess({ stdout: '{"status":"QUEUED"}' });
      expect((await cli.agentRun({ prompt: 't' })).status).toBe('QUEUED');
    });

    it('dovrebbe parsare INPROGRESS', async () => {
      createMockProcess({ stdout: '{"status":"INPROGRESS"}' });
      expect((await cli.agentRun({ prompt: 't' })).status).toBe('INPROGRESS');
    });

    it('dovrebbe mappare status sconosciuto a UNKNOWN', async () => {
      createMockProcess({ stdout: '{"status":"WTFSTATUS"}' });
      expect((await cli.agentRun({ prompt: 't' })).status).toBe('UNKNOWN');
    });

    it('dovrebbe mappare status non-stringa a UNKNOWN', async () => {
      createMockProcess({ stdout: '{"status":42}' });
      expect((await cli.agentRun({ prompt: 't' })).status).toBe('UNKNOWN');
    });

    it('dovrebbe gestire case-insensitive (lowercase → uppercase)', async () => {
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
    it('dovrebbe tornare lista schedule', async () => {
      createMockProcess({ stdout: '[{"id":"s1","name":"daily","cron":"0 9 * * *","paused":false}]' });
      const result = await cli.scheduleList();
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toHaveProperty('name', 'daily');
    });
  });

  describe('profileList()', () => {
    it('dovrebbe tornare lista profili', async () => {
      createMockProcess({ stdout: '[{"id":"p1","name":"Default"}]' });
      const result = await cli.profileList();
      expect(result.items).toHaveLength(1);
    });
  });

  describe('environmentList()', () => {
    it('dovrebbe tornare lista environments', async () => {
      createMockProcess({ stdout: '[{"id":"e1","name":"staging"}]' });
      const result = await cli.environmentList();
      expect(result.items).toHaveLength(1);
    });
  });

  describe('integrationList()', () => {
    it('dovrebbe tornare lista integrazioni', async () => {
      createMockProcess({ stdout: '[{"provider":"GitHub","status":"Connected"}]' });
      const result = await cli.integrationList();
      expect(result.items).toHaveLength(1);
    });
  });

  // =========================================================================
  // toListResult() edge cases
  // =========================================================================
  describe('toListResult() edge cases', () => {
    it('dovrebbe wrappare singolo oggetto in array', async () => {
      createMockProcess({ stdout: '{"id":"single"}' });
      const result = await cli.modelList();
      expect(result.items).toHaveLength(1);
    });

    it('dovrebbe tornare rawText undefined se stdout è vuoto', async () => {
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

    it('dovrebbe parsare NDJSON e restituire SUCCEEDED', async () => {
      createMockProcess({ stdout: NDJSON_SUCCEEDED });
      const result = await cli.agentRun({ prompt: 'explain this file' });
      expect(result.status).toBe('SUCCEEDED');
      expect(result.runId).toBe('abc-123');
      expect(result.output).toContain('Let me check the file.');
      expect(result.output).toContain('This file implements the main entry point.');
    });

    it('dovrebbe estrarre solo i testi agent come output', async () => {
      createMockProcess({ stdout: NDJSON_SUCCEEDED });
      const result = await cli.agentRun({ prompt: 'explain' });
      // Should NOT contain tool_call/tool_result raw JSON
      expect(result.output).not.toContain('tool_call');
      expect(result.output).not.toContain('tool_result');
    });

    it('dovrebbe rilevare errori nei tool_result', async () => {
      createMockProcess({ stdout: NDJSON_WITH_ERROR });
      const result = await cli.agentRun({ prompt: 'run tests' });
      expect(result.status).toBe('FAILED');
      expect(result.runId).toBe('err-456');
    });

    it('dovrebbe conservare conversation_id come runId', async () => {
      createMockProcess({ stdout: NDJSON_SUCCEEDED });
      const result = await cli.agentRun({ prompt: 'test' });
      expect(result.runId).toBe('abc-123');
    });

    it('dovrebbe conservare gli events nel campo raw', async () => {
      createMockProcess({ stdout: NDJSON_SUCCEEDED });
      const result = await cli.agentRun({ prompt: 'test' });
      expect(result.raw).toHaveProperty('events');
      expect((result.raw as any).events).toHaveLength(5);
    });

    it('dovrebbe fare fallback a single-JSON se una sola riga', async () => {
      createMockProcess({ stdout: '{"status":"SUCCEEDED","output":"done"}' });
      const result = await cli.agentRun({ prompt: 'test' });
      expect(result.status).toBe('SUCCEEDED');
      expect(result.output).toBe('done');
    });
  });
});
