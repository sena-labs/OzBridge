/**
 * copilot-chat-toolkit — Reusable SDK for building VS Code Copilot Chat extensions.
 *
 * Provides robust JSON parsing, IDE context gathering, skill detection,
 * command routing, settings management, async polling, i18n, and plugin system.
 *
 * @packageDocumentation
 */

// ── Types ──────────────────────────────────────────────────────────────
export {
  // Config
  BridgeConfig,
  PollingConfig,
  // Results
  RunStatus,
  RunResult,
  ListResult,
  // Context
  DiagnosticEntry,
  ContextPayload,
  // Errors
  CliErrorKind,
  CliError,
  // Service interfaces
  IConfigManager,
  IContextCollector,
  IRunStatusProvider,
  IRunPoller,
  // Chat
  SlashCommandHandler,
  FollowupMap,
  SkillMap,
} from './types.js';

// ── Parsers ──────────────────────────────────────────────────────────
export { parse, parseOrThrow, parseOrValidate, ParseResult } from './parsers/jsonParser.js';
export { OutputFormatter, FormatterOptions } from './parsers/outputFormatter.js';

// ── Services ────────────────────────────────────────────────────────────────
export { initLogger, logInfo, logWarn, logError } from './services/logger.js';
export { ContextCollector } from './services/contextCollector.js';
export { BaseConfigManager } from './services/configManager.js';
export { BaseRunPoller } from './services/runPoller.js';

// ── Commands ────────────────────────────────────────────────────────────────
export { detectSkill } from './commands/skillDetector.js';

// ── Participant ─────────────────────────────────────────────────────────────
export { CommandRouter } from './participant/commandRouter.js';
export { FollowupProvider } from './participant/followups.js';
export { registerChatParticipant } from './participant/handler.js';
