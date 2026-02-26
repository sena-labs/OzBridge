# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security of Warp Bridge for VS Code seriously. If you discover a security vulnerability, please report it responsibly.

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

- **Input sanitization** — all user-supplied IDs are validated against `[a-zA-Z0-9_-]+` before passing to CLI
- **No shell expansion** — `child_process.spawn` with explicit args (no shell interpolation on non-Windows)
- **No credential storage** — authentication is delegated entirely to the Oz CLI
- **Minimal permissions** — the extension requests only the VS Code Chat API
- **Zero runtime dependencies** — reduces supply-chain attack surface

## Disclosure Policy

- We follow [coordinated vulnerability disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure)
- We aim to release patches within 14 days of confirming a vulnerability
- Security advisories are published via GitHub Security Advisories
