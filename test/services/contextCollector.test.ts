import { describe, it, expect, vi, beforeEach } from 'vitest';
import { window, languages, workspace, DiagnosticSeverity, Uri } from '../../test/mocks/vscode.js';
import { ContextCollector } from '../../src/services/contextCollector.js';

let collector: ContextCollector;

beforeEach(() => {
  vi.clearAllMocks();
  window.activeTextEditor = undefined;
  workspace.workspaceFolders = undefined;
  collector = new ContextCollector();
});

describe('ContextCollector', () => {
  // =======================================================================
  // gather()
  // =======================================================================
  describe('gather()', () => {
    it('returns an empty context with no open editor', () => {
      const ctx = collector.gather();
      expect(ctx.activeFilePath).toBeNull();
      expect(ctx.activeFileLanguageId).toBeNull();
      expect(ctx.selection).toBeNull();
      expect(ctx.diagnostics).toEqual([]);
    });

    it('returns an empty workspacePath with no open workspace', () => {
      const ctx = collector.gather();
      expect(ctx.workspacePath).toBe('');
    });

    it('reads workspacePath from the first workspace folder', () => {
      workspace.workspaceFolders = [
        { uri: Uri.file('/my/project'), name: 'project', index: 0 },
      ];
      const ctx = collector.gather();
      expect(ctx.workspacePath).toBe('/my/project');
    });

    it('reads the active file and language', () => {
      window.activeTextEditor = {
        document: {
          uri: Uri.file('/my/project/main.ts'),
          languageId: 'typescript',
          getText: vi.fn(() => ''),
        },
        selection: { isEmpty: true },
      };
      const ctx = collector.gather();
      expect(ctx.activeFilePath).toBe('/my/project/main.ts');
      expect(ctx.activeFileLanguageId).toBe('typescript');
    });

    it('captures the active selection', () => {
      window.activeTextEditor = {
        document: {
          uri: Uri.file('/f.ts'),
          languageId: 'typescript',
          getText: vi.fn(() => 'selected text'),
        },
        selection: { isEmpty: false },
      };
      languages.getDiagnostics.mockReturnValue([]);
      const ctx = collector.gather();
      expect(ctx.selection).toBe('selected text');
    });

    it('maps the diagnostics of the current file', () => {
      window.activeTextEditor = {
        document: {
          uri: Uri.file('/f.ts'),
          languageId: 'typescript',
          getText: vi.fn(() => ''),
        },
        selection: { isEmpty: true },
      };
      languages.getDiagnostics.mockReturnValue([
        {
          severity: DiagnosticSeverity.Error,
          message: 'Type mismatch',
          range: { start: { line: 4 }, end: { line: 4 } },
        },
        {
          severity: DiagnosticSeverity.Warning,
          message: 'Unused var',
          range: { start: { line: 10 }, end: { line: 10 } },
        },
      ]);

      const ctx = collector.gather();
      expect(ctx.diagnostics).toHaveLength(2);
      expect(ctx.diagnostics[0].severity).toBe('error');
      expect(ctx.diagnostics[0].message).toBe('Type mismatch');
      expect(ctx.diagnostics[0].range.startLine).toBe(5); // 0-based → 1-based
      expect(ctx.diagnostics[1].severity).toBe('warning');
    });

    it('maps DiagnosticSeverity.Information → info', () => {
      window.activeTextEditor = {
        document: { uri: Uri.file('/f.ts'), languageId: 'ts', getText: vi.fn(() => '') },
        selection: { isEmpty: true },
      };
      languages.getDiagnostics.mockReturnValue([
        { severity: DiagnosticSeverity.Information, message: 'info', range: { start: { line: 0 }, end: { line: 0 } } },
      ]);
      expect(collector.gather().diagnostics[0].severity).toBe('info');
    });

    it('maps DiagnosticSeverity.Hint → hint', () => {
      window.activeTextEditor = {
        document: { uri: Uri.file('/f.ts'), languageId: 'ts', getText: vi.fn(() => '') },
        selection: { isEmpty: true },
      };
      languages.getDiagnostics.mockReturnValue([
        { severity: DiagnosticSeverity.Hint, message: 'hint', range: { start: { line: 0 }, end: { line: 0 } } },
      ]);
      expect(collector.gather().diagnostics[0].severity).toBe('hint');
    });
  });

  // =======================================================================
  // formatForPrompt()
  // =======================================================================
  describe('formatForPrompt()', () => {
    it('wraps in [CONTEXT]...[/CONTEXT]', () => {
      const result = collector.formatForPrompt({
        workspacePath: '/wp',
        activeFilePath: null,
        activeFileLanguageId: null,
        selection: null,
        diagnostics: [],
      });
      expect(result).toMatch(/^\[CONTEXT\]/);
      expect(result).toMatch(/\[\/CONTEXT\]$/);
    });

    it('includes the workspace path', () => {
      const result = collector.formatForPrompt({
        workspacePath: '/my/project',
        activeFilePath: null,
        activeFileLanguageId: null,
        selection: null,
        diagnostics: [],
      });
      expect(result).toContain('Workspace: /my/project');
    });

    it('includes file and language', () => {
      const result = collector.formatForPrompt({
        workspacePath: '',
        activeFilePath: '/file.py',
        activeFileLanguageId: 'python',
        selection: null,
        diagnostics: [],
      });
      expect(result).toContain('File: /file.py (python)');
    });

    it('omits the language suffix when activeFileLanguageId is null', () => {
      const result = collector.formatForPrompt({
        workspacePath: '',
        activeFilePath: '/file.unknown',
        activeFileLanguageId: null,
        selection: null,
        diagnostics: [],
      });
      expect(result).toContain('File: /file.unknown');
      // Must not have the parentheses with the language
      expect(result).not.toMatch(/File:.*\(/);
    });

    it('truncates the selection to 2000 characters', () => {
      const longSelection = 'a'.repeat(3000);
      const result = collector.formatForPrompt({
        workspacePath: '',
        activeFilePath: null,
        activeFileLanguageId: null,
        selection: longSelection,
        diagnostics: [],
      });
      expect(result).toContain('truncated');
      expect(result.length).toBeLessThan(longSelection.length);
    });

    it('does not truncate a selection of ≤ 2000 characters', () => {
      const sel = 'hello world';
      const result = collector.formatForPrompt({
        workspacePath: '',
        activeFilePath: null,
        activeFileLanguageId: null,
        selection: sel,
        diagnostics: [],
      });
      expect(result).toContain(sel);
      expect(result).not.toContain('truncated');
    });

    it('shows the error and warning counts', () => {
      const result = collector.formatForPrompt({
        workspacePath: '',
        activeFilePath: null,
        activeFileLanguageId: null,
        selection: null,
        diagnostics: [
          { severity: 'error', message: 'err1', range: { startLine: 1, endLine: 1 } },
          { severity: 'error', message: 'err2', range: { startLine: 2, endLine: 2 } },
          { severity: 'warning', message: 'warn1', range: { startLine: 3, endLine: 3 } },
        ],
      });
      expect(result).toContain('2 errors');
      expect(result).toContain('1 warnings');
    });

    it('limits the prompt to 10 diagnostics', () => {
      const diags = Array.from({ length: 15 }, (_, i) => ({
        severity: 'error' as const,
        message: `err-${i}`,
        range: { startLine: i, endLine: i },
      }));
      const result = collector.formatForPrompt({
        workspacePath: '',
        activeFilePath: null,
        activeFileLanguageId: null,
        selection: null,
        diagnostics: diags,
      });
      // Should contain err-0 through err-9 but not err-10
      expect(result).toContain('err-9');
      expect(result).not.toContain('err-10');
    });
  });
});
