import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  McpLifecycle,
  registerMcpCommands,
  buildLocalEndpoint,
  MCP_SERVER_NAME,
  __setRegistrarFactoryForTests,
} from '../../src/mcp/lifecycle.js';
import {
  IMcpClientRegistrar,
  McpClientEndpoint,
  McpRegistrationStatus,
} from '../../src/mcp/clientRegistration.js';
import { createMockCli, createMockConfigManager } from '../helpers.js';
import * as vscodeMock from '../mocks/vscode.js';

class FakeRegistrar implements IMcpClientRegistrar {
  public registered: McpClientEndpoint | undefined;
  public unregisteredName: string | undefined;

  constructor(
    public readonly clientId: string,
    public readonly displayName: string,
    public readonly configPath: string,
    private readonly shouldThrow: boolean = false,
  ) {}

  async register(endpoint: McpClientEndpoint): Promise<void> {
    if (this.shouldThrow) { throw new Error('write failed'); }
    this.registered = endpoint;
  }

  async unregister(name: string): Promise<void> {
    if (this.shouldThrow) { throw new Error('write failed'); }
    this.unregisteredName = name;
  }

  async status(name: string): Promise<McpRegistrationStatus> {
    return this.registered?.name === name ? 'registered' : 'missing';
  }
}

let tmpdir: string;
let claude: FakeRegistrar;
let cursor: FakeRegistrar;
let codex: FakeRegistrar;
let lifecycle: McpLifecycle;

beforeEach(() => {
  vscodeMock.commands._resetCommands();
  vscodeMock.window.showInformationMessage.mockReset();
  vscodeMock.window.showWarningMessage.mockReset();
  vscodeMock.window.showErrorMessage.mockReset();
  vscodeMock.window.showQuickPick.mockReset();

  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'warp-orch-'));
  claude = new FakeRegistrar('claude-code', 'Claude Code (CLI)', path.join(tmpdir, 'claude.json'));
  cursor = new FakeRegistrar('cursor', 'Cursor', path.join(tmpdir, 'cursor.json'));
  codex = new FakeRegistrar('codex', 'Codex (CLI)', path.join(tmpdir, 'codex.toml'));
  __setRegistrarFactoryForTests(() => [claude, cursor, codex]);
});

afterEach(async () => {
  __setRegistrarFactoryForTests(undefined);
  try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch { /* ignore */ }
  await lifecycle?.dispose();
});

