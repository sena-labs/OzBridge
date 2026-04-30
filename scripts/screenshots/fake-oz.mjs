#!/usr/bin/env node
// ---------------------------------------------------------------------------
// fake-oz.mjs — minimal Oz CLI shim for media capture only
// ---------------------------------------------------------------------------
//
// This is **not** a functional Oz CLI; it's a fixture used by the
// `npm run screenshots:build` pipeline to produce realistic-looking
// screenshots without requiring a real Warp installation. It reads the
// argv subcommand and emits canned JSON / NDJSON to stdout.
//
// Honours `WARP_OUTPUT_FORMAT` ("json" | "ndjson") which the extension
// sets via `OzCliService.buildChildEnv()`.
//
// Used by `scripts/screenshots/capture.mts` (see `fake-oz.{cmd,sh}`
// wrappers next to this file).

import process from 'node:process';

const args = process.argv.slice(2);
const fmt = (process.env.WARP_OUTPUT_FORMAT ?? 'json').toLowerCase();

const FAKE_VERSION = 'warp 0.2026.04.29.08.02.stable_03';

// --- Fixtures --------------------------------------------------------------

const RUNS = [
  { id: 'run_01HYZF8K3M2', status: 'SUCCEEDED', created_at: '2026-04-29T11:22:18Z' },
  { id: 'run_01HYZE4P9XQ', status: 'SUCCEEDED', created_at: '2026-04-28T17:04:51Z' },
  { id: 'run_01HYZD2V7T8', status: 'SUCCEEDED', created_at: '2026-04-28T09:51:02Z' },
  { id: 'run_01HYZB1N5K0', status: 'FAILED',    created_at: '2026-04-27T22:11:33Z' },
  { id: 'run_01HYZ9G3J1Q', status: 'SUCCEEDED', created_at: '2026-04-27T14:30:09Z' },
  { id: 'run_01HYZ7C8H4B', status: 'SUCCEEDED', created_at: '2026-04-26T19:42:55Z' },
  { id: 'run_01HYZ5W2L6E', status: 'SUCCEEDED', created_at: '2026-04-26T08:07:41Z' },
  { id: 'run_01HYZ4D9R3F', status: 'SUCCEEDED', created_at: '2026-04-25T16:18:24Z' },
  { id: 'run_01HYZ2B5T7Y', status: 'FAILED',    created_at: '2026-04-25T10:55:12Z' },
  { id: 'run_01HYZ0A1S4Z', status: 'SUCCEEDED', created_at: '2026-04-24T13:39:48Z' },
];

const SCHEDULES = [
  { id: 'sched_01HYZ_NIGHTLY', name: 'nightly-test-suite',
    cron: '0 2 * * *', prompt: 'Run the full test suite and post a summary.', paused: false },
  { id: 'sched_01HYZ_DAILY',   name: 'daily-dependency-check',
    cron: '0 9 * * 1-5', prompt: 'Check npm + cargo for outdated deps.', paused: false },
  { id: 'sched_01HYZ_WEEKLY',  name: 'weekly-security-scan',
    cron: '0 6 * * 1', prompt: 'Run gitleaks + npm audit; open issues for hits.', paused: true },
];

const ENVIRONMENTS = [
  {
    id: 'env_01HYZ_NODE',
    name: 'node20-ubuntu',
    base_image: { docker_image: 'mcr.microsoft.com/devcontainers/typescript-node:20' },
    github_repos: [{ owner: 'sena-labs', repo: 'OzBridge' }],
    setup_commands: ['npm ci'],
    creator_email: 'demo@oz.local',
    last_edited: '2026-04-22T09:14:00Z',
    scope: 'team',
  },
  {
    id: 'env_01HYZ_PYTHON',
    name: 'python311-bullseye',
    base_image: { docker_image: 'mcr.microsoft.com/devcontainers/python:3.11-bullseye' },
    github_repos: [{ owner: 'sena-labs', repo: 'data-tools' }],
    setup_commands: ['pip install -r requirements.txt'],
    creator_email: 'demo@oz.local',
    last_edited: '2026-04-19T16:02:00Z',
    scope: 'personal',
  },
];

const MCP_SERVERS = [
  { uuid: 'mcp_01HYZ_GH',     name: 'github' },
  { uuid: 'mcp_01HYZ_FS',     name: 'filesystem' },
  { uuid: 'mcp_01HYZ_PG',     name: 'postgres-readonly' },
  { uuid: 'mcp_01HYZ_BRAVE',  name: 'brave-search' },
];

const MODELS = [
  { id: 'claude-opus-4.7' },
  { id: 'claude-sonnet-4.5' },
  { id: 'gpt-5' },
  { id: 'gpt-5-mini' },
  { id: 'gemini-2.5-pro' },
];

const PROFILES = [
  { id: 'prof_default', name: 'default' },
  { id: 'prof_review',  name: 'code-review' },
  { id: 'prof_docs',    name: 'docs-writer' },
];

