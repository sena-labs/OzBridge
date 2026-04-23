# Security Policy

## Supported Versions

OzBridge follows an **18-month LTS** policy on the latest minor
release and best-effort backports on the previous one.

| Version | Status              | Security fixes  |
| ------- | ------------------- | --------------- |
| 0.9.x   | :white_check_mark:  | active LTS      |
| 0.8.x   | :white_check_mark:  | critical only   |
| ≤ 0.7.x | :x:                 | end-of-life     |

The v1.0 line will become the active LTS upon GA; 0.9.x will move to
`critical only` and 0.8.x to EOL.

## Reporting a Vulnerability

We take the security of OzBridge for VS Code seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please send an email to **<isena86@gmail.com>** with:

1. **Description** of the vulnerability
2. **Steps to reproduce** the issue
3. **Impact assessment** — what an attacker could achieve
4. **Affected versions** — which version(s) are impacted
5. **Suggested fix** (if you have one)

### What to Expect

- **Acknowledgment** within 48 hours of your report
- **Initial assessment** within 5 business days
- **Fix timeline** communicated within 10 business days
- **Credit** in the release notes (unless you prefer to remain anonymous)

### Scope

The following are in scope for security reports:

- Command injection via user-supplied input passed to `oz` CLI
- Path traversal in file operations (e.g., `/init` scaffolding)
- Sensitive data exposure (credentials, tokens, environment variables)
- Improper input validation leading to unexpected CLI behavior
- Dependencies with known CVEs

### Out of Scope

- Vulnerabilities in the `oz` CLI itself (report to [Warp](https://www.warp.dev/))
- VS Code platform vulnerabilities (report to [Microsoft](https://msrc.microsoft.com/))
- Social engineering attacks
- Denial of service via excessive configuration values

### Security Measures

This extension implements the following security practices:

- **Input sanitization** — all user-supplied IDs are validated against `[a-zA-Z0-9_-]+` before passing to CLI.
- **No shell expansion** — `child_process.spawn` with explicit args (no shell interpolation on non-Windows).
- **No credential storage** — authentication is delegated entirely to the Oz CLI.
- **Minimal permissions** — the extension requests only the VS Code Chat API + LM Tools.
- **Zero runtime dependencies** — reduces supply-chain attack surface (only the workspace package `copilot-chat-toolkit` is bundled).
- **Telemetry off by default** — see [`PRIVACY.md`](./PRIVACY.md). Doubly gated by `vscode.env.isTelemetryEnabled` *and* an explicit AppInsights connection string; a hard-coded deny-list refuses to transmit prompt content, run IDs, output, file paths, workspace paths, stack traces or tokens.

### Automated Security Gates (v1.0 deliverable Q)

Every PR and every push to `main` runs:

- **CodeQL** (`.github/workflows/codeql.yml`) — `security-extended` + `security-and-quality` query suites for JavaScript/TypeScript. Findings surface in the repository's Security tab and block PRs at `error` severity. Weekly cron on Monday 06:00 UTC catches CVEs landing between releases.
- **`npm audit`** (`.github/workflows/security.yml` job `audit`) — fails the PR on any high or critical advisory in the *production* dependency closure (`--omit=dev --audit-level=high`). Dev dependencies are excluded because they don't ship in the VSIX.
- **Secret scan** (`.github/workflows/security.yml` job `secret-scan`) — `gitleaks` against full git history. Any committed credential blocks the PR.
- **Dependabot** (`.github/dependabot.yml`) — weekly grouped updates for npm, the `packages/copilot-chat-toolkit` workspace and GitHub Actions, with reviewer auto-assignment to `sena-labs/maintainers`.

## Disclosure Policy

- We follow [coordinated vulnerability disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure)
- We aim to release patches within 14 days of confirming a vulnerability
- Security advisories are published via GitHub Security Advisories

## Kill-switch (v1.0 deliverable T)

For incident response we ship an operator escape hatch. Setting

```jsonc
// VS Code settings.json (per-user or per-workspace)
{
  "ozBridge.killSwitch.enabled": true,
  "ozBridge.killSwitch.reason": "Investigating SEC-2026-04-21"
}
```

makes `activate()` skip every wiring step (no commands, tools, MCP
server, chat participant or trees are registered) and surface a
single warning notification with the optional reason text. The
extension stays installed and can be re-enabled by flipping the
boolean back to `false` — no reload required for new windows. Use it
only for:

- A confirmed critical regression that we cannot patch within hours.
- An active supply-chain incident pending mitigation.
- Targeted org-wide rollback before an emergency VSIX republish.

Both settings have scope `machine-overridable`, so platform teams
can ship them via a workspace-level `.vscode/settings.json` to disable
the extension fleet-wide while a fix is in flight.

## LTS Policy (v1.0 deliverable T)

The support matrix at the top of this document is governed by the
following rules:

| Policy item                | Commitment                                                                 |
| -------------------------- | -------------------------------------------------------------------------- |
| Active LTS lifetime        | **18 months** from the GA release of a minor line                          |
| Critical-only window       | **6 months** after a new minor takes over as Active LTS                    |
| Backport scope             | Critical security fixes (CVSS ≥ 7.0) and data-loss bugs                    |
| Maintenance branch         | `release/v<major>.<minor>.x` cut at GA, kept until EOL                     |
| Patch cadence              | Best-effort; security patches within 14 days of confirmed vulnerability    |
| Deprecation notice         | At least one minor release before EOL, called out in `CHANGELOG.md`        |
| EOL announcement           | GitHub Release notes + `SECURITY.md` table refresh on every transition     |

The matrix is asserted by the security-gates test suite — any
silent change to the supported-versions table will fail CI.
