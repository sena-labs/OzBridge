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
    it('dovrebbe tornare contesto vuoto senza editor aperto', () => {
      const ctx = collector.gather();
      expect(ctx.activeFilePath).toBeNull();
      expect(ctx.activeFileLanguageId).toBeNull();
      expect(ctx.selection).toBeNull();
      expect(ctx.diagnostics).toEqual([]);
    });

    it('dovrebbe tornare workspacePath vuoto senza workspace aperto', () => {
      const ctx = collector.gather();
      expect(ctx.workspacePath).toBe('');
    });

    it('dovrebbe leggere workspacePath dal primo workspace folder', () => {
      workspace.workspaceFolders = [
        { uri: Uri.file('/my/project'), name: 'project', index: 0 },
      ];
      const ctx = collector.gather();
      expect(ctx.workspacePath).toBe('/my/project');
    });

    it('dovrebbe leggere file attivo e linguaggio', () => {
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

    it('dovrebbe catturare la selezione attiva', () => {
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

    it('dovrebbe mappare diagnostics del file corrente', () => {
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

    it('dovrebbe mappare DiagnosticSeverity.Information → info', () => {
      window.activeTextEditor = {
        document: { uri: Uri.file('/f.ts'), languageId: 'ts', getText: vi.fn(() => '') },
        selection: { isEmpty: true },
      };
      languages.getDiagnostics.mockReturnValue([
        { severity: DiagnosticSeverity.Information, message: 'info', range: { start: { line: 0 }, end: { line: 0 } } },
      ]);
      expect(collector.gather().diagnostics[0].severity).toBe('info');
    });

    it('dovrebbe mappare DiagnosticSeverity.Hint → hint', () => {
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
    it('dovrebbe wrappare in [CONTEXT]...[/CONTEXT]', () => {
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

    it('dovrebbe includere workspace path', () => {
      const result = collector.formatForPrompt({
        workspacePath: '/my/project',
        activeFilePath: null,
        activeFileLanguageId: null,
        selection: null,
        diagnostics: [],
      });
      expect(result).toContain('Workspace: /my/project');
    });

    it('dovrebbe includere file e lingua', () => {
      const result = collector.formatForPrompt({
        workspacePath: '',
        activeFilePath: '/file.py',
        activeFileLanguageId: 'python',
        selection: null,
        diagnostics: [],
      });
      expect(result).toContain('File: /file.py (python)');
    });

    it('dovrebbe omettere suffisso lingua se activeFileLanguageId è null', () => {
      const result = collector.formatForPrompt({
        workspacePath: '',
        activeFilePath: '/file.unknown',
        activeFileLanguageId: null,
        selection: null,
        diagnostics: [],
      });
      expect(result).toContain('File: /file.unknown');
      // Non deve avere le parentesi con la lingua
      expect(result).not.toMatch(/File:.*\(/);
    });

    it('dovrebbe troncare selezione a 2000 caratteri', () => {
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

    it('dovrebbe non troncare selezione ≤ 2000 caratteri', () => {
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

    it('dovrebbe mostrare conteggio errori e warning', () => {
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

    it('dovrebbe limitare a 10 diagnostics nel prompt', () => {
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
      // Dovrebbe contenere err-0 fino a err-9 ma non err-10
      expect(result).toContain('err-9');
      expect(result).not.toContain('err-10');
    });
  });
});
