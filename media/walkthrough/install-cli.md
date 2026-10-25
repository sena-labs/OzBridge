# Install the Warp CLI

OzBridge drives the [Warp Oz CLI](https://www.warp.dev/download)
locally — install Warp (≥ 0.2024.x) so the extension can find the
`oz` executable on your `PATH` (on Linux typically `~/.warp/bin/oz`).

- [Download Warp](https://www.warp.dev/download)
- After installing, open a fresh terminal and run `oz --version` to
  confirm the CLI is reachable.
- Run `oz login` once in the same terminal to sign in to your Warp
  account.
- If `oz` is installed outside your `PATH`, set **Settings → Extensions
  → OzBridge → Oz Path** to the full path of the executable.

When the CLI is detected, the status bar entry will turn green and
the `@oz` chat participant becomes available.
