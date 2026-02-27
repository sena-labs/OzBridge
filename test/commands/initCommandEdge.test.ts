/**
 * Edge-case tests for /init command — uncovered error-handling paths.
 *
 * Covers:
 *   - All skill files already exist → all skipped, none created
 *   - Some files exist, others don't → partial creation
 *   - fs.writeFile throws → error propagates
 *   - fs.createDirectory throws → error propagates
 *   - PROJECT.md already exists → skipped
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { workspace } from '../mocks/vscode.js';
import { createInitCommand } from '../../src/commands/initCommand.js';
import { createMockStream, createMockToken } from '../helpers.js';
import { initI18n, _resetI18n } from '../../src/core/i18n.js';
import { Uri } from '../mocks/vscode.js';

let handler: ReturnType<typeof createInitCommand>;
let mock: ReturnType<typeof createMockStream>;

beforeEach(() => {
  vi.clearAllMocks();
  initI18n('en');
  handler = createInitCommand();
  mock = createMockStream();

  // Default: workspace available
  workspace.workspaceFolders = [
    { uri: Uri.file('/workspace'), name: 'test', index: 0 },
  ];

  // Default: files don't exist (stat throws)
  workspace.fs.stat.mockRejectedValue(new Error('ENOENT'));
  workspace.fs.createDirectory.mockResolvedValue(undefined);
  workspace.fs.writeFile.mockResolvedValue(undefined);
});

afterEach(() => {
  _resetI18n();
  workspace.workspaceFolders = undefined;
});

describe('/init command — edge cases', () => {
  it('should skip all files when every skill file and PROJECT.md already exist', async () => {
    // Make stat succeed for all files → all exist
    workspace.fs.stat.mockResolvedValue({ type: 1, ctime: 0, mtime: 0, size: 100 });

    await handler('', mock.stream as any, createMockToken() as any);

    // writeFile should not be called at all
    expect(workspace.fs.writeFile).not.toHaveBeenCalled();
    const output = mock.getFullOutput();
    expect(output).toContain('0'); // 0 files created
    // 7 skills + 1 PROJECT.md = 8 skipped
    expect(output).toContain('8');
  });

  it('should create only missing files when some already exist', async () => {
    let callCount = 0;
    workspace.fs.stat.mockImplementation(async () => {
      callCount++;
      // First 3 calls (skills 1-3) succeed → exist; rest fail → need creation
      if (callCount <= 3) {
        return { type: 1, ctime: 0, mtime: 0, size: 100 };
      }
      throw new Error('ENOENT');
    });

    await handler('', mock.stream as any, createMockToken() as any);

    // 3 existing + 4 skills created + 1 PROJECT.md created = 5 new
    expect(workspace.fs.writeFile).toHaveBeenCalledTimes(5);
    const output = mock.getFullOutput();
    expect(output).toContain('5'); // created count
    expect(output).toContain('3'); // skipped count
  });

  it('should propagate error when fs.writeFile throws', async () => {
    workspace.fs.writeFile.mockRejectedValue(new Error('EACCES: permission denied'));

    await expect(
      handler('', mock.stream as any, createMockToken() as any),
    ).rejects.toThrow('EACCES');
  });

  it('should propagate error when fs.createDirectory throws', async () => {
    workspace.fs.createDirectory.mockRejectedValue(new Error('ENOSPC: no space left'));

    await expect(
      handler('', mock.stream as any, createMockToken() as any),
    ).rejects.toThrow('ENOSPC');
  });

  it('should skip only PROJECT.md when it already exists but skills do not', async () => {
    let callCount = 0;
    workspace.fs.stat.mockImplementation(async () => {
      callCount++;
      // 7 skill stat calls fail (not exist), 8th call (PROJECT.md) succeeds
      if (callCount === 8) {
        return { type: 1, ctime: 0, mtime: 0, size: 100 };
      }
      throw new Error('ENOENT');
    });

    await handler('', mock.stream as any, createMockToken() as any);

    // 7 skills created, PROJECT.md skipped
    expect(workspace.fs.writeFile).toHaveBeenCalledTimes(7);
    const output = mock.getFullOutput();
    expect(output).toContain('7'); // created
    expect(output).toContain('1'); // skipped
  });

  it('should show correct structure listing with all 7 skill names', async () => {
    await handler('', mock.stream as any, createMockToken() as any);

    const output = mock.getFullOutput();
    expect(output).toContain('1-spec-agent');
    expect(output).toContain('2-design-agent');
    expect(output).toContain('3-implement-agent');
    expect(output).toContain('4-review-agent');
    expect(output).toContain('5-test-agent');
    expect(output).toContain('6-deploy-agent');
    expect(output).toContain('7-maintenance-agent');
    expect(output).toContain('PROJECT.md');
  });

  it('should show "no workspace" message when workspaceFolders is empty array', async () => {
    workspace.workspaceFolders = [];

    await handler('', mock.stream as any, createMockToken() as any);

    expect(mock.getFullOutput()).toContain('workspace');
    expect(workspace.fs.writeFile).not.toHaveBeenCalled();
  });
});
