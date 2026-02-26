import * as vscode from 'vscode';
import { AGENT_SKILL_MAP, SlashCommandHandler } from '../types/index.js';
import { t } from '../core/i18n.js';

/**
 * Creates the `/init` slash-command handler.
 *
 * Scaffolds `.agents/skills/<skill>/SKILL.md` files (one per agent skill)
 * and `.warp/rules/PROJECT.md` in the current workspace. Existing files are
 * never overwritten.
 *
 * @returns A {@link SlashCommandHandler} for the `/init` command.
 */

const SKILL_TEMPLATE = (name: string, description: string): string => `---
name: ${name}
description: "${description}"
---

# ${name}

This skill maps to the custom VS Code agent "${name}".

## Instructions

Provide specific instructions for this agent skill here.
Customize the behavior based on your project needs.
`;

const PROJECT_RULES_TEMPLATE = `# Project Rules for Warp Oz

## Code Style
- Follow the conventions already established in the codebase
- Use consistent naming and formatting

## Architecture
- Maintain separation of concerns
- Avoid introducing unnecessary dependencies

## Testing
- Write tests for new functionality
- Ensure existing tests pass before submitting changes

## Documentation
- Document public APIs and interfaces
- Add comments for complex logic
`;

const SKILL_DESCRIPTIONS: Record<string, string> = {
  '1-spec-agent': 'Analyze requirements, produce specifications, define acceptance criteria',
  '2-design-agent': 'Create architectural designs, define interfaces, document decisions',
  '3-implement-agent': 'Write, modify, and refactor code following specifications',
  '4-review-agent': 'Review code for correctness, style, security, and performance',
  '5-test-agent': 'Write and maintain unit, integration, and E2E tests',
  '6-deploy-agent': 'Configure CI/CD, packaging, and deployment pipelines',
  '7-maintenance-agent': 'Monitor, update dependencies, fix bugs, and improve performance',
};

export function createInitCommand(): SlashCommandHandler {
  return async (_prompt, stream, _token) => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.[0]) {
      stream.markdown(t('oz.init_no_workspace'));
      return {};
    }

    const rootUri = workspaceFolders[0].uri;
    let created = 0;
    let skipped = 0;

    stream.progress(t('oz.init_progress'));

    // Crea 7 SKILL.md files (async, non blocca l'extension host)
    for (const [, skillName] of Object.entries(AGENT_SKILL_MAP)) {
      const skillDirUri = vscode.Uri.joinPath(rootUri, '.agents', 'skills', skillName);
      const skillFileUri = vscode.Uri.joinPath(skillDirUri, 'SKILL.md');

      if (await fileExists(skillFileUri)) {
        skipped++;
        continue;
      }

      await vscode.workspace.fs.createDirectory(skillDirUri);
      await vscode.workspace.fs.writeFile(
        skillFileUri,
        Buffer.from(SKILL_TEMPLATE(skillName, SKILL_DESCRIPTIONS[skillName] ?? ''), 'utf-8'),
      );
      created++;
    }

    // Crea .warp/rules/PROJECT.md
    const rulesDirUri = vscode.Uri.joinPath(rootUri, '.warp', 'rules');
    const rulesFileUri = vscode.Uri.joinPath(rulesDirUri, 'PROJECT.md');

    if (await fileExists(rulesFileUri)) {
      skipped++;
    } else {
      await vscode.workspace.fs.createDirectory(rulesDirUri);
      await vscode.workspace.fs.writeFile(rulesFileUri, Buffer.from(PROJECT_RULES_TEMPLATE, 'utf-8'));
      created++;
    }

    // Report
    stream.markdown(t('oz.init_done'));
    stream.markdown(t('oz.init_created', created));
    if (skipped > 0) {
      stream.markdown(t('oz.init_skipped', skipped));
    }
    stream.markdown(t('oz.init_structure'));
    stream.markdown('```\n');
    stream.markdown('.agents/skills/\n');
    for (const [, skillName] of Object.entries(AGENT_SKILL_MAP)) {
      stream.markdown(`  └── ${skillName}/SKILL.md\n`);
    }
    stream.markdown('.warp/rules/\n');
    stream.markdown('  └── PROJECT.md\n');
    stream.markdown('```\n');

    return {};
  };
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
