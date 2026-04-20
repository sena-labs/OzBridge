/**
 * Registry of built-in skill / rule templates that `/init` can scaffold.
 *
 * Each entry carries the target relative path (under the workspace
 * root), a human-readable description used by the QuickPick detail,
 * and a body function that produces the final file content. Keeping
 * the registry data-only makes it trivial for the v0.7 `/init` v2
 * handler and a future webview-based editor to share the same
 * material without re-implementing it.
 */
import * as path from 'path';
import { AGENT_SKILL_MAP } from '../types/index.js';

/** A single entry that `/init` can scaffold. */
export interface SkillTemplate {
  readonly id: string;
  readonly relativePath: string;
  readonly description: string;
  /** Returns the markdown body for the template. Deterministic. */
  body(): string;
}

const SKILL_DESCRIPTIONS: Record<string, string> = {
  '1-spec-agent': 'Analyze requirements, produce specifications, define acceptance criteria',
  '2-design-agent': 'Create architectural designs, define interfaces, document decisions',
  '3-implement-agent': 'Write, modify, and refactor code following specifications',
  '4-review-agent': 'Review code for correctness, style, security, and performance',
  '5-test-agent': 'Write and maintain unit, integration, and E2E tests',
  '6-deploy-agent': 'Configure CI/CD, packaging, and deployment pipelines',
  '7-maintenance-agent': 'Monitor, update dependencies, fix bugs, and improve performance',
};

function skillBody(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: "${description}"\n---\n\n# ${name}\n\nThis skill maps to the custom VS Code agent "${name}".\n\n## Instructions\n\nProvide specific instructions for this agent skill here.\nCustomize the behavior based on your project needs.\n`;
}

function rulesBody(): string {
  return `# Project Rules for Warp Oz\n\n## Code Style\n- Follow the conventions already established in the codebase\n- Use consistent naming and formatting\n\n## Architecture\n- Maintain separation of concerns\n- Avoid introducing unnecessary dependencies\n\n## Testing\n- Write tests for new functionality\n- Ensure existing tests pass before submitting changes\n\n## Documentation\n- Document public APIs and interfaces\n- Add comments for complex logic\n`;
}

/**
 * Canonical list of templates `/init` can scaffold. The order here is
 * the order the QuickPick renders.
 */
export const SKILL_TEMPLATES: SkillTemplate[] = [
  ...Object.values(AGENT_SKILL_MAP).map<SkillTemplate>((skillName) => ({
    id: `skill:${skillName}`,
    relativePath: path.join('.agents', 'skills', skillName, 'SKILL.md'),
    description: SKILL_DESCRIPTIONS[skillName] ?? 'Agent skill',
    body: () => skillBody(skillName, SKILL_DESCRIPTIONS[skillName] ?? ''),
  })),
  {
    id: 'rules:project',
    relativePath: path.join('.warp', 'rules', 'PROJECT.md'),
    description: 'Shared project rules for Warp Oz',
    body: rulesBody,
  },
];
