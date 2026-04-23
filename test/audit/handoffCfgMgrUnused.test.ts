import { describe, it, expect } from 'vitest';
import { registerHandoffCommands } from '../../src/ui/handoff.js';

describe('handoff deps audit', () => {
  it('registerHandoffCommands works without cfgMgr dependency', () => {
    const disposables = registerHandoffCommands({
      getWorkspacePath: () => '/workspace',
    });

    expect(disposables).toHaveLength(2);
    for (const d of disposables) {
      d.dispose();
    }
  });
});
