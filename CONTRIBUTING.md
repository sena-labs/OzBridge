# Contributing to Warp Bridge for VS Code

Thank you for your interest in contributing! This document provides guidelines and instructions to make the contribution process smooth.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold this code.

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:

   ```bash
   git clone https://github.com/<your-username>/warp-vsc-bridge.git
   cd warp-vsc-bridge
   ```

3. **Install** dependencies:

   ```bash
   npm install
   ```

4. **Build** and verify everything works:

   ```bash
   npm run compile && npm test && npm run build
   ```

## Development Setup

### Prerequisites

- **Node.js** 18, 20, or 22 (see CI matrix)
- **VS Code** ≥ 1.96.0
- **Warp Terminal** with `oz` CLI (for manual end-to-end testing)

### Useful Commands

| Command | Description |
| --- | --- |
| `npm run compile` | Type-check with `tsc --noEmit` |
| `npm test` | Run all tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |
| `npm run build` | Build the extension (esbuild) |
| `npm run watch` | Build in watch mode |

### Running the Extension Locally

Press **F5** in VS Code to launch the Extension Development Host with the extension loaded.

## Making Changes

1. Create a feature branch from `main`:

   ```bash
   git checkout -b feature/my-feature
   ```

2. Make your changes, following the [coding standards](#coding-standards)
3. Add or update tests as needed
4. Ensure all checks pass:

   ```bash
   npm run compile && npm test
   ```

5. Commit using [conventional commit messages](#commit-messages)

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`

**Examples:**

```text
feat(commands): add /logs slash command
fix(parser): handle empty JSON arrays correctly
docs(readme): update installation instructions
test(poller): add timeout edge case tests
```

## Pull Request Process

1. Update documentation if your change affects the public API or user-facing behavior.
2. Add tests covering your changes (maintain ≥ 1.5:1 test-to-code ratio).
3. Ensure `npm run compile && npm test && npm run build` all pass.
4. Fill out the [PR template](.github/pull_request_template.md).
5. Request review from at least one maintainer.
6. PRs require all CI checks to pass before merging.

## Coding Standards

- **TypeScript** with `strict: true` — no `any` in source code
- **ES2022** target, **Node16** module resolution
- Follow existing naming conventions:
  - `camelCase` for variables and functions
  - `PascalCase` for classes and interfaces
  - `UPPER_SNAKE_CASE` for constants
- Prefix interfaces with `I` for service contracts (e.g., `IOzCliService`)
- Use factory functions `create*Command()` for slash command handlers
- Add JSDoc to all exported functions, classes, and interfaces
- Keep functions under 50 lines where possible
- Use `OzCliError` with typed `OzCliErrorKind` for all CLI error paths

## Testing

- **Framework:** [Vitest](https://vitest.dev/) v4.0.18
- **Mock strategy:** `vscode` module aliased via `vitest.config.ts`; services mocked via interface-based fakes in `test/helpers.ts`
- **Conventions:**
  - Test file mirrors source: `src/commands/runCommand.ts` → `test/commands/runCommand.test.ts`
  - Use `createMock*()` helpers from `test/helpers.ts`
  - Italian language for test descriptions (`dovrebbe ...`)
  - One `describe` block per module/function

## Reporting Bugs

Use the [Bug Report issue template](.github/ISSUE_TEMPLATE/bug_report.md) and include:

- VS Code version
- Extension version
- Warp / Oz CLI version (`oz --version`)
- Steps to reproduce
- Expected vs. actual behavior
- Relevant logs from the "Warp Bridge" output channel

## Suggesting Features

Use the [Feature Request issue template](.github/ISSUE_TEMPLATE/feature_request.md) and describe:

- The problem or use case
- Your proposed solution
- Alternatives you considered

---

Thank you for helping improve Warp Bridge! 🚀
