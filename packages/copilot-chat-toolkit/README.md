# copilot-chat-toolkit

> Reusable SDK for building VS Code Copilot Chat extensions.

## What it provides

| Module | Description |
|--------|-------------|
| **JSON Parser** | 5-level robust parser for extracting JSON from mixed CLI output |
| **Output Formatter** | Renders agent results, lists, and errors to Copilot Chat streams |
| **Context Collector** | Gathers IDE state (workspace, file, selection, diagnostics) for prompt injection |
| **Skill Detector** | Keyword-based intent recognition from natural language prompts |
| **Config Manager** | Generic VS Code settings wrapper with caching and change events |
| **Run Poller** | Async polling with exponential backoff, cancellation, and progress callbacks |
| **Command Router** | Slash-command dispatch table for Chat Participants |
| **Follow-up Provider** | Contextual next-step suggestions after each command |
| **Participant Helper** | One-call registration of a Chat Participant with icon and follow-ups |

## Quick start

```typescript
import {
  CliError,
  CliErrorKind,
  ContextCollector,
  BaseConfigManager,
  CommandRouter,
  FollowupProvider,
  registerChatParticipant,
  parse,
  detectSkill,
  initLogger,
} from 'copilot-chat-toolkit';
```

## Requirements

- VS Code `^1.96.0`
- Node.js `>=20`

## License

MIT
