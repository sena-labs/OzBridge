import * as vscode from 'vscode';
import { ContextPayload, DiagnosticEntry, IContextCollector } from '../types.js';

/**
 * Gathers IDE context (workspace, active file, selection, diagnostics)
 * and formats it as a `[CONTEXT]…[/CONTEXT]` block for prompt injection.
 *
 * Never throws — fields are `null` when not available.
 */
export class ContextCollector implements IContextCollector {
  gather(): ContextPayload {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspacePath = workspaceFolders?.[0]?.uri.fsPath ?? '';

    const editor = vscode.window.activeTextEditor;
    let activeFilePath: string | null = null;
    let activeFileLanguageId: string | null = null;
    let selection: string | null = null;
    const diagnostics: DiagnosticEntry[] = [];

    if (editor) {
      activeFilePath = editor.document.uri.fsPath;
      activeFileLanguageId = editor.document.languageId;

      if (!editor.selection.isEmpty) {
        selection = editor.document.getText(editor.selection);
      }

      const fileDiagnostics = vscode.languages.getDiagnostics(editor.document.uri);
      for (const diag of fileDiagnostics) {
        diagnostics.push({
          severity: this.mapSeverity(diag.severity),
          message: diag.message,
          range: {
            startLine: diag.range.start.line + 1,
            endLine: diag.range.end.line + 1,
          },
        });
      }
    }

    return { workspacePath, activeFilePath, activeFileLanguageId, selection, diagnostics };
  }

  formatForPrompt(payload: ContextPayload): string {
    const parts: string[] = ['[CONTEXT]'];

    if (payload.workspacePath) {
      parts.push(`Workspace: ${payload.workspacePath}`);
    }
    if (payload.activeFilePath) {
      const lang = payload.activeFileLanguageId ? ` (${payload.activeFileLanguageId})` : '';
      parts.push(`File: ${payload.activeFilePath}${lang}`);
    }
    if (payload.selection) {
      const sel = payload.selection.length > 2000
        ? payload.selection.substring(0, 2000) + '\n... (truncated)'
        : payload.selection;
      parts.push(`Selection:\n${sel}`);
    }
    if (payload.diagnostics.length > 0) {
      const errors = payload.diagnostics.filter((d) => d.severity === 'error').length;
      const warnings = payload.diagnostics.filter((d) => d.severity === 'warning').length;
      parts.push(`Diagnostics: ${errors} errors, ${warnings} warnings`);
      for (const diag of payload.diagnostics.slice(0, 10)) {
        const sevLabel = diag.severity.charAt(0).toUpperCase() + diag.severity.slice(1);
        parts.push(`- ${sevLabel} L${diag.range.startLine}: ${diag.message}`);
      }
    }

    parts.push('[/CONTEXT]');
    return parts.join('\n');
  }

  private mapSeverity(severity: vscode.DiagnosticSeverity): DiagnosticEntry['severity'] {
    switch (severity) {
      case vscode.DiagnosticSeverity.Error: return 'error';
      case vscode.DiagnosticSeverity.Warning: return 'warning';
      case vscode.DiagnosticSeverity.Information: return 'info';
      case vscode.DiagnosticSeverity.Hint: return 'hint';
    }
  }
}
