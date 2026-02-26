import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRunCommand } from '../../src/commands/runCommand.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';
import {
  createMockCli,
  createMockConfigManager,
  createMockContextCollector,
  createMockStream,
  createMockToken,
  makeRunResult,
} from '../helpers.js';
import { initI18n, _resetI18n } from '../../src/core/i18n.js';

let cli: ReturnType<typeof createMockCli>;
let handler: ReturnType<typeof createRunCommand>;
let mock: ReturnType<typeof createMockStream>;

beforeEach(() => {
  vi.clearAllMocks();
  initI18n('it');
  cli = createMockCli();
  const ctx = createMockContextCollector();
  handler = createRunCommand(cli, ctx, createMockConfigManager());
  mock = createMockStream();
});

afterEach(() => {
  _resetI18n();
});

describe('/run command', () => {
  it('dovrebbe mostrare errore se CLI non disponibile', async () => {
    cli.checkAvailability.mockResolvedValue({ available: false, version: null, path: null });

    await handler('test prompt', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('non trovato');
    expect(cli.agentRun).not.toHaveBeenCalled();
  });

  it('dovrebbe eseguire agentRun con prompt e contesto', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    await handler('fix this bug', mock.stream as any, createMockToken() as any);

    expect(cli.agentRun).toHaveBeenCalledTimes(1);
    const callArgs = cli.agentRun.mock.calls[0][0];
    // Il prompt deve contenere il contesto iniettato
    expect(callArgs.prompt).toContain('[CONTEXT]');
    expect(callArgs.prompt).toContain('fix this bug');
  });

  it('dovrebbe mostrare progresso prima dell\'esecuzione', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    await handler('prompt', mock.stream as any, createMockToken() as any);

    expect(mock.progresses.length).toBeGreaterThanOrEqual(1);
  });

  it('dovrebbe rilevare skill "spec" nel prompt', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    await handler('genera le spec per il modulo auth', mock.stream as any, createMockToken() as any);

    const callArgs = cli.agentRun.mock.calls[0][0];
    expect(callArgs.skill).toBe('1-spec-agent');
  });

  it('dovrebbe rilevare skill "test" nel prompt', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    await handler('write test for login', mock.stream as any, createMockToken() as any);

    const callArgs = cli.agentRun.mock.calls[0][0];
    expect(callArgs.skill).toBe('5-test-agent');
  });

  it('dovrebbe usare word boundary per skill detection (no falsi positivi)', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    // "contest" contiene "test" ma non dovrebbe matchare con word boundary
    await handler('run a contest', mock.stream as any, createMockToken() as any);

    const callArgs = cli.agentRun.mock.calls[0][0];
    expect(callArgs.skill).toBeUndefined();
  });

  // P3 fix: case-insensitive skill detection con split(/\W+/)
  it('dovrebbe rilevare skill case-insensitive (P3)', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    // "SPEC" maiuscolo deve matchare la chiave "spec"
    await handler('genera le SPEC del modulo', mock.stream as any, createMockToken() as any);

    const callArgs = cli.agentRun.mock.calls[0][0];
    expect(callArgs.skill).toBe('1-spec-agent');
  });

  it('dovrebbe rilevare skill con punteggiatura adiacente (P3)', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    // "test," → split su \W+ produce ["test", ""] → deve matchare
    await handler('scrivi test, per favore', mock.stream as any, createMockToken() as any);

    const callArgs = cli.agentRun.mock.calls[0][0];
    expect(callArgs.skill).toBe('5-test-agent');
  });

  it('dovrebbe non passare model se defaultModel è "auto"', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    await handler('hello', mock.stream as any, createMockToken() as any);

    const callArgs = cli.agentRun.mock.calls[0][0];
    expect(callArgs.model).toBeUndefined();
  });

  it('dovrebbe passare model se defaultModel non è "auto"', async () => {
    cli = createMockCli();
    handler = createRunCommand(
      cli,
      createMockContextCollector(),
      createMockConfigManager({ defaultModel: 'gpt-4' }),
    );
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    await handler('hello', mock.stream as any, createMockToken() as any);

    expect(cli.agentRun.mock.calls[0][0].model).toBe('gpt-4');
  });

  it('dovrebbe gestire OzCliError nel catch', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockRejectedValue(new OzCliError(OzCliErrorKind.TIMEOUT, 'timeout'));

    await handler('hello', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Timeout');
  });

  it('dovrebbe gestire errore generico nel catch', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockRejectedValue(new Error('unexpected'));

    await handler('hello', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('Errore');
    expect(mock.getFullOutput()).toContain('unexpected');
  });

  // Gap: profile non-Default → dovrebbe passare profile ad agentRun (L59)
  it('dovrebbe passare profile se defaultProfile non è "Default"', async () => {
    cli = createMockCli();
    handler = createRunCommand(
      cli,
      createMockContextCollector(),
      createMockConfigManager({ defaultProfile: 'CustomProfile' }),
    );
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    await handler('hello', mock.stream as any, createMockToken() as any);

    expect(cli.agentRun.mock.calls[0][0].profile).toBe('CustomProfile');
  });

  // Gap: workspacePath vuoto → cwd undefined (L61)
  it('dovrebbe passare cwd=undefined se workspacePath è vuoto', async () => {
    cli = createMockCli();
    handler = createRunCommand(
      cli,
      createMockContextCollector({ workspacePath: '' }),
      createMockConfigManager(),
    );
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockResolvedValue(makeRunResult());

    await handler('hello', mock.stream as any, createMockToken() as any);

    expect(cli.agentRun.mock.calls[0][0].cwd).toBeUndefined();
  });

  // Gap: errore non-Error (stringa) → instanceof Error false branch (L70)
  it('dovrebbe gestire errore non-Error (stringa) nel catch (String() branch)', async () => {
    cli.checkAvailability.mockResolvedValue({ available: true, version: '1.0', path: 'oz' });
    cli.agentRun.mockRejectedValue('string thrown error');

    await handler('hello', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('string thrown error');
  });
});
