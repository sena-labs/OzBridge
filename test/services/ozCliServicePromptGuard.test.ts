/**
 * Tests for the empty-prompt guard added to agentRun, agentRunCloud, scheduleCreate.
 *
 * Refactoring coverage: ensures the new early-exit guard throws OzCliError
 * for empty, whitespace-only, and undefined-ish prompts — without spawning a process.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { OzCliService } from '../../src/services/ozCliService.js';
import { OzCliError, OzCliErrorKind } from '../../src/types/index.js';
import { createMockConfigManager } from '../helpers.js';

// ---------------------------------------------------------------------------
// Mock child_process.spawn — should NEVER be called for empty-prompt cases
// ---------------------------------------------------------------------------
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    throw new Error('spawn should not be called for empty prompt');
  }),
}));

import { spawn } from 'node:child_process';

const mockSpawn = vi.mocked(spawn);

// ---------------------------------------------------------------------------
let cli: OzCliService;

beforeEach(() => {
  vi.clearAllMocks();
  cli = new OzCliService(createMockConfigManager());
});

// ---------------------------------------------------------------------------
// agentRun — empty prompt guard
// ---------------------------------------------------------------------------
describe('agentRun() empty prompt guard', () => {
  it('dovrebbe lanciare OzCliError per prompt stringa vuota', async () => {
    await expect(cli.agentRun({ prompt: '' })).rejects.toThrow(OzCliError);
    await expect(cli.agentRun({ prompt: '' })).rejects.toThrow('Prompt cannot be empty');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('dovrebbe lanciare OzCliError per prompt con soli spazi', async () => {
    await expect(cli.agentRun({ prompt: '   ' })).rejects.toThrow(OzCliError);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('dovrebbe lanciare OzCliError per prompt con tab e newline', async () => {
    await expect(cli.agentRun({ prompt: '\t\n  ' })).rejects.toThrow('Prompt cannot be empty');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('dovrebbe lanciare con kind CLI_ERROR', async () => {
    try {
      await cli.agentRun({ prompt: '' });
    } catch (e) {
      expect(e).toBeInstanceOf(OzCliError);
      expect((e as OzCliError).kind).toBe(OzCliErrorKind.CLI_ERROR);
    }
  });
});

// ---------------------------------------------------------------------------
// agentRunCloud — empty prompt guard
// ---------------------------------------------------------------------------
describe('agentRunCloud() empty prompt guard', () => {
  it('dovrebbe lanciare OzCliError per prompt stringa vuota', async () => {
    await expect(cli.agentRunCloud({ prompt: '' })).rejects.toThrow('Prompt cannot be empty');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('dovrebbe lanciare OzCliError per prompt con soli spazi', async () => {
    await expect(cli.agentRunCloud({ prompt: '   ' })).rejects.toThrow(OzCliError);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('dovrebbe lanciare OzCliError per prompt con tab/newline', async () => {
    await expect(cli.agentRunCloud({ prompt: '\n\t' })).rejects.toThrow('Prompt cannot be empty');
  });
});

// ---------------------------------------------------------------------------
// scheduleCreate — empty prompt guard
// ---------------------------------------------------------------------------
describe('scheduleCreate() empty prompt guard', () => {
  it('dovrebbe lanciare OzCliError per prompt stringa vuota', async () => {
    await expect(
      cli.scheduleCreate({ name: 'job', cron: '0 9 * * *', prompt: '' }),
    ).rejects.toThrow('Prompt cannot be empty');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('dovrebbe lanciare OzCliError per prompt con soli spazi', async () => {
    await expect(
      cli.scheduleCreate({ name: 'job', cron: '0 9 * * *', prompt: '   ' }),
    ).rejects.toThrow(OzCliError);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('guard prompt eseguito prima di validateCliArg (nome non viene validato)', async () => {
    // Se il guard prompt avviene prima di validateCliArg, un nome invalido non viene raggiunto
    await expect(
      cli.scheduleCreate({ name: 'job --inject', cron: '* * * * *', prompt: '' }),
    ).rejects.toThrow('Prompt cannot be empty');
  });
});
