# Contributing to OzBridge for VS Code

Thanks for wanting to contribute! This document is intentionally
opinionated: it codifies the **deliverable-PR playbook** the
maintainers use day-to-day so new contributors can ship changes with
the same cadence and quality.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting started](#getting-started)
- [Development setup](#development-setup)
- [Deliverable-PR playbook](#deliverable-pr-playbook)
- [Commit messages](#commit-messages)
- [Coding standards](#coding-standards)
- [Testing](#testing)
- [Bundle budget](#bundle-budget)
- [Localization (l10n)](#localization-l10n)
- [Reporting bugs](#reporting-bugs)
- [Suggesting features](#suggesting-features)

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).
By participating, you agree to uphold this code.

## Getting started

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally:

   ```bash
   git clone https://github.com/<your-username>/OzBridge.git
   cd OzBridge
   ```

3. **Install** dependencies:

   ```bash
   npm install
   ```

4. **Verify** the baseline is green before changing anything:

   ```bash
   npm run compile && npm test -- --run && npm run build
   ```

## Development setup

### Prerequisites

- **Node.js** `20.19` or `22.12` (matches the CI matrix).
- **VS Code** ≥ `1.96.0`.
- **Warp Terminal** with the `oz` CLI — only required for manual
  end-to-end testing; unit tests run against a mocked `vscode` module.

### Useful commands

| Command | Description |
| --- | --- |
| `npm run compile` | Type-check with `tsc --noEmit` |
| `npm test -- --run` | Run the full Vitest suite once (non-watch) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |
| `npm run build` | Build the extension bundle (esbuild) |
| `npm run watch` | Build in watch mode |
| `npm run package` | Produce a `.vsix` package |

Press **F5** in VS Code to launch the Extension Development Host.

## Deliverable-PR playbook

Every change in this repo is shipped as a **single-deliverable pull
request**. One PR = one reviewable unit of value. The playbook:

1. **Sync `main`** and branch with a descriptive slug:

   ```bash
   git checkout main && git pull
   git checkout -b feat/<milestone>-<slug>
   ```

2. **Implement** the smallest complete slice of the deliverable.
   Prefer surgical edits over incidental refactors.
3. **Add or update tests.** A change without test coverage needs a
   written justification in the PR body. Aim to keep the overall
   test-to-code ratio healthy (≥ 1.5 : 1).
4. **Validate locally** on the same commands CI runs:

   ```bash
   npm run compile
   npm test -- --run
   npm run build
   ```

5. **Update `CHANGELOG.md`.** Prepend a bullet under `## [Unreleased]`
   describing the user-visible impact. Keep entries terse and reference
   the deliverable letter when applicable (e.g. `v0.9 deliverable N`).
6. **Write the PR body** using the three-section template:

   ```markdown
   ## What
   - bullet 1
   - bullet 2

   ## Verification
   - `npm run compile` — clean.
   - `npm test -- --run` — **<count> / <count>** green.
   - Bundle size: **XX.XX KB** (budget 145 KB).

   ## Next
   - Follow-up 1
   ```

7. **Commit with Conventional Commits** (see
   [Commit messages](#commit-messages)) and push:

   ```bash
   git push -u origin feat/<milestone>-<slug>
   ```

8. **Open & auto-merge** the PR:

   ```bash
   gh pr create --base main --head feat/<milestone>-<slug> \
     --title "<conventional title>" --body-file pr-body.md
   gh pr merge <branch> --squash --delete-branch --auto
   ```

9. **Verify CI** (2 × 3 matrix + bundle budget) goes green. A red
   matrix leg blocks the squash-merge — fix forward rather than
   disabling the check.

Keep the branch focused: if the diff grows beyond ~400 lines of
non-generated code, split it.

### Telemetry safety checklist (required when touching telemetry events)

When adding/changing any key in `TelemetryEventMap` (`src/services/telemetry.ts`):

- Ensure no property name matches forbidden patterns (`prompt`, `content`, `output`, `path`, `workspace`, `runId`, `message`, `stack`, `email`, `user`, `token`).
- Run `npm test -- --run test/services/telemetry.test.ts` and confirm the deny-list suite is green.
- If a new event is introduced, update test fixtures in `test/services/telemetry.test.ts` in the same PR.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
`build`, `ci`, `chore`.

**Examples:**

```text
feat(commands): add /logs slash command
fix(parser): handle empty JSON arrays correctly
ci: add bundle-budget workflow (v0.9 deliverable N)
```

The **squash-merge commit title** must stay Conventional; that's what
ends up in `CHANGELOG`-adjacent tooling and GitHub release notes.

## Coding standards

- **TypeScript** with `strict: true` — no `any` in source code.
- **ES2022** target, **Node16** module resolution.
- Naming:
  - `camelCase` for variables and functions.
  - `PascalCase` for classes and interfaces.
  - `UPPER_SNAKE_CASE` for constants.
- Prefix service contracts with `I` (e.g. `IOzCliService`).
- Use factory functions `create*Command()` for slash-command handlers.
- JSDoc every exported symbol.
- Keep functions under ~50 lines; extract helpers when they grow.
- Route all CLI error paths through `OzCliError` + `OzCliErrorKind`.

## Testing

- **Framework:** [Vitest](https://vitest.dev/) `4.0.18`.
- **Mock strategy:** the `vscode` module is aliased in
  `vitest.config.ts`; service boundaries are mocked via interface-based
  fakes in `test/helpers.ts`.
- **Conventions:**
  - Test path mirrors source path: `src/commands/runCommand.ts` ↔
    `test/commands/runCommand.test.ts`.
  - Use `createMock*()` helpers from `test/helpers.ts`.
  - Italian language for test descriptions (`dovrebbe …`).
  - One top-level `describe` per module/function.
- **Run the suite the same way CI does:** `npm test -- --run`. Watch
  mode is fine for authoring, but never rely on it for validation.

## Bundle budget

CI enforces a **145 KB** ceiling on `dist/extension.js` via
`.github/workflows/bundle-budget.yml`. Before opening a PR, confirm
locally:

```bash
npm run build
# On PowerShell:
(Get-Item dist/extension.js).Length
# On bash:
wc -c dist/extension.js
```

Include the resulting size in the PR body's **Verification** section.
If your change pushes the bundle over budget, either trim the diff or
open a scoped discussion before merging — don't raise the limit by
default.

## Localization (l10n)

User-facing strings live in:

- `package.nls.json` (+ `package.nls.it.json`, `package.nls.es.json`)
  for manifest contributions.
- `l10n/bundle.l10n.json` (+ `.it`, `.es`) for runtime strings surfaced
  via `vscode.l10n.t()`.

When you add a string:

1. Introduce the key in the **English** bundle first.
2. Mirror the key in every sibling locale (even if the translation is
   a placeholder — never leave a locale missing a key).
3. Use `vscode.l10n.t('your.key', { N: value })` at the call site —
   no inline English strings in handlers.

The consistency tests in `test/l10n*.test.ts` will fail loudly if
keys drift across bundles.

## Reporting bugs

Use the [Bug Report issue template](.github/ISSUE_TEMPLATE/bug_report.md)
and include:

- VS Code version.
- Extension version.
- Warp / Oz CLI version (`oz --version`).
- Steps to reproduce.
- Expected vs. actual behavior.
- Relevant logs from the **OzBridge** output channel.

## Suggesting features

Use the [Feature Request issue template](.github/ISSUE_TEMPLATE/feature_request.md)
and describe:

- The problem or use case.
- Your proposed solution.
- Alternatives you considered.

---

Thanks for helping improve OzBridge! 🚀
