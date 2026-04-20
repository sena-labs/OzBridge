# Privacy policy — Warp Bridge for VS Code

**Last updated:** 2026-04-20  
**Applies to:** Warp Bridge for VS Code `≥ 0.10.0` (the v1.0 line).

## TL;DR

Warp Bridge ships **no telemetry by default**. The transport stays
disabled until **both** of the following are true:

1. VS Code's global `telemetry.telemetryLevel` is set to `usage` or
   `all` (i.e. `vscode.env.isTelemetryEnabled === true`).
2. The setting `warpBridge.telemetry.connectionString` is set to a
   non-empty Application Insights connection string.

Either condition false ⇒ a **`NoopReporter`** is installed and no
network traffic ever originates from the telemetry pipeline.

## What we collect (only when enabled)

The pipeline emits a closed set of typed events. Each event carries
*only* the properties listed below — the type system + a runtime
deny-list assertion (`FORBIDDEN_KEY_REGEX` in
`src/services/telemetry.ts`) refuse to ship anything else.

| Event                | Payload                              | Purpose                                   |
| -------------------- | ------------------------------------ | ----------------------------------------- |
| `extensionActivated` | `{ version }`                        | Adoption + version distribution           |
| `commandInvoked`     | `{ command }`                        | Which features get used                   |
| `runStarted`         | `{ kind: 'local' \| 'cloud' }`       | Local vs cloud usage split                |
| `runCompleted`       | `{ status, durationMs }`             | Failure rate, perf trends (no run id)     |
| `errorRaised`        | `{ kind }`                           | Triage common failure classes             |

Plus the AppInsights envelope: extension `version` and a static role
tag (`warp-vsc-bridge`).

## What we **never** collect

The following property names are **hard-coded** as forbidden and will
cause the event to be dropped (and a warning logged) if any handler
accidentally tries to emit them:

> `prompt`, `content`, `output`, `path`, `workspace`, `runid`,
> `message`, `stack`, `email`, `user`, `token`

In practice this means we never transmit:

- Prompt content or any user-typed text.
- Run IDs, run output, NDJSON event streams, dataset exports.
- File paths or workspace paths (absolute *or* relative).
- Stack traces, error messages, log lines.
- Identifiers tied to your Warp / Oz / GitHub account.
- Authentication tokens, MCP bearer tokens, connection strings.

Microsoft's standard Application Insights tags
(`ai.application.ver`, `ai.cloud.role`) are sent because they are
required by the ingestion endpoint; both are static and contain no
user-identifying data.

## How to opt out

Any **one** of these disables telemetry immediately and permanently
for your install — no extension reload required:

1. Set `telemetry.telemetryLevel` to `off` in VS Code settings.
2. Clear `warpBridge.telemetry.connectionString` (set it to `""`).
3. Disable the extension.

When opted out, the extension installs a `NoopReporter` whose
`track()` is a literal no-op — there is no buffer, no timer, no
network code path executed.

## Endpoint

When enabled, events are POSTed in batches to the Microsoft
Application Insights ingestion endpoint encoded in the
`warpBridge.telemetry.connectionString` setting (typically
`https://*.in.applicationinsights.azure.com/v2/track`). The endpoint
is part of an Azure subscription owned by **Sena Labs**; contact
[security@sena-labs.dev](mailto:security@sena-labs.dev) for the
current data-residency region.

## Retention

Aggregated counts and durations are kept for 90 days for trend
analysis. Raw events are not retained.

## Subprocessors

Microsoft Azure Application Insights is the only subprocessor
involved in telemetry processing. It is bound by the
[Microsoft Online Services DPA](https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA).

## Source of truth

The privacy contract is enforced by code, not just by this document.
The relevant files are:

- [`src/services/telemetry.ts`](src/services/telemetry.ts) — reporter
  contract, deny-list, transport.
- [`test/services/telemetry.test.ts`](test/services/telemetry.test.ts)
  — opt-in respect, deny-list assertion, transport stubs.

If you spot a divergence between the code and this document, please
treat it as a **security bug** and report it via
`SECURITY.md` ahead of opening a public issue.
