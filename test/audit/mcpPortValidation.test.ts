import { describe, it, expect } from 'vitest';
import { readMcpConfig } from '../../src/mcp/lifecycle.js';

describe('MCP port validation audit', () => {
  it('rejects ports over 65535', () => {
    const cfg = readMcpConfig({ mcpPort: 99999 } as any);
    expect(cfg.port).toBe(3847);
  });

  it('rejects Infinity', () => {
    const cfg = readMcpConfig({ mcpPort: Number.POSITIVE_INFINITY } as any);
    expect(cfg.port).toBe(3847);
  });

  it('rejects fractional ports', () => {
    const cfg = readMcpConfig({ mcpPort: 3847.5 } as any);
    expect(cfg.port).toBe(3847);
  });

  it('accepts integer ports in range', () => {
    const cfg = readMcpConfig({ mcpPort: 3847 } as any);
    expect(cfg.port).toBe(3847);
  });
});
