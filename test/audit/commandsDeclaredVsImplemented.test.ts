import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TREE_COMMANDS } from '../../src/ui/treeCommands.js';
import { DRIVE_COMMANDS } from '../../src/ui/driveCommands.js';
import { HANDOFF_COMMANDS } from '../../src/ui/handoff.js';
import { SKILL_EDITOR_COMMANDS } from '../../src/ui/skillEditor.js';
import { SELECT_MODEL_COMMAND } from '../../src/ui/modelSelector.js';

type Pkg = {
  contributes?: {
    commands?: Array<{ command: string }>;
  };
};

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (entry.isFile() && full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function collectRegisteredCommands(srcRoot: string): Set<string> {
  const found = new Set<string>();
  const files = collectTsFiles(srcRoot);
  const rx = /registerCommand\(\s*['\"`]([^'\"`]+)['\"`]/g;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      found.add(m[1]);
    }
  }
  return found;
}

function collectConstantCommands(): Set<string> {
  const fromObjects = [
    ...Object.values(TREE_COMMANDS),
    ...Object.values(DRIVE_COMMANDS),
    ...Object.values(HANDOFF_COMMANDS),
    ...Object.values(SKILL_EDITOR_COMMANDS),
    SELECT_MODEL_COMMAND,
  ];
  return new Set(fromObjects);
}

describe('commands declared vs implemented audit', () => {
  const root = path.resolve(__dirname, '..', '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as Pkg;

  it('every contributed command should have a runtime registerCommand call', () => {
    const declared = new Set((pkg.contributes?.commands ?? []).map((c) => c.command));
    const implemented = new Set([
      ...collectRegisteredCommands(path.join(root, 'src')),
      ...collectConstantCommands(),
    ]);

    const missing = [...declared].filter((c) => !implemented.has(c));
    expect(missing, `Commands declared in package.json but not registered: ${missing.join(', ')}`).toEqual([]);
  });

  it('runtime command registrations should not drift away from ozBridge namespace', () => {
    const implemented = collectRegisteredCommands(path.join(root, 'src'));
    const nonNamespaced = [...implemented].filter((c) => !c.startsWith('ozBridge.'));

    // Allow internal VS Code command registration only when clearly intentional.
    expect(nonNamespaced, `Unexpected non-ozBridge command ids: ${nonNamespaced.join(', ')}`).toEqual([]);
  });
});
