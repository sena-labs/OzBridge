import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpLifecycle, readMcpConfig, registerMcpCommands } from '../../src/mcp/lifecycle.js';
import { createMockCli, createMockConfigManager } from '../helpers.js';
import * as vscodeMock from '../mocks/vscode.js';

beforeEach(() => {
  vscodeMock.commands._resetCommands();
  vscodeMock.env.clipboard.writeText.mockClear();
  vscodeMock.window.showInformationMessage.mockClear();
  vscodeMock.window.showWarningMessage.mockClear();
});

describe('readMcpConfig', () => {
  it('applies defaults when fields are missing or invalid', () => {
    const cfg = readMcpConfig({} as any);
    expect(cfg).toEqual({
      enabled: false,
      port: 3847,
      bindAddress: '127.0.0.1',
      bearerToken: '',
    });
  });

  it('uses provided values when valid', () => {
    const cfg = readMcpConfig({
      mcpEnabled: true, mcpPort: 9000, mcpBindAddress: '0.0.0.0', mcpBearerToken: 'tok',
    } as any);
    expect(cfg).toEqual({
      enabled: true, port: 9000, bindAddress: '0.0.0.0', bearerToken: 'tok',
    });
  });

  it('falls back on non-positive port', () => {
    const cfg = readMcpConfig({ mcpPort: -1 } as any);
    expect(cfg.port).toBe(3847);
  });
});

describe('McpLifecycle', () => {
  let lifecycle: McpLifecycle;

  afterEach(async () => {
    await lifecycle?.dispose();
  });

  it('is stopped by default and starts on demand', async () => {
    const cfgMgr = createMockConfigManager({ mcpEnabled: true, mcpPort: 0 } as any);
    lifecycle = new McpLifecycle(createMockCli(), cfgMgr, '0.6.0-dev');
    expect(lifecycle.running).toBe(false);
    expect(lifecycle.endpoint).toBeUndefined();

    await lifecycle.start();
    expect(lifecycle.running).toBe(true);
    expect(lifecycle.endpoint?.address).toBe('127.0.0.1');
    expect(lifecycle.endpoint?.port).toBeGreaterThan(0);
  });

  it('restart is idempotent: two starts leave exactly one live server', async () => {
    const cfgMgr = createMockConfigManager({ mcpPort: 0 } as any);
    lifecycle = new McpLifecycle(createMockCli(), cfgMgr, '0.6.0-dev');
    await lifecycle.start();
    const firstPort = lifecycle.endpoint?.port;
    await lifecycle.start();
    const secondPort = lifecycle.endpoint?.port;
    expect(firstPort).toBeGreaterThan(0);
    expect(secondPort).toBeGreaterThan(0);
    // After restart, the new server listens on a different ephemeral port.
    expect(secondPort).not.toBe(firstPort);
    expect(lifecycle.running).toBe(true);
  });

  it('stop() transitions to not-running and clears the endpoint', async () => {
    const cfgMgr = createMockConfigManager({ mcpPort: 0 } as any);
    lifecycle = new McpLifecycle(createMockCli(), cfgMgr, '0.6.0-dev');
    await lifecycle.start();
    await lifecycle.stop();
    expect(lifecycle.running).toBe(false);
    expect(lifecycle.endpoint).toBeUndefined();
  });

  it('start failure (port busy) does not leave the instance half-initialised', async () => {
    const cfgMgr = createMockConfigManager({ mcpPort: 0 } as any);
    const first = new McpLifecycle(createMockCli(), cfgMgr, '0.6.0-dev');
    await first.start();
    const port = first.endpoint!.port;

    try {
      const busyCfgMgr = createMockConfigManager({ mcpPort: port, mcpBindAddress: '127.0.0.1' } as any);
      lifecycle = new McpLifecycle(createMockCli(), busyCfgMgr, '0.6.0-dev');
      await lifecycle.start();
      // Bind should have failed; lifecycle must report not running.
      expect(lifecycle.running).toBe(false);
    } finally {
      await first.dispose();
    }
  });
});

describe('registerMcpCommands', () => {
  it('registers start/stop/status/copyEndpointUrl', () => {
    const cfgMgr = createMockConfigManager({ mcpPort: 0 } as any);
    const lifecycle = new McpLifecycle(createMockCli(), cfgMgr, '0.6.0-dev');
    for (const d of registerMcpCommands(lifecycle, cfgMgr)) { void d; }

    const registered = vscodeMock.commands._listCommands();
    expect(registered).toContain('warpBridge.mcp.start');
    expect(registered).toContain('warpBridge.mcp.stop');
    expect(registered).toContain('warpBridge.mcp.status');
    expect(registered).toContain('warpBridge.mcp.copyEndpointUrl');
  });

  it('copyEndpointUrl warns when the server is stopped', async () => {
    const cfgMgr = createMockConfigManager({ mcpPort: 0 } as any);
    const lifecycle = new McpLifecycle(createMockCli(), cfgMgr, '0.6.0-dev');
    for (const d of registerMcpCommands(lifecycle, cfgMgr)) { void d; }

    await vscodeMock.commands.executeCommand('warpBridge.mcp.copyEndpointUrl');
    expect(vscodeMock.window.showWarningMessage).toHaveBeenCalled();
    expect(vscodeMock.env.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('copyEndpointUrl copies the URL when the server is running', async () => {
    const cfgMgr = createMockConfigManager({ mcpPort: 0 } as any);
    const lifecycle = new McpLifecycle(createMockCli(), cfgMgr, '0.6.0-dev');
    for (const d of registerMcpCommands(lifecycle, cfgMgr)) { void d; }

    await lifecycle.start();
    try {
      await vscodeMock.commands.executeCommand('warpBridge.mcp.copyEndpointUrl');
      expect(vscodeMock.env.clipboard.writeText).toHaveBeenCalledTimes(1);
      const arg = vscodeMock.env.clipboard.writeText.mock.calls[0][0] as string;
      expect(arg).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/sse$/);
    } finally {
      await lifecycle.dispose();
    }
  });
});
