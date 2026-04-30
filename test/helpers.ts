/**
 * Test helpers — factory per mock dei servizi e del ChatResponseStream.
 */
import { vi } from 'vitest';
import {
  OzBridgeConfig,
  DEFAULT_CONFIG,
  IOzCliService,
  IConfigManager,
  IContextCollector,
  IRunPoller,
  ContextPayload,
  OzRunResult,
  OzRunStatus,
  OzListResult,
} from '../src/types/index.js';

// ---------------------------------------------------------------------------
// Mock ChatResponseStream
// ---------------------------------------------------------------------------
export function createMockStream() {
  const markdownParts: string[] = [];
  const buttons: Array<{ command: string; title: string; arguments?: unknown[] }> = [];
  const progresses: string[] = [];

  const stream = {
    markdown: vi.fn((text: string) => { markdownParts.push(text); }),
    button: vi.fn((btn: { command: string; title: string; arguments?: unknown[] }) => { buttons.push(btn); }),
    progress: vi.fn((text: string) => { progresses.push(text); }),
  };

  return {
    stream,
    markdownParts,
    buttons,
    progresses,
    getFullOutput: () => markdownParts.join(''),
  };
}

// ---------------------------------------------------------------------------
// Mock CancellationToken
// ---------------------------------------------------------------------------
export function createMockToken(cancelled = false) {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

// ---------------------------------------------------------------------------
// Mock IConfigManager
// ---------------------------------------------------------------------------
export function createMockConfigManager(overrides?: Partial<OzBridgeConfig>): IConfigManager {
  const config: OzBridgeConfig = { ...DEFAULT_CONFIG, ...overrides };
  const emitter = { event: vi.fn(), fire: vi.fn(), dispose: vi.fn() };

  return {
    getConfig: vi.fn(() => config),
    onConfigChanged: emitter.event,
    dispose: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Mock IOzCliService
// ---------------------------------------------------------------------------
type MockedCliService = { [K in keyof IOzCliService]: ReturnType<typeof vi.fn> };

export function createMockCli(): IOzCliService & MockedCliService {
  return {
    checkAvailability: vi.fn(),
    agentRun: vi.fn(),
    agentRunCloud: vi.fn(),
    runList: vi.fn(),
    runGet: vi.fn(),
    scheduleCreate: vi.fn(),
    scheduleList: vi.fn(),
    scheduleGet: vi.fn(),
    scheduleUpdate: vi.fn(),
    schedulePause: vi.fn(),
    scheduleUnpause: vi.fn(),
    scheduleDelete: vi.fn(),
    artifactGet: vi.fn(),
    artifactDownload: vi.fn(),
    secretList: vi.fn(),
    secretCreate: vi.fn(),
    secretUpdate: vi.fn(),
    secretDelete: vi.fn(),
    modelList: vi.fn(),
    mcpList: vi.fn(),
    profileList: vi.fn(),
    environmentList: vi.fn(),
    integrationList: vi.fn(),
    driveList: vi.fn(),
    driveGet: vi.fn(),
    agentContinue: vi.fn(),
    helpAgentRun: vi.fn(),
  } as unknown as IOzCliService & MockedCliService;
}

// ---------------------------------------------------------------------------
// Mock IContextCollector
// ---------------------------------------------------------------------------
export function createMockContextCollector(payload?: Partial<ContextPayload>): IContextCollector {
  const defaultPayload: ContextPayload = {
    workspacePath: '/workspace',
    activeFilePath: '/workspace/main.ts',
    activeFileLanguageId: 'typescript',
    selection: null,
    diagnostics: [],
    ...payload,
  };

  return {
    gather: vi.fn(() => defaultPayload),
    formatForPrompt: vi.fn((_p: ContextPayload) => '[CONTEXT]\nWorkspace: /workspace\n[/CONTEXT]'),
  };
}

// ---------------------------------------------------------------------------
// Mock IRunPoller
// ---------------------------------------------------------------------------
export function createMockPoller(): IRunPoller {
  return {
    poll: vi.fn(),
    disposeAll: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Run Result factory
// ---------------------------------------------------------------------------
export function makeRunResult(overrides?: Partial<OzRunResult>): OzRunResult {
  return {
    runId: 'run-123',
    status: 'SUCCEEDED' as OzRunStatus,
    output: 'Hello from agent',
    exitCode: 0,
    durationMs: 2000,
    raw: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// List Result factory
// ---------------------------------------------------------------------------
export function makeListResult<T>(items: T[], rawText?: string): OzListResult<T> {
  return { items, rawText };
}
