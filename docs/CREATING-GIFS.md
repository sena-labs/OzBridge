# Creating the GIFs for the Quick Start guide

The HTML guide (`QUICK-START.html`) has **9 placeholders** for animated GIFs.
This note explains how to record them and drop them in.

---

## GIFs to record

| # | File | What to record | Suggested length |
| --- | --- | --- | --- |
| 1 | `gif-01-download-warp.gif` | Open warp.dev → click Download → installer running | 8–12 s |
| 2 | `gif-02-verify-oz.gif` | Open PowerShell → `where oz` → output with the path | 4–6 s |
| 3 | `gif-03-oz-login.gif` | Terminal: `oz auth login` → browser opens → successful callback | 8–12 s |
| 4 | `gif-04-install-vsix.gif` | VS Code terminal: `code --install-extension ozbridge.vsix` → confirmation | 5–8 s |
| 5 | `gif-05-reload-window.gif` | Ctrl+Shift+P → type "Reload" → click Reload Window | 4–6 s |
| 6 | `gif-06-first-config.gif` | Open Copilot Chat → type `@oz /config` → see the ✅ reply | 6–10 s |
| 7 | `gif-07-run-local.gif` | Chat: `@oz /run <prompt>` → agent reply with output | 8–15 s |
| 8 | `gif-08-init.gif` | Chat: `@oz /init` → files created in the workspace | 6–8 s |
| 9 | `gif-09-settings.gif` | Ctrl+, → search "ozBridge" → change a setting | 6–8 s |

## Recommended tools

### Windows — ScreenToGif (free, open source)

```bash
winget install NickeManarin.ScreenToGif
```

1. Open ScreenToGif → **Recorder**
2. Resize the capture frame over the area you want (recommended: **800×450 px**)
3. Press **F7** to record, **F8** to stop
4. In the editor: trim the dead frames, add text if needed
5. Save as GIF at high quality (> 15 fps)

### macOS — Kap (free)

```bash
brew install --cask kap
```

### Linux — Peek (free)

```bash
sudo apt install peek
```

### Cross-platform alternative — LICEcap

Download from [cockos.com/licecap](https://www.cockos.com/licecap/)

## Recommended specs

| Property | Value |
| --- | --- |
| Resolution | 800 × 450 px (16:9) |
| Frame rate | 15 fps |
| Colours | 256 (standard GIF) |
| Size | < 2 MB per GIF |

## Adding a GIF to the guide

Save the GIFs into `docs/media/` using the file names above.

In `QUICK-START.html`, every placeholder carries a `data-media` attribute with
the file name. To activate the GIF, add an `<img>` tag inside the
`<div class="media-placeholder">`:

```html
<!-- Before (placeholder only) -->
<div class="media-placeholder" data-media="gif-06-first-config.gif">
  <div class="ph-icon">🎬</div>
  <div class="ph-label">GIF: First run...</div>
  <div class="ph-format">GIF · 16:9</div>
</div>

<!-- After (with the GIF) -->
<div class="media-placeholder" data-media="gif-06-first-config.gif">
  <img src="media/gif-06-first-config.gif" alt="First run — @oz /config">
</div>
```

The existing CSS makes the image cover the placeholder automatically.

## Current state of the repository

The repository currently holds exactly the nine GIFs listed above
(`gif-01` … `gif-09`). If you ever add a GIF #10 — a sidebar recap or an MCP
flow walkthrough, say — update both this note and `QUICK-START.html` first so
the numbering stays consistent.