describe('MCP client registration commands', () => {
  it('registers both commands on the VS Code command registry', () => {
    const cfgMgr = createMockConfigManager({ mcpPort: 0 } as any);
    lifecycle = new McpLifecycle(createMockCli(), cfgMgr, '0.7.0-dev');
    for (const d of registerMcpCommands(lifecycle, cfgMgr)) { void d; }
    const cmds = vscodeMock.commands._listCommands();
    expect(cmds).toContain('ozBridge.mcp.registerClient');
    expect(cmds).toContain('ozBridge.mcp.unregisterClient');
  });

  it('warns instead of registering when the server is not running', async () => {
    const cfgMgr = createMockConfigManager({ mcpPort: 0 } as any);
    lifecycle = new McpLifecycle(createMockCli(), cfgMgr, '0.7.0-dev');
    for (const d of registerMcpCommands(lifecycle, cfgMgr)) { void d; }

    await vscodeMock.commands.executeCommand('ozBridge.mcp.registerClient');

    expect(vscodeMock.window.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(vscodeMock.window.showQuickPick).not.toHaveBeenCalled();
    expect(claude.registered).toBeUndefined();
  });

  it('registers against the registrar chosen in the QuickPick', async () => {
    const cfgMgr = createMockConfigManager({ mcpPort: 0, mcpBearerToken: 'tok' } as any);
    lifecycle = new McpLifecycle(createMockCli(), cfgMgr, '0.7.0-dev');
    for (const d of registerMcpCommands(lifecycle, cfgMgr)) { void d; }
    await lifecycle.start();

    vscodeMock.window.showQuickPick.mockResolvedValueOnce({
      label: cursor.displayName,
      description: cursor.configPath,
      registrar: cursor,
    } as any);

    await vscodeMock.commands.executeCommand('ozBridge.mcp.registerClient');

    expect(cursor.registered).toBeDefined();
    expect(cursor.registered!.name).toBe(MCP_SERVER_NAME);
    expect(cursor.registered!.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/sse$/);
    expect(cursor.registered!.bearerToken).toBe('tok');
    expect(claude.registered).toBeUndefined();
    expect(codex.registered).toBeUndefined();
  });

  it('does nothing when the user cancels the QuickPick', async () => {
    const cfgMgr = createMockConfigManager({ mcpPort: 0 } as any);
    lifecycle = new McpLifecycle(createMockCli(), cfgMgr, '0.7.0-dev');
    for (const d of registerMcpCommands(lifecycle, cfgMgr)) { void d; }
    await lifecycle.start();

    vscodeMock.window.showQuickPick.mockResolvedValueOnce(undefined as any);
    await vscodeMock.commands.executeCommand('ozBridge.mcp.registerClient');

    expect(claude.registered).toBeUndefined();
    expect(cursor.registered).toBeUndefined();
    expect(codex.registered).toBeUndefined();
    expect(vscodeMock.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('unregisterClient calls unregister(MCP_SERVER_NAME) on the chosen registrar', async () => {
    const cfgMgr = createMockConfigManager({ mcpPort: 0 } as any);
    lifecycle = new McpLifecycle(createMockCli(), cfgMgr, '0.7.0-dev');
    for (const d of registerMcpCommands(lifecycle, cfgMgr)) { void d; }

    vscodeMock.window.showQuickPick.mockResolvedValueOnce({
      label: codex.displayName,
      description: codex.configPath,
      registrar: codex,
    } as any);

    await vscodeMock.commands.executeCommand('ozBridge.mcp.unregisterClient');
    expect(codex.unregisteredName).toBe(MCP_SERVER_NAME);
  });

  it('reports errors via showErrorMessage when a registrar throws', async () => {
    const failingCodex = new FakeRegistrar('codex', 'Codex (CLI)', path.join(tmpdir, 'fail.toml'), /*shouldThrow*/ true);
    __setRegistrarFactoryForTests(() => [failingCodex]);

    const cfgMgr = createMockConfigManager({ mcpPort: 0 } as any);
    lifecycle = new McpLifecycle(createMockCli(), cfgMgr, '0.7.0-dev');
    for (const d of registerMcpCommands(lifecycle, cfgMgr)) { void d; }
    await lifecycle.start();

    vscodeMock.window.showQuickPick.mockResolvedValueOnce({
      label: failingCodex.displayName,
      description: failingCodex.configPath,
      registrar: failingCodex,
    } as any);

    await vscodeMock.commands.executeCommand('ozBridge.mcp.registerClient');

    expect(vscodeMock.window.showErrorMessage).toHaveBeenCalledTimes(1);
    const arg = vscodeMock.window.showErrorMessage.mock.calls[0][0] as string;
    expect(arg).toContain('write failed');
  });
});

describe('buildLocalEndpoint', () => {
  it('uses the running endpoint when present and forwards the bearer token', async () => {
    const cfgMgr = createMockConfigManager({ mcpPort: 0, mcpBearerToken: 'abc' } as any);
    lifecycle = new McpLifecycle(createMockCli(), cfgMgr, '0.7.0-dev');
    await lifecycle.start();

    const endpoint = buildLocalEndpoint(lifecycle, cfgMgr);
    expect(endpoint.name).toBe(MCP_SERVER_NAME);
    expect(endpoint.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/sse$/);
    expect(endpoint.bearerToken).toBe('abc');
  });

  it('falls back to the configured address/port when the server is stopped', async () => {
    const cfgMgr = createMockConfigManager({ mcpPort: 9999, mcpBindAddress: '127.0.0.1' } as any);
    lifecycle = new McpLifecycle(createMockCli(), cfgMgr, '0.7.0-dev');

    const endpoint = buildLocalEndpoint(lifecycle, cfgMgr);
    expect(endpoint.url).toBe('http://127.0.0.1:9999/sse');
    expect(endpoint.bearerToken).toBeUndefined();
  });
});