const DRIVE_PROMPTS = [
  { id: 'cross-project',      name: 'cross-project',
    description: 'Stable engineering defaults across projects.' },
  { id: 'docker-host-first',  name: 'docker-host-first',
    description: 'Host-first workflow for Dockerised repos.' },
  { id: 'release-checklist',  name: 'release-checklist',
    description: 'Pre-release verification checklist for VS Code extensions.' },
];

const DRIVE_RULES = [
  { id: 'no-emoji-in-commits',  name: 'no-emoji-in-commits',
    description: 'Reject emoji characters in commit messages.' },
  { id: 'conventional-commits', name: 'conventional-commits',
    description: 'Enforce Conventional Commits format.' },
];

const DRIVE_SKILLS = [
  { name: '1-spec-agent',       description: 'Analyse requirements, produce specifications.' },
  { name: '2-design-agent',     description: 'Architectural design and interfaces.' },
  { name: '3-implement-agent',  description: 'Write, modify, refactor code.' },
  { name: '4-review-agent',     description: 'Review code for correctness, security.' },
  { name: '5-test-agent',       description: 'Write and maintain tests.' },
  { name: '6-deploy-agent',     description: 'CI/CD, packaging, deployment.' },
  { name: '7-maintenance-agent',description: 'Updates, bug fixes, improvements.' },
];

const INTEGRATIONS = [
  { provider: 'github',   status: 'connected' },
  { provider: 'jira',     status: 'connected' },
  { provider: 'slack',    status: 'disconnected' },
];

// --- Helpers ---------------------------------------------------------------

const j = (v) => JSON.stringify(v);

function emit(payload) {
  process.stdout.write(j(payload) + '\n');
}

function emitList(items) {
  // Both `json` and (legacy) bare modes return a single JSON array.
  // ndjson mode emits one object per line.
  if (fmt === 'ndjson') {
    for (const it of items) {
      process.stdout.write(j(it) + '\n');
    }
  } else {
    emit(items);
  }
}

function findRun(id) {
  return RUNS.find((r) => r.id === id);
}

// --- Dispatch --------------------------------------------------------------

function main() {
  // Treat the very first non-flag arg as the top-level command.
  // Strip any global flags we don't care about.
  const cmd = args[0];

  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write('fake-oz: media-only Oz CLI shim. Subcommands: run|schedule|environment|mcp|model|drive|agent|integration\n');
    return 0;
  }
  if (cmd === '--version') {
    process.stdout.write(FAKE_VERSION + '\n');
    return 0;
  }

  // `run list` / `run get <id>`
  if (cmd === 'run') {
    const sub = args[1];
    if (sub === 'list') {
      emitList(RUNS);
      return 0;
    }
    if (sub === 'get') {
      const id = args[2];
      const r = id ? findRun(id) : undefined;
      if (!r) {
        process.stderr.write(`fake-oz: unknown run id ${id}\n`);
        return 1;
      }
      emit({
        id: r.id,
        status: r.status,
        created_at: r.created_at,
        duration_ms: 12_400 + Math.floor(Math.random() * 8000),
        output: r.status === 'SUCCEEDED'
          ? 'Done. All checks passed.'
          : 'Failed: 2 tests red, see logs for details.',
      });
      return 0;
    }
  }

  if (cmd === 'schedule') {
    if (args[1] === 'list') { emitList(SCHEDULES); return 0; }
  }

  if (cmd === 'environment') {
    if (args[1] === 'list') { emitList(ENVIRONMENTS); return 0; }
  }

  if (cmd === 'mcp') {
    if (args[1] === 'list') { emitList(MCP_SERVERS); return 0; }
  }

  if (cmd === 'model') {
    if (args[1] === 'list') { emitList(MODELS); return 0; }
  }

  if (cmd === 'agent') {
    if (args[1] === 'profile' && args[2] === 'list') { emitList(PROFILES); return 0; }
  }

  if (cmd === 'integration') {
    if (args[1] === 'list') { emitList(INTEGRATIONS); return 0; }
  }

  if (cmd === 'drive') {
    const sub = args[1];
    const cat = args[2];
    if (sub === 'list') {
      if (cat === 'prompt') { emitList(DRIVE_PROMPTS); return 0; }
      if (cat === 'rule')   { emitList(DRIVE_RULES);   return 0; }
      if (cat === 'skill')  { emitList(DRIVE_SKILLS);  return 0; }
    }
    if (sub === 'get') {
      // `--id <id>` → return raw markdown (the extension does NOT force
      // WARP_OUTPUT_FORMAT=json for `drive get`).
      const idIdx = args.indexOf('--id');
      const id = idIdx >= 0 ? args[idIdx + 1] : '';
      process.stdout.write(`# ${id}\n\nFixture content for ${id}.\n`);
      return 0;
    }
  }

  process.stderr.write(`fake-oz: unhandled command: ${args.join(' ')}\n`);
  return 1;
}

const code = main();
process.exit(code);
