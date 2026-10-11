/**
 * Tests for the empty-prompt guard added to agentRun, agentRunCloud, scheduleCreate.
 *
 * Refactoring coverage: ensures the new early-exit guard throws OzCliError
 * for empty, whitespace-only, and undefined-ish prompts — without spawning a process.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  it('throws OzCliError for an empty-string prompt', async () => {
    await expect(cli.agentRun({ prompt: '' })).rejects.toThrow(OzCliError);
    await expect(cli.agentRun({ prompt: '' })).rejects.toThrow('Prompt cannot be empty');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('throws OzCliError for a prompt with only spaces', async () => {
    await expect(cli.agentRun({ prompt: '   ' })).rejects.toThrow(OzCliError);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('throws OzCliError for a prompt with tabs and newlines', async () => {
    await expect(cli.agentRun({ prompt: '\t\n  ' })).rejects.toThrow('Prompt cannot be empty');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('throws with kind CLI_ERROR', async () => {
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
  it('throws OzCliError for an empty-string prompt', async () => {
    await expect(cli.agentRunCloud({ prompt: '' })).rejects.toThrow('Prompt cannot be empty');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('throws OzCliError for a prompt with only spaces', async () => {
    await expect(cli.agentRunCloud({ prompt: '   ' })).rejects.toThrow(OzCliError);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('throws OzCliError for a prompt with tabs/newlines', async () => {
    await expect(cli.agentRunCloud({ prompt: '\n\t' })).rejects.toThrow('Prompt cannot be empty');
  });
});

// ---------------------------------------------------------------------------
// scheduleCreate — empty prompt guard
// ---------------------------------------------------------------------------
describe('scheduleCreate() empty prompt guard', () => {
  it('throws OzCliError for an empty-string prompt', async () => {
    await expect(
      cli.scheduleCreate({ name: 'job', cron: '0 9 * * *', prompt: '' }),
    ).rejects.toThrow('Prompt cannot be empty');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('throws OzCliError for a prompt with only spaces', async () => {
    await expect(
      cli.scheduleCreate({ name: 'job', cron: '0 9 * * *', prompt: '   ' }),
    ).rejects.toThrow(OzCliError);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('prompt guard runs before validateCliArg (the name is not validated)', async () => {
    // If the prompt guard runs before validateCliArg, an invalid name is never reached
    await expect(
      cli.scheduleCreate({ name: 'job --inject', cron: '* * * * *', prompt: '' }),
    ).rejects.toThrow('Prompt cannot be empty');
  });
});
