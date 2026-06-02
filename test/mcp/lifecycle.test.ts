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
      maxSseSessions: 16,
      sseMaxLifetimeMs: 1_800_000,
    });
  });

  it('uses provided values when valid', () => {
    const cfg = readMcpConfig({
      mcpEnabled: true, mcpPort: 9000, mcpBindAddress: '0.0.0.0', mcpBearerToken: 'tok',
      mcpMaxSseSessions: 32,
    } as any);
    expect(cfg).toEqual({
      enabled: true, port: 9000, bindAddress: '0.0.0.0', bearerToken: 'tok',
      maxSseSessions: 32,
      sseMaxLifetimeMs: 1_800_000,
    });
  });

  it('falls back on non-positive port', () => {
    const cfg = readMcpConfig({ mcpPort: -1 } as any);
    expect(cfg.port).toBe(3847);
  });

  it('normalises bindAddress "localhost" to 127.0.0.1 (DNS-spoof guard)', () => {
    expect(readMcpConfig({ mcpBindAddress: 'localhost' } as any).bindAddress).toBe('127.0.0.1');
    expect(readMcpConfig({ mcpBindAddress: 'LocalHost' } as any).bindAddress).toBe('127.0.0.1');
    // A genuine non-loopback bind is preserved (and gated on a token elsewhere).
    expect(readMcpConfig({ mcpBindAddress: '0.0.0.0' } as any).bindAddress).toBe('0.0.0.0');
  });
});

describe('readMcpConfig — sseMaxLifetimeMs validation', () => {
  it('uses provided mcpSseMaxLifetimeMs when within valid range [60_000, 86_400_000]', () => {
    const cfg = readMcpConfig({ mcpSseMaxLifetimeMs: 300_000 } as any);
    expect(cfg.sseMaxLifetimeMs).toBe(300_000);
  });

  it('falls back to default when mcpSseMaxLifetimeMs is below 60_000', () => {
    const cfg = readMcpConfig({ mcpSseMaxLifetimeMs: 59_999 } as any);
    expect(cfg.sseMaxLifetimeMs).toBe(1_800_000);
  });

  it('falls back to default when mcpSseMaxLifetimeMs exceeds 86_400_000', () => {
    const cfg = readMcpConfig({ mcpSseMaxLifetimeMs: 86_400_001 } as any);
    expect(cfg.sseMaxLifetimeMs).toBe(1_800_000);
  });

  it('falls back to default for non-integer mcpSseMaxLifetimeMs', () => {
    const cfg = readMcpConfig({ mcpSseMaxLifetimeMs: 120_000.5 } as any);
    expect(cfg.sseMaxLifetimeMs).toBe(1_800_000);
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

  it('serializes concurrent start/stop invocations (B1)', async () => {
    // Reproduces the off→on→off race that fire-and-forget toggles in the
    // `onConfigChanged` listener can trigger. Without serialization, the
    // pending stop() and the fresh start() interleave: the new server
    // attempts to bind while the old socket is still closing, falls back
    // to an ephemeral port, and breaks every registered client.
    const cfgMgr = createMockConfigManager({ mcpPort: 0 } as any);
    lifecycle = new McpLifecycle(createMockCli(), cfgMgr, '0.6.0-dev');

    // Fire all transitions in the same microtask before awaiting any.
    const transitions = [
      lifecycle.start(),
      lifecycle.stop(),
      lifecycle.start(),
      lifecycle.stop(),
      lifecycle.start(),
    ];
    await Promise.all(transitions);

    // Final state matches the last enqueued transition (start).
    expect(lifecycle.running).toBe(true);
    expect(lifecycle.endpoint?.port).toBeGreaterThan(0);
  });

  it('falls back to an ephemeral port when configured port is busy', async () => {
    const cfgMgr = createMockConfigManager({ mcpPort: 0 } as any);
    const first = new McpLifecycle(createMockCli(), cfgMgr, '0.6.0-dev');
    await first.start();
    const port = first.endpoint!.port;

    try {
      const busyCfgMgr = createMockConfigManager({ mcpPort: port, mcpBindAddress: '127.0.0.1' } as any);
      lifecycle = new McpLifecycle(createMockCli(), busyCfgMgr, '0.6.0-dev');
      await lifecycle.start();
      expect(lifecycle.running).toBe(true);
      expect(lifecycle.endpoint?.port).toBeGreaterThan(0);
      expect(lifecycle.endpoint?.port).not.toBe(port);
      expect(lifecycle.config?.port).toBe(lifecycle.endpoint?.port);
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
    expect(registered).toContain('ozBridge.mcp.start');
    expect(registered).toContain('ozBridge.mcp.stop');
    expect(registered).toContain('ozBridge.mcp.status');
    expect(registered).toContain('ozBridge.mcp.copyEndpointUrl');
  });

  it('copyEndpointUrl warns when the server is stopped', async () => {
    const cfgMgr = createMockConfigManager({ mcpPort: 0 } as any);
    const lifecycle = new McpLifecycle(createMockCli(), cfgMgr, '0.6.0-dev');
    for (const d of registerMcpCommands(lifecycle, cfgMgr)) { void d; }

    await vscodeMock.commands.executeCommand('ozBridge.mcp.copyEndpointUrl');
    expect(vscodeMock.window.showWarningMessage).toHaveBeenCalled();
    expect(vscodeMock.env.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('copyEndpointUrl copies the URL when the server is running', async () => {
    const cfgMgr = createMockConfigManager({ mcpPort: 0 } as any);
    const lifecycle = new McpLifecycle(createMockCli(), cfgMgr, '0.6.0-dev');
    for (const d of registerMcpCommands(lifecycle, cfgMgr)) { void d; }

    await lifecycle.start();
    try {
      await vscodeMock.commands.executeCommand('ozBridge.mcp.copyEndpointUrl');
      expect(vscodeMock.env.clipboard.writeText).toHaveBeenCalledTimes(1);
      const arg = vscodeMock.env.clipboard.writeText.mock.calls[0][0] as string;
      expect(arg).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/sse$/);
    } finally {
      await lifecycle.dispose();
    }
  });
});
