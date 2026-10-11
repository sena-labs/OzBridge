import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workspace } from '../../test/mocks/vscode.js';
import { ConfigManager } from '../../src/services/configManager.js';
import { DEFAULT_CONFIG } from '../../src/types/index.js';

beforeEach(() => {
  vi.clearAllMocks();
  workspace.getConfiguration.mockReturnValue({
    get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
  });
});

describe('ConfigManager', () => {
  // --- getConfig() ---
  describe('getConfig()', () => {
    it('returns the default configuration', () => {
      const mgr = new ConfigManager();
      const config = mgr.getConfig();
      expect(config.ozPath).toBe(DEFAULT_CONFIG.ozPath);
      expect(config.defaultModel).toBe(DEFAULT_CONFIG.defaultModel);
      expect(config.timeoutMs).toBe(DEFAULT_CONFIG.timeoutMs);
      expect(config.maxOutputChars).toBe(DEFAULT_CONFIG.maxOutputChars);
      mgr.dispose();
    });

    it('reads custom values from the VS Code configuration', () => {
      workspace.getConfiguration.mockReturnValue({
        get: vi.fn((key: string, defaultValue?: unknown) => {
          if (key === 'ozPath') return '/custom/oz';
          if (key === 'timeoutMs') return 60000;
          return defaultValue;
        }),
      });

      const mgr = new ConfigManager();
      const config = mgr.getConfig();
      expect(config.ozPath).toBe('/custom/oz');
      expect(config.timeoutMs).toBe(60000);
      mgr.dispose();
    });

    it('caches the configuration', () => {
      const mgr = new ConfigManager();
      const config1 = mgr.getConfig();
      const config2 = mgr.getConfig();
      expect(config1).toBe(config2); // Same reference (cache)
      expect(workspace.getConfiguration).toHaveBeenCalledTimes(1);
      mgr.dispose();
    });

    it('reads from the "ozBridge" section', () => {
      const mgr = new ConfigManager();
      mgr.getConfig();
      expect(workspace.getConfiguration).toHaveBeenCalledWith('ozBridge');
      mgr.dispose();
    });

    it('reads all config fields with custom values', () => {
      workspace.getConfiguration.mockReturnValue({
        get: vi.fn((key: string, _default?: unknown) => {
          const customValues: Record<string, unknown> = {
            ozPath: '/custom/oz',
            defaultModel: 'gpt-4-turbo',
            defaultProfile: 'staging-profile',
            defaultEnvironment: 'production',
            cloudPollingIntervalMs: 10_000,
            cloudPollingTimeoutMs: 600_000,
            timeoutMs: 120_000,
            maxOutputChars: 8_000,
          };
          return customValues[key];
        }),
      });

      const mgr = new ConfigManager();
      const config = mgr.getConfig();
      expect(config.ozPath).toBe('/custom/oz');
      expect(config.defaultModel).toBe('gpt-4-turbo');
      expect(config.defaultProfile).toBe('staging-profile');
      expect(config.defaultEnvironment).toBe('production');
      expect(config.cloudPollingIntervalMs).toBe(10_000);
      expect(config.cloudPollingTimeoutMs).toBe(600_000);
      expect(config.timeoutMs).toBe(120_000);
      expect(config.maxOutputChars).toBe(8_000);
      mgr.dispose();
    });
  });

  // --- Config change ---
  describe('config change', () => {
    it('invalidates the cache on a configuration change', () => {
      // Capture the callback registered on onDidChangeConfiguration
      let changeCallback: ((e: any) => void) | undefined;
      workspace.onDidChangeConfiguration.mockImplementation((cb: any) => {
        changeCallback = cb;
        return { dispose: vi.fn() };
      });

      const mgr = new ConfigManager();
      mgr.getConfig(); // Populate the cache
      expect(workspace.getConfiguration).toHaveBeenCalledTimes(1);

      // Simulate a configuration change
      changeCallback?.({ affectsConfiguration: (s: string) => s === 'ozBridge' });

      mgr.getConfig(); // Should re-read
      expect(workspace.getConfiguration).toHaveBeenCalledTimes(2);
      mgr.dispose();
    });

    it('ignores changes to other sections', () => {
      let changeCallback: ((e: any) => void) | undefined;
      workspace.onDidChangeConfiguration.mockImplementation((cb: any) => {
        changeCallback = cb;
        return { dispose: vi.fn() };
      });

      const mgr = new ConfigManager();
      mgr.getConfig();
      changeCallback?.({ affectsConfiguration: (s: string) => s === 'editor' });
      mgr.getConfig();
      // Only 1 call — cache not invalidated
      expect(workspace.getConfiguration).toHaveBeenCalledTimes(1);
      mgr.dispose();
    });

    // Gap: onConfigChanged emits the updated config
    it('emits the onConfigChanged event with the updated config', () => {
      let changeCallback: ((e: any) => void) | undefined;
      workspace.onDidChangeConfiguration.mockImplementation((cb: any) => {
        changeCallback = cb;
        return { dispose: vi.fn() };
      });

      const mgr = new ConfigManager();
      const listener = vi.fn();
      mgr.onConfigChanged(listener);

      // First getConfig with defaults
      mgr.getConfig();

      // Change the configuration
      workspace.getConfiguration.mockReturnValue({
        get: vi.fn((key: string, defaultValue?: unknown) => {
          if (key === 'ozPath') return '/new/oz';
          return defaultValue;
        }),
      });

      changeCallback?.({ affectsConfiguration: (s: string) => s === 'ozBridge' });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ ozPath: '/new/oz' }),
      );
      mgr.dispose();
    });
  });

  // --- dispose() ---
  describe('dispose()', () => {
    it('releases resources without errors', () => {
      const disposeFn = vi.fn();
      workspace.onDidChangeConfiguration.mockReturnValue({ dispose: disposeFn });

      const mgr = new ConfigManager();
      mgr.dispose();
      expect(disposeFn).toHaveBeenCalled();
    });
  });
});
