# OzBridge demo workspace

This is a fixture workspace used by `npm run screenshots:build` to render
marketing screenshots of the OzBridge VS Code extension. It points the
`ozBridge.ozPath` user setting at `scripts/screenshots/fake-oz.{cmd,sh}`
so the extension boots against canned fixture data without requiring a
real Warp install.

Do not commit edits made by VS Code at runtime — the capture script
copies a clean baseline into a temporary `--user-data-dir` on every run.
