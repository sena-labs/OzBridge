from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
MEDIA_DIR = ROOT / 'media'
PROMPT_PACK_PATH = ROOT / 'scripts' / 'generated-media-prompts.json'

# ---------------------------------------------------------------------------
# VS Code Dark+ theme exact color values
# These match vscode's built-in Dark+ theme variables used in the extension.
# ---------------------------------------------------------------------------
PALETTE = {
    # VS Code chrome
    'titlebar': '#3c3c3c',
    'activity': '#333333',
    'sidebar': '#252526',
    'sidebar_border': '#3c3c3c',
    'sidebar_header': '#3c3c3c',
    'editor': '#1e1e1e',
    'tab_bar': '#2d2d2d',
    'tab_active': '#1e1e1e',
    'tab_inactive': '#2d2d2d',
    'tab_border': '#252526',
    'breadcrumb': '#1e1e1e',
    'status': '#007acc',
    'status_text': '#ffffff',
    'window_bg': '#1e1e1e',
    # Text
    'text': '#cccccc',
    'text_strong': '#d4d4d4',
    'muted': '#868686',
    'description': '#868686',
    # Borders / surfaces
    'border': '#3c3c3c',
    'widget_bg': '#252526',
    'surface': '#2a2d2e',
    'hover': '#2a2d2e',
    'selection': '#094771',
    'selection_text': '#ffffff',
    # Accent / charts
    'blue': '#75beff',
    'blue_button': '#0e639c',
    'blue_button_hover': '#1177bb',
    'cyan': '#4ec9b0',
    'green': '#89d185',
    'yellow': '#cca700',
    'orange': '#ce9178',
    'red': '#f48771',
    'purple': '#c586c0',
    # Icon colors used by Codicon ThemeIcons in VS Code
    'icon_default': '#c5c5c5',
    'icon_green': '#89d185',
    'icon_red': '#f48771',
    'icon_yellow': '#cca700',
    'icon_blue': '#75beff',
}

SCREEN_W = 1300
SCREEN_H = 800

# VS Code layout constants (pixels)
TITLEBAR_H = 35
TABBAR_H = 35
ACTIVITY_W = 48
SIDEBAR_W = 300
STATUSBAR_H = 22
BREADCRUMB_H = 22




# ---------------------------------------------------------------------------
# Font helpers
# ---------------------------------------------------------------------------

def _font_candidates(bold: bool = False, mono: bool = False) -> list[str]:
    win = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts'
    if mono:
        return [
            str(win / 'consola.ttf'),
            str(win / 'consolab.ttf'),
            '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
        ]
    if bold:
        return [
            str(win / 'segoeuib.ttf'),
            str(win / 'seguisb.ttf'),
            str(win / 'arialbd.ttf'),
            '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        ]
    return [
        str(win / 'segoeui.ttf'),
        str(win / 'arial.ttf'),
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ]


def load_font(size: int, bold: bool = False, mono: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in _font_candidates(bold=bold, mono=mono):
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default()


# ---------------------------------------------------------------------------
# Drawing primitives
# ---------------------------------------------------------------------------

def rounded_rect(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], radius: int, fill: str, outline: str | None = None, width: int = 1) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def save_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format='PNG', optimize=True)


def hex_color(color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    """Convert a hex color string to an RGBA tuple."""
    h = color.lstrip('#')
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (r, g, b, alpha)


# ---------------------------------------------------------------------------
# VS Code window shell
# ---------------------------------------------------------------------------

def draw_window_shell(
    img: Image.Image,
    draw: ImageDraw.ImageDraw,
    sidebar_title: str,
    editor_tabs: list[str],
    active_tab_idx: int = 0,
    status_text_left: str = 'OzBridge  •  v1.1.0',
    status_text_right: str = 'UTF-8   TypeScript',
) -> None:
    """Paint the VS Code chrome (titlebar, activity bar, sidebar, tab bar, status bar)."""
    W, H = SCREEN_W, SCREEN_H
    editor_x = ACTIVITY_W + SIDEBAR_W

    # ── Titlebar ────────────────────────────────────────────────────────────
    draw.rectangle((0, 0, W, TITLEBAR_H), fill=PALETTE['titlebar'])
    f_title = load_font(13)
    draw.text((W // 2, TITLEBAR_H // 2), 'OzBridge — VS Code', font=f_title, fill=PALETTE['muted'], anchor='mm')
    # Windows-style min/max/close dots (right side)
    for i, clr in enumerate(['#858585', '#858585', '#858585']):
        cx = W - 58 + i * 22
        draw.rectangle((cx - 6, TITLEBAR_H // 2 - 5, cx + 6, TITLEBAR_H // 2 + 5), fill=clr)

    # ── Activity bar ────────────────────────────────────────────────────────
    draw.rectangle((0, TITLEBAR_H, ACTIVITY_W, H - STATUSBAR_H), fill=PALETTE['activity'])
    # Active indicator strip
    draw.rectangle((0, TITLEBAR_H + 8, 2, TITLEBAR_H + 42), fill=PALETTE['blue_button'])
    # Icons (approximate Codicon glyphs with unicode)
    act_icons = [
        ('⊞', True),   # extensions (active — sidebar visible)
        ('⌕', False),  # search
        ('⑂', False),  # source control
        ('▷', False),  # run
        ('⚙', False),  # settings
    ]
    f_act = load_font(18)
    for idx, (glyph, active) in enumerate(act_icons):
        cy = TITLEBAR_H + 25 + idx * 48
        clr = PALETTE['icon_default'] if active else '#555555'
        draw.text((ACTIVITY_W // 2, cy), glyph, font=f_act, fill=clr, anchor='mm')

    # ── Sidebar ─────────────────────────────────────────────────────────────
    draw.rectangle((ACTIVITY_W, TITLEBAR_H, ACTIVITY_W + SIDEBAR_W, H - STATUSBAR_H), fill=PALETTE['sidebar'])
    # Sidebar section header
    draw.rectangle((ACTIVITY_W, TITLEBAR_H, ACTIVITY_W + SIDEBAR_W, TITLEBAR_H + 30), fill=PALETTE['sidebar_header'])
    f_sh = load_font(11, bold=True)
    draw.text((ACTIVITY_W + 12, TITLEBAR_H + 15), sidebar_title.upper(), font=f_sh, fill=PALETTE['muted'], anchor='lm')
    # Right border
    draw.rectangle((ACTIVITY_W + SIDEBAR_W - 1, TITLEBAR_H, ACTIVITY_W + SIDEBAR_W, H - STATUSBAR_H), fill=PALETTE['sidebar_border'])

    # ── Editor area ─────────────────────────────────────────────────────────
    draw.rectangle((editor_x, TITLEBAR_H, W, H - STATUSBAR_H), fill=PALETTE['editor'])
    # Tab bar background
    draw.rectangle((editor_x, TITLEBAR_H, W, TITLEBAR_H + TABBAR_H), fill=PALETTE['tab_bar'])
    # Tabs
    tab_x = editor_x
    f_tab = load_font(13)
    for i, label in enumerate(editor_tabs[:5]):
        active = (i == active_tab_idx)
        bbox = draw.textbbox((0, 0), label, font=f_tab)
        tab_w = max(100, bbox[2] - bbox[0] + 28)
        bg = PALETTE['tab_active'] if active else PALETTE['tab_inactive']
        draw.rectangle((tab_x, TITLEBAR_H, tab_x + tab_w, TITLEBAR_H + TABBAR_H), fill=bg)
        if active:
            draw.rectangle((tab_x, TITLEBAR_H, tab_x + tab_w, TITLEBAR_H + 2), fill=PALETTE['blue_button'])
        draw.text((tab_x + 14, TITLEBAR_H + TABBAR_H // 2), label, font=f_tab, fill=PALETTE['text'] if active else PALETTE['muted'], anchor='lm')
        # Close dot (×)
        draw.text((tab_x + tab_w - 14, TITLEBAR_H + TABBAR_H // 2), '×', font=f_tab, fill=PALETTE['muted'], anchor='mm')
        tab_x += tab_w
    # Breadcrumb
    draw.rectangle((editor_x, TITLEBAR_H + TABBAR_H, W, TITLEBAR_H + TABBAR_H + BREADCRUMB_H), fill=PALETTE['breadcrumb'])
    f_bc = load_font(12)
    draw.text((editor_x + 12, TITLEBAR_H + TABBAR_H + BREADCRUMB_H // 2), 'OZBRIDGE  ›  ' + sidebar_title.upper(), font=f_bc, fill=PALETTE['muted'], anchor='lm')

    # ── Status bar ──────────────────────────────────────────────────────────
    draw.rectangle((0, H - STATUSBAR_H, W, H), fill=PALETTE['status'])
    f_st = load_font(12)
    draw.text((12, H - STATUSBAR_H // 2), status_text_left, font=f_st, fill=PALETTE['status_text'], anchor='lm')
    draw.text((W - 12, H - STATUSBAR_H // 2), status_text_right, font=f_st, fill=PALETTE['status_text'], anchor='rm')


def make_canvas() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new('RGBA', (SCREEN_W, SCREEN_H), PALETTE['editor'])
    draw = ImageDraw.Draw(img)
    return img, draw


# ---------------------------------------------------------------------------
# VS Code tree item renderer
# ---------------------------------------------------------------------------

# Approximate Codicon glyphs using Unicode characters
CODICON: dict[str, str] = {
    # Category icons
    'pulse': '⚡',
    'history': '↺',
    'calendar': '▦',
    'server-environment': '⬡',
    'plug': '⚿',
    # Run status icons
    'clock': '◷',
    'sync': '⟳',
    'check': '✓',
    'error': '⊗',
    'question': '?',
    # Drive icons
    'comment-discussion': '💬',
    'shield': '⛨',
    'mortar-board': '🎓',
    'file-text': '📄',
    # Generic
    'info': 'ⓘ',
    'chevron-right': '▶',
    'chevron-down': '▼',
}

ICON_COLOR: dict[str, str] = {
    'pulse': PALETTE['green'],
    'history': PALETTE['blue'],
    'calendar': PALETTE['yellow'],
    'server-environment': PALETTE['cyan'],
    'plug': PALETTE['purple'],
    'clock': PALETTE['yellow'],
    'sync': PALETTE['blue'],
    'check': PALETTE['green'],
    'error': PALETTE['red'],
    'question': PALETTE['muted'],
    'comment-discussion': PALETTE['blue'],
    'shield': PALETTE['green'],
    'mortar-board': PALETTE['yellow'],
    'file-text': PALETTE['blue'],
    'info': PALETTE['muted'],
}


def draw_tree_category(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    label: str,
    icon: str,
    expanded: bool = True,
    row_h: int = 22,
) -> int:
    """Draw a category node header. Returns next y."""
    f_label = load_font(12, bold=True)
    f_icon = load_font(12)
    # Background highlight for header
    draw.rectangle((x - 4, y, ACTIVITY_W + SIDEBAR_W - 4, y + row_h), fill=PALETTE['sidebar_header'])
    # Disclosure arrow
    arrow = CODICON['chevron-down'] if expanded else CODICON['chevron-right']
    draw.text((x + 2, y + row_h // 2), arrow, font=f_icon, fill=PALETTE['muted'], anchor='lm')
    # Codicon icon
    ic = CODICON.get(icon, '·')
    ic_color = ICON_COLOR.get(icon, PALETTE['icon_default'])
    draw.text((x + 18, y + row_h // 2), ic, font=f_icon, fill=ic_color, anchor='lm')
    # Label
    draw.text((x + 34, y + row_h // 2), label.upper(), font=f_label, fill=PALETTE['muted'], anchor='lm')
    return y + row_h


def draw_tree_item(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    label: str,
    icon: str,
    description: str = '',
    selected: bool = False,
    indent: int = 16,
    row_h: int = 22,
) -> int:
    """Draw a leaf tree item. Returns next y."""
    f_label = load_font(12)
    f_desc = load_font(11)
    f_icon = load_font(11)
    item_x = x + indent
    # Selection background
    if selected:
        draw.rectangle((ACTIVITY_W + 1, y, ACTIVITY_W + SIDEBAR_W - 2, y + row_h), fill=PALETTE['selection'])
    # Icon
    ic = CODICON.get(icon, '·')
    ic_color = ICON_COLOR.get(icon, PALETTE['icon_default'])
    if selected:
        ic_color = PALETTE['selection_text']
    draw.text((item_x, y + row_h // 2), ic, font=f_icon, fill=ic_color, anchor='lm')
    # Label
    lbl_color = PALETTE['selection_text'] if selected else PALETTE['text']
    draw.text((item_x + 16, y + row_h // 2), label, font=f_label, fill=lbl_color, anchor='lm')
    # Description (right-aligned, muted)
    if description:
        desc_color = PALETTE['selection_text'] if selected else PALETTE['description']
        draw.text((ACTIVITY_W + SIDEBAR_W - 10, y + row_h // 2), description, font=f_desc, fill=desc_color, anchor='rm')
    return y + row_h


def draw_tree_message(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    label: str,
    indent: int = 32,
    row_h: int = 22,
) -> int:
    """Draw an info/empty-state message node. Returns next y."""
    f_label = load_font(11)
    f_icon = load_font(11)
    draw.text((x + indent, y + row_h // 2), CODICON['info'], font=f_icon, fill=PALETTE['muted'], anchor='lm')
    draw.text((x + indent + 14, y + row_h // 2), label, font=f_label, fill=PALETTE['muted'], anchor='lm')
    return y + row_h


def sidebar_y_start() -> int:
    """Y coordinate where sidebar tree content starts (below section header)."""
    return TITLEBAR_H + 30 + 6


def editor_content_y() -> int:
    """Y coordinate where editor content starts (below tabs + breadcrumb)."""
    return TITLEBAR_H + TABBAR_H + BREADCRUMB_H + 16


def editor_x() -> int:
    return ACTIVITY_W + SIDEBAR_W



def draw_hero() -> None:
    """
    Hero screenshot: VS Code with Runs & Resources sidebar showing active run
    and Copilot Chat panel with @oz /cloud command in progress.
    Faithfully represents the real OzBridge chat participant + sidebar experience.
    """
    img, draw = make_canvas()
    draw_window_shell(
        img, draw,
        sidebar_title='Runs & Resources',
        editor_tabs=['Copilot Chat', 'README.md', 'src/extension.ts'],
        active_tab_idx=0,
        status_text_left='OzBridge  •  1 active run  •  MCP ready',
        status_text_right='UTF-8   TypeScript',
    )

    # ── Sidebar: Runs & Resources tree ──────────────────────────────────────
    sx = ACTIVITY_W + 12
    sy = sidebar_y_start()

    sy = draw_tree_category(draw, sx, sy, 'Active Runs', 'pulse', expanded=True)
    sy = draw_tree_item(draw, sx, sy, 'run-auth-refactor', 'sync', description='INPROGRESS', selected=True)
    sy = draw_tree_item(draw, sx, sy, 'run-bugfix-readme', 'clock', description='QUEUED')
    sy = draw_tree_category(draw, sx, sy, 'History', 'history', expanded=True)
    sy = draw_tree_item(draw, sx, sy, 'run-release-notes', 'check', description='SUCCEEDED')
    sy = draw_tree_item(draw, sx, sy, 'run-tests-linux', 'error', description='FAILED')
    sy = draw_tree_category(draw, sx, sy, 'Schedules', 'calendar', expanded=False)
    sy = draw_tree_category(draw, sx, sy, 'Environments', 'server-environment', expanded=False)
    sy = draw_tree_category(draw, sx, sy, 'MCP Servers', 'plug', expanded=False)

    # ── Editor: Copilot Chat panel ──────────────────────────────────────────
    ex = editor_x() + 20
    ey = editor_content_y()
    f_h = load_font(22, bold=True)
    f_body = load_font(13)
    f_mono = load_font(12, mono=True)
    f_sm = load_font(11)

    # Chat history area
    draw.rectangle((editor_x(), TITLEBAR_H + TABBAR_H + BREADCRUMB_H, SCREEN_W, SCREEN_H - STATUSBAR_H - 60), fill=PALETTE['editor'])

    # User message
    rounded_rect(draw, (ex - 8, ey, SCREEN_W - 24, ey + 48), radius=4, fill=PALETTE['widget_bg'])
    draw.text((ex + 4, ey + 14), '@oz /cloud refactor auth flow, update tests and bump changelog', font=f_body, fill=PALETTE['text'])
    draw.text((ex + 4, ey + 30), 'You  •  just now', font=f_sm, fill=PALETTE['description'])
    ey += 58

    # OzBridge response — run started
    rounded_rect(draw, (ex - 8, ey, SCREEN_W - 24, ey + 88), radius=4, fill='#1a2a1a')
    draw.text((ex + 4, ey + 10), 'OzBridge', font=load_font(13, bold=True), fill=PALETTE['green'])
    draw.text((ex + 4, ey + 30), 'Cloud run started — polling for results…', font=f_body, fill=PALETTE['text'])
    draw.text((ex + 4, ey + 50), 'run-auth-refactor  ·  INPROGRESS  ·  staging  ·  14s', font=f_mono, fill=PALETTE['description'])
    # Action buttons
    for i, (label, clr) in enumerate([('Open run', PALETTE['blue_button']), ('Copy ID', PALETTE['widget_bg'])]):
        bx = ex + 4 + i * 90
        rounded_rect(draw, (bx, ey + 66, bx + 82, ey + 82), radius=2, fill=clr)
        draw.text((bx + 41, ey + 74), label, font=f_sm, fill='#ffffff', anchor='mm')
    ey += 98

    # Copilot run output card
    rounded_rect(draw, (ex - 8, ey, SCREEN_W - 24, ey + 110), radius=4, fill='#1a2030')
    draw.text((ex + 4, ey + 10), 'OzBridge', font=load_font(13, bold=True), fill=PALETTE['blue'])
    draw.text((ex + 4, ey + 30), 'Run completed successfully', font=f_body, fill=PALETTE['text'])
    output_lines = [
        'Auth module refactored (12 files changed)',
        'Test suite updated — all 47 tests passing',
        'CHANGELOG.md updated with v1.1.1 entry',
    ]
    for i, line in enumerate(output_lines):
        draw.text((ex + 4, ey + 50 + i * 16), f'• {line}', font=f_sm, fill=PALETTE['description'])
    ey += 120

    # Input box
    input_y = SCREEN_H - STATUSBAR_H - 54
    draw.rectangle((editor_x(), input_y - 4, SCREEN_W, SCREEN_H - STATUSBAR_H), fill=PALETTE['widget_bg'])
    rounded_rect(draw, (ex - 8, input_y, SCREEN_W - 24, input_y + 36), radius=4, fill=PALETTE['editor'], outline=PALETTE['border'])
    draw.text((ex + 4, input_y + 18), 'Ask OzBridge or type / for commands…', font=f_body, fill=PALETTE['description'], anchor='lm')

    save_png(img, MEDIA_DIR / 'screenshot.png')
    write_hero_svg(MEDIA_DIR / 'screenshot.svg')


def draw_runs() -> None:
    """
    Runs & Resources sidebar screenshot: all 5 categories expanded with realistic data.
    Tree structure mirrors the exact WarpRunsTreeProvider.getChildren() output.
    """
    img, draw = make_canvas()
    draw_window_shell(
        img, draw,
        sidebar_title='Runs & Resources',
        editor_tabs=['run-auth-refactor', 'README.md'],
        active_tab_idx=0,
        status_text_left='OzBridge  •  2 active runs  •  az',
        status_text_right='Ln 1, Col 1',
    )

    # ── Sidebar tree (all 5 categories from WarpRunsTreeProvider) ──────────
    # Order matches getChildren() in runsTreeProvider.ts:
    # activeRuns → history → schedules → environments → mcp
    sx = ACTIVITY_W + 12
    sy = sidebar_y_start()

    # Active Runs (icon: pulse)
    sy = draw_tree_category(draw, sx, sy, 'Active Runs', 'pulse', expanded=True)
    # run children: INPROGRESS uses sync~spin, QUEUED uses clock
    sy = draw_tree_item(draw, sx, sy, 'run-auth-refactor', 'sync', description='INPROGRESS', selected=True)
    sy = draw_tree_item(draw, sx, sy, 'run-bugfix-readme', 'clock', description='QUEUED')

    # History (icon: history)
    sy = draw_tree_category(draw, sx, sy, 'History', 'history', expanded=True)
    # SUCCEEDED uses check, FAILED uses error
    sy = draw_tree_item(draw, sx, sy, 'run-release-notes', 'check', description='SUCCEEDED')
    sy = draw_tree_item(draw, sx, sy, 'run-tests-linux', 'error', description='FAILED')
    sy = draw_tree_item(draw, sx, sy, 'run-ci-fix', 'check', description='SUCCEEDED')

    # Schedules (icon: calendar)
    # running uses clock, paused uses debug-pause (shown as ⏸)
    sy = draw_tree_category(draw, sx, sy, 'Schedules', 'calendar', expanded=True)
    sy = draw_tree_item(draw, sx, sy, 'daily-lint', 'clock', description='0 9 * * *')
    sy = draw_tree_item(draw, sx, sy, 'nightly-smoke', 'info', description='0 1 * * * (paused)')

    # Environments (icon: server-environment)
    sy = draw_tree_category(draw, sx, sy, 'Environments', 'server-environment', expanded=True)
    sy = draw_tree_item(draw, sx, sy, 'staging', 'server-environment', description='org')

    # MCP Servers (icon: plug)
    sy = draw_tree_category(draw, sx, sy, 'MCP Servers', 'plug', expanded=True)
    sy = draw_tree_item(draw, sx, sy, 'cursor-mcp', 'plug', description='')
    sy = draw_tree_item(draw, sx, sy, 'claude-code', 'plug', description='')

    # ── Editor: run detail panel ────────────────────────────────────────────
    ex = editor_x() + 24
    ey = editor_content_y()
    f_h = load_font(20, bold=True)
    f_label = load_font(12, bold=True)
    f_val = load_font(12)
    f_mono = load_font(11, mono=True)
    f_sm = load_font(11)

    draw.text((ex, ey), 'run-auth-refactor', font=f_h, fill=PALETTE['text'])
    ey += 28

    # Status badge
    rounded_rect(draw, (ex, ey, ex + 90, ey + 20), radius=2, fill='#1a3a1a')
    draw.text((ex + 45, ey + 10), 'INPROGRESS', font=f_sm, fill=PALETTE['green'], anchor='mm')
    rounded_rect(draw, (ex + 98, ey, ex + 160, ey + 20), radius=2, fill=PALETTE['widget_bg'])
    draw.text((ex + 129, ey + 10), 'staging', font=f_sm, fill=PALETTE['description'], anchor='mm')
    ey += 32

    # Run metadata table
    fields = [
        ('Run ID', 'run_019db131-4e2a-4b9c-a112-f87e34c01234'),
        ('Started', '14 seconds ago'),
        ('Profile', 'Default'),
        ('Model', 'auto'),
        ('Environment', 'staging'),
        ('Type', 'cloud'),
    ]
    draw.rectangle((ex, ey, SCREEN_W - 24, ey + 1), fill=PALETTE['border'])
    ey += 8
    for field, value in fields:
        draw.text((ex, ey + 6), field, font=f_label, fill=PALETTE['description'])
        draw.text((ex + 130, ey + 6), value, font=f_val, fill=PALETTE['text'])
        draw.rectangle((ex, ey + 22, SCREEN_W - 24, ey + 23), fill=PALETTE['border'])
        ey += 24

    ey += 12
    # Inline log output
    f_log = load_font(11, mono=True)
    draw.text((ex, ey), 'Output', font=f_label, fill=PALETTE['description'])
    ey += 18
    rounded_rect(draw, (ex - 4, ey, SCREEN_W - 24, ey + 120), radius=2, fill=PALETTE['widget_bg'])
    log_lines = [
        '[INFO]  oz cloud run started — run_019db131…',
        '[INFO]  Cloning environment: staging',
        '[INFO]  Running agent with profile: Default',
        '[INFO]  Auth module analysis in progress…',
        '[INFO]  Writing refactored auth/tokens.ts',
        '[INFO]  Running test suite…',
    ]
    for i, line in enumerate(log_lines):
        color = PALETTE['description'] if not line.startswith('[WARN') else PALETTE['yellow']
        draw.text((ex + 4, ey + 8 + i * 17), line, font=f_log, fill=color)

    save_png(img, MEDIA_DIR / 'screenshot-runs.png')


def draw_drive() -> None:
    """
    Warp Drive sidebar screenshot: 3 categories (Prompts, Rules, Skills)
    matching the exact WarpDriveTreeProvider.getChildren() output.
    Editor shows a prompt file open with source = 'cli'.
    """
    img, draw = make_canvas()
    draw_window_shell(
        img, draw,
        sidebar_title='Warp Drive',
        editor_tabs=['incident-triage.md', 'ci-review.md'],
        active_tab_idx=0,
        status_text_left='OzBridge  •  Warp Drive  •  3 entries',
        status_text_right='Markdown   UTF-8',
    )

    # ── Sidebar tree (3 categories from WarpDriveTreeProvider) ─────────────
    # Order from getChildren(): prompt → rule → skill
    sx = ACTIVITY_W + 12
    sy = sidebar_y_start()

    # Prompts (icon: comment-discussion)
    sy = draw_tree_category(draw, sx, sy, 'Prompts', 'comment-discussion', expanded=True)
    # entry icon: file-text, description = 'cli' or 'local'
    sy = draw_tree_item(draw, sx, sy, 'incident-triage.md', 'file-text', description='cli', selected=True)
    sy = draw_tree_item(draw, sx, sy, 'release-checklist.md', 'file-text', description='local')

    # Rules (icon: shield)
    sy = draw_tree_category(draw, sx, sy, 'Rules', 'shield', expanded=True)
    sy = draw_tree_item(draw, sx, sy, 'ci-review.md', 'shield', description='cli')

    # Skills (icon: mortar-board)
    sy = draw_tree_category(draw, sx, sy, 'Skills', 'mortar-board', expanded=True)
    sy = draw_tree_item(draw, sx, sy, '5-test-agent', 'mortar-board', description='local')
    sy = draw_tree_item(draw, sx, sy, '3-implement-agent', 'mortar-board', description='local')

    # ── Editor: prompt file content ──────────────────────────────────────────
    ex = editor_x() + 24
    ey = editor_content_y()
    f_h1 = load_font(18, bold=True)
    f_h2 = load_font(14, bold=True)
    f_body = load_font(13)
    f_mono = load_font(12, mono=True)
    f_sm = load_font(11)

    # File header
    draw.text((ex, ey), 'incident-triage.md', font=f_h1, fill=PALETTE['text'])
    ey += 24
    draw.text((ex, ey), '.agents/prompts/incident-triage.md  ·  source: cli', font=f_sm, fill=PALETTE['description'])
    ey += 20
    draw.rectangle((ex, ey, SCREEN_W - 24, ey + 1), fill=PALETTE['border'])
    ey += 14

    # Markdown content mirroring a real .agents/prompts/ file
    md_lines: list[tuple[str, str]] = [
        ('h1', '# Incident triage'),
        ('blank', ''),
        ('text', 'Use this prompt when diagnosing a production failure or unexpected regression.'),
        ('blank', ''),
        ('h2', '## Instructions'),
        ('list', '- Summarize the observed failure from the active file and Problems panel'),
        ('list', '- Collect relevant diagnostics: stack traces, test output, last git diff'),
        ('list', '- Propose a rollback-safe mitigation strategy'),
        ('list', '- Suggest follow-up validation steps before closing the incident'),
        ('blank', ''),
        ('h2', '## Deliverables'),
        ('list', '- Concise incident summary (≤ 5 lines)'),
        ('list', '- Prioritized list of safe next actions'),
        ('list', '- Optional: dataset export link for post-mortem analysis'),
    ]
    for kind, line in md_lines:
        if kind == 'blank':
            ey += 8
            continue
        if kind == 'h1':
            clr = PALETTE['blue']
            font = f_h1
        elif kind == 'h2':
            clr = PALETTE['cyan']
            font = f_h2
        elif kind == 'list':
            clr = PALETTE['text']
            font = f_body
        else:
            clr = PALETTE['text']
            font = f_body
        draw.text((ex, ey), line, font=font, fill=clr)
        ey += 19

    save_png(img, MEDIA_DIR / 'screenshot-drive.png')


def draw_dashboard() -> None:
    """
    Dashboard webview screenshot: faithfully reproduces renderDashboardHtml() layout.
    Layout: h1 + meta line + Refresh button + 3-card grid (Total runs | Success rate | Daily volume)
    + table (Date | Total | OK | Failed | In-flight) with realistic data.
    Colors match the CSS vars resolved against VS Code Dark+ theme.
    """
    img, draw = make_canvas()
    draw_window_shell(
        img, draw,
        sidebar_title='Runs & Resources',
        editor_tabs=['OzBridge — Dashboard'],
        active_tab_idx=0,
        status_text_left='OzBridge  •  Dashboard',
        status_text_right='Webview',
    )

    # ── Webview content area (mimics HTML body) ─────────────────────────────
    # body { background: #1e1e1e; color: #cccccc; padding: 16px; }
    wx = editor_x() + 16
    wy = editor_content_y()
    W_content = SCREEN_W - editor_x() - 32

    f_h1 = load_font(16, bold=True)   # h1 { font-size: 1.2em }
    f_meta = load_font(11)             # .meta { font-size: 0.85em }
    f_card_label = load_font(10)       # .card h2 { font-size: 0.75em; text-transform: uppercase }
    f_card_val = load_font(28, bold=True)  # .card .v { font-size: 1.8em; font-weight: 600 }
    f_th = load_font(11)               # th
    f_td = load_font(12)               # td

    # h1
    draw.text((wx, wy), 'OzBridge — Dashboard', font=f_h1, fill=PALETTE['text'])
    wy += 22

    # .meta line
    meta_text = 'Window: 14 days  ·  Generated: 2026-04-22T12:00:00.000Z'
    draw.text((wx, wy), meta_text, font=f_meta, fill=PALETTE['description'])
    wy += 18

    # .actions — Refresh button
    # button { background: #0e639c; color: #ffffff; padding: 6px 14px; border-radius: 2px }
    btn_w = 68
    rounded_rect(draw, (wx, wy, wx + btn_w, wy + 24), radius=2, fill=PALETTE['blue_button'])
    draw.text((wx + btn_w // 2, wy + 12), 'Refresh', font=f_meta, fill='#ffffff', anchor='mm')
    wy += 34

    # .cards grid — 3 cards:
    # Card 1: Total runs | Card 2: Success rate | Card 3: Daily volume (span 2)
    # card { background: #252526; border: 1px solid #3c3c3c; border-radius: 4px; padding: 12px }
    CARD_GAP = 10
    card1_w = (W_content - CARD_GAP * 2) // 3
    card2_w = card1_w
    card3_w = W_content - card1_w - card2_w - CARD_GAP * 2
    CARD_H = 80

    # Card 1: Total runs
    cx = wx
    rounded_rect(draw, (cx, wy, cx + card1_w, wy + CARD_H), radius=4, fill=PALETTE['widget_bg'], outline=PALETTE['border'])
    draw.text((cx + 10, wy + 10), 'TOTAL RUNS', font=f_card_label, fill=PALETTE['description'])
    draw.text((cx + 10, wy + 28), '47', font=f_card_val, fill=PALETTE['text'])

    # Card 2: Success rate
    cx = wx + card1_w + CARD_GAP
    rounded_rect(draw, (cx, wy, cx + card2_w, wy + CARD_H), radius=4, fill=PALETTE['widget_bg'], outline=PALETTE['border'])
    draw.text((cx + 10, wy + 10), 'SUCCESS RATE', font=f_card_label, fill=PALETTE['description'])
    draw.text((cx + 10, wy + 28), '94.7%', font=f_card_val, fill=PALETTE['green'])

    # Card 3: Daily volume (sparkline — span 2 columns)
    # .card { grid-column: span 2 }
    cx = wx + card1_w + CARD_GAP + card2_w + CARD_GAP
    rounded_rect(draw, (cx, wy, cx + card3_w, wy + CARD_H), radius=4, fill=PALETTE['widget_bg'], outline=PALETTE['border'])
    draw.text((cx + 10, wy + 8), 'DAILY VOLUME', font=f_card_label, fill=PALETTE['description'])
    # Draw sparkline (polyline of daily totals)
    sparkline_data = [3, 5, 7, 4, 8, 6, 9, 5, 4, 7, 8, 6, 3, 7]
    sp_w = card3_w - 20
    sp_h = 44
    sp_x = cx + 10
    sp_y_bottom = wy + CARD_H - 8
    max_v = max(sparkline_data)
    pts = []
    for i, v in enumerate(sparkline_data):
        px = sp_x + int(i * sp_w / (len(sparkline_data) - 1))
        py = sp_y_bottom - int((v / max_v) * sp_h)
        pts.append((px, py))
    if len(pts) >= 2:
        draw.line(pts, fill=PALETTE['blue'], width=2)

    wy += CARD_H + 14

    # Table: thead
    # th { color: #868686; font-weight: normal }
    col_widths = [80, 50, 50, 60, 70]
    col_headers = ['Date', 'Total', 'OK', 'Failed', 'In-flight']
    cx = wx
    for i, (hdr, cw) in enumerate(zip(col_headers, col_widths)):
        draw.text((cx + 4, wy + 5), hdr, font=f_th, fill=PALETTE['description'])
        cx += cw
    draw.rectangle((wx, wy + 18, wx + W_content, wy + 19), fill=PALETTE['border'])
    wy += 22

    # Table rows (7 days of data, mirroring RunStatsSummary.buckets)
    table_data = [
        ('2026-04-22', 9, 9, 0, 0),
        ('2026-04-21', 7, 6, 1, 0),
        ('2026-04-20', 8, 8, 0, 0),
        ('2026-04-19', 6, 5, 1, 0),
        ('2026-04-18', 5, 5, 0, 0),
        ('2026-04-17', 7, 7, 0, 0),
        ('2026-04-16', 5, 4, 1, 0),
    ]
    for row_idx, (date, total, ok, failed, inflight) in enumerate(table_data):
        cx = wx
        row_bg = PALETTE['hover'] if row_idx % 2 == 0 else PALETTE['editor']
        draw.rectangle((wx, wy, wx + W_content, wy + 20), fill=row_bg)
        for i, (val, cw) in enumerate(zip([date, total, ok, failed, inflight], col_widths)):
            # td.ok → green, td.err → red, td.inf → blue
            if i == 2:
                clr = PALETTE['green']
            elif i == 3:
                clr = PALETTE['red'] if val > 0 else PALETTE['text']
            elif i == 4:
                clr = PALETTE['blue'] if val > 0 else PALETTE['text']
            else:
                clr = PALETTE['text']
            align = 'rm' if i > 0 else 'lm'
            tx = (cx + cw - 4) if i > 0 else (cx + 4)
            draw.text((tx, wy + 10), str(val), font=f_td, fill=clr, anchor=align)
            cx += cw
        draw.rectangle((wx, wy + 19, wx + W_content, wy + 20), fill=PALETTE['border'])
        wy += 20

    save_png(img, MEDIA_DIR / 'screenshot-dashboard.png')


def draw_mcp() -> None:
    """
    MCP server configuration screenshot: sidebar shows MCP Servers category expanded,
    editor shows server endpoint, tool list, registered clients and runtime log.
    """
    img, draw = make_canvas()
    draw_window_shell(
        img, draw,
        sidebar_title='Runs & Resources',
        editor_tabs=['MCP Configuration', 'package.json'],
        active_tab_idx=0,
        status_text_left='OzBridge  •  MCP Server running  •  port 3847',
        status_text_right='JSON   UTF-8',
    )

    # ── Sidebar: only MCP Servers category expanded ─────────────────────────
    sx = ACTIVITY_W + 12
    sy = sidebar_y_start()

    sy = draw_tree_category(draw, sx, sy, 'Active Runs', 'pulse', expanded=False)
    sy = draw_tree_category(draw, sx, sy, 'History', 'history', expanded=False)
    sy = draw_tree_category(draw, sx, sy, 'Schedules', 'calendar', expanded=False)
    sy = draw_tree_category(draw, sx, sy, 'Environments', 'server-environment', expanded=False)
    sy = draw_tree_category(draw, sx, sy, 'MCP Servers', 'plug', expanded=True)
    sy = draw_tree_item(draw, sx, sy, 'cursor-mcp', 'plug', description='', selected=True)
    sy = draw_tree_item(draw, sx, sy, 'claude-code', 'plug', description='')

    # ── Editor: MCP config panel ─────────────────────────────────────────────
    ex = editor_x() + 24
    ey = editor_content_y()
    f_h = load_font(18, bold=True)
    f_section = load_font(12, bold=True)
    f_body = load_font(12)
    f_mono = load_font(11, mono=True)
    f_sm = load_font(11)

    draw.text((ex, ey), 'MCP Server', font=f_h, fill=PALETTE['text'])
    ey += 22

    # Status badges
    for label, bg, fg in [('Running', '#1a3a1a', PALETTE['green']), ('HTTP + SSE', PALETTE['widget_bg'], PALETTE['blue']), ('2 clients', PALETTE['widget_bg'], PALETTE['description'])]:
        bbox = draw.textbbox((0, 0), label, font=f_sm)
        bw = bbox[2] - bbox[0] + 16
        rounded_rect(draw, (ex, ey, ex + bw, ey + 18), radius=2, fill=bg)
        draw.text((ex + bw // 2, ey + 9), label, font=f_sm, fill=fg, anchor='mm')
        ex += bw + 8
    ex = editor_x() + 24
    ey += 28

    draw.rectangle((ex, ey, SCREEN_W - 24, ey + 1), fill=PALETTE['border'])
    ey += 10

    # Configuration details
    details = [
        ('Endpoint', 'http://127.0.0.1:3847/sse'),
        ('Auth', 'Bearer token required (ozBridge.mcpBearerToken)'),
        ('Bind', '127.0.0.1  (ozBridge.mcpBindAddress)'),
        ('Port', '3847  (ozBridge.mcpPort)'),
    ]
    for key, value in details:
        draw.text((ex, ey + 4), key, font=f_section, fill=PALETTE['description'])
        draw.text((ex + 110, ey + 4), value, font=f_mono, fill=PALETTE['text'])
        draw.rectangle((ex, ey + 18, SCREEN_W - 24, ey + 19), fill=PALETTE['border'])
        ey += 20

    ey += 10
    # Tools list
    draw.text((ex, ey), 'Available tools', font=f_section, fill=PALETTE['description'])
    ey += 18
    tools = [
        ('oz_run_local', 'Run an Oz agent locally and stream output'),
        ('oz_run_cloud', 'Launch an Oz agent run in the cloud'),
        ('oz_get_run', 'Fetch the result of a cloud run by ID'),
        ('oz_list_runs', 'List recent cloud runs'),
    ]
    for name, desc in tools:
        rounded_rect(draw, (ex - 4, ey - 2, SCREEN_W - 24, ey + 16), radius=2, fill=PALETTE['widget_bg'])
        draw.text((ex + 4, ey + 6), name, font=f_mono, fill=PALETTE['cyan'], anchor='lm')
        draw.text((ex + 130, ey + 6), desc, font=f_sm, fill=PALETTE['description'], anchor='lm')
        ey += 20

    ey += 12
    # Runtime log
    draw.text((ex, ey), 'Runtime log', font=f_section, fill=PALETTE['description'])
    ey += 18
    rounded_rect(draw, (ex - 4, ey, SCREEN_W - 24, ey + 100), radius=2, fill=PALETTE['widget_bg'])
    log_lines = [
        ('[INFO]  MCP server listening on http://127.0.0.1:3847/sse', PALETTE['description']),
        ('[INFO]  claude-code registered — bearer token accepted', PALETTE['description']),
        ('[INFO]  cursor-mcp registered via ~/.cursor/mcp.json', PALETTE['description']),
        ('[INFO]  Request: oz_run_cloud (run-auth-refactor)', PALETTE['description']),
        ('[INFO]  Run started: run_019db131-4e2a-4b9c-a112-f87e34c01234', PALETTE['description']),
    ]
    for i, (line, clr) in enumerate(log_lines):
        draw.text((ex + 4, ey + 8 + i * 17), line, font=f_mono, fill=clr)

    save_png(img, MEDIA_DIR / 'screenshot-mcp.png')


def write_icon_svg(path: Path) -> None:
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" fill="none">
  <defs>
    <linearGradient id="bg" x1="72" y1="56" x2="420" y2="456" gradientUnits="userSpaceOnUse">
      <stop stop-color="#11182c"/>
      <stop offset="1" stop-color="#1f2840"/>
    </linearGradient>
  </defs>
  <rect x="32" y="32" width="448" height="448" rx="104" fill="url(#bg)"/>
  <rect x="44" y="44" width="424" height="424" rx="92" stroke="#31456e" stroke-opacity="0.9" stroke-width="4"/>
  <circle cx="256" cy="214" r="96" stroke="{PALETTE['cyan']}" stroke-width="28"/>
  <path d="M174 244C192 214 220 198 256 198C292 198 320 214 338 244" stroke="{PALETTE['green']}" stroke-width="18" stroke-linecap="round"/>
  <path d="M206 262H306" stroke="{PALETTE['text']}" stroke-width="18" stroke-linecap="round"/>
  <path d="M232 244V280" stroke="{PALETTE['text']}" stroke-width="14" stroke-linecap="round"/>
  <path d="M280 244V280" stroke="{PALETTE['text']}" stroke-width="14" stroke-linecap="round"/>
  <circle cx="256" cy="140" r="18" fill="{PALETTE['text']}"/>
  <path d="M204 356H308" stroke="{PALETTE['blue']}" stroke-opacity="0.95" stroke-width="16" stroke-linecap="round"/>
  <path d="M204 356H268" stroke="{PALETTE['green']}" stroke-width="16" stroke-linecap="round"/>
</svg>
'''
    path.write_text(svg, encoding='utf-8')


def write_hero_svg(path: Path) -> None:
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900" fill="none">
  <rect width="1440" height="900" fill="{PALETTE['editor']}"/>
  <rect y="36" width="54" height="840" fill="{PALETTE['activity']}"/>
  <rect x="54" y="36" width="306" height="840" fill="{PALETTE['sidebar']}"/>
  <rect x="360" y="36" width="1080" height="840" fill="{PALETTE['editor']}"/>
  <rect y="876" width="1440" height="24" fill="{PALETTE['status']}"/>
  <text x="84" y="86" fill="{PALETTE['text']}" font-family="Segoe UI, Arial, sans-serif" font-size="25" font-weight="700">Runs &amp; Resources</text>
  <text x="84" y="114" fill="{PALETTE['muted']}" font-family="Segoe UI, Arial, sans-serif" font-size="14">Sidebar + chat flow for Oz agents</text>
  <text x="420" y="196" fill="{PALETTE['text']}" font-family="Segoe UI, Arial, sans-serif" font-size="28" font-weight="700">@oz /cloud refactor auth flow and update tests</text>
</svg>
'''
    path.write_text(svg, encoding='utf-8')


def generate_icon() -> None:
    size = 256
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    rounded_rect(draw, (12, 12, 244, 244), radius=52, fill='#16203a', outline='#31456e', width=2)
    draw.ellipse((72, 56, 184, 168), outline=PALETTE['cyan'], width=14)
    draw.arc((72, 56, 184, 168), start=40, end=180, fill=PALETTE['green'], width=14)
    draw.arc((72, 56, 184, 168), start=180, end=320, fill=PALETTE['cyan'], width=14)
    draw.arc((88, 102, 168, 164), start=200, end=340, fill=PALETTE['green'], width=10)
    draw.line((100, 134, 156, 134), fill=PALETTE['text'], width=10)
    draw.line((116, 122, 116, 148), fill=PALETTE['text'], width=8)
    draw.line((140, 122, 140, 148), fill=PALETTE['text'], width=8)
    draw.ellipse((120, 78, 136, 94), fill=PALETTE['text'])
    draw.line((96, 188, 160, 188), fill=PALETTE['blue'], width=10)
    draw.line((96, 188, 132, 188), fill=PALETTE['green'], width=10)
    write_icon_svg(MEDIA_DIR / 'warp-icon.svg')
    save_png(img, MEDIA_DIR / 'warp-icon.png')
    save_png(img.resize((128, 128), Image.Resampling.LANCZOS), MEDIA_DIR / 'warp-icon-128.png')
    save_png(img.resize((32, 32), Image.Resampling.LANCZOS), MEDIA_DIR / 'warp-icon-32.png')


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Generate OzBridge multimedia assets.')
    parser.add_argument('--assets', nargs='*', default=['all'], choices=['all', 'icon', 'hero', 'runs', 'drive', 'mcp', 'dashboard'], help='Assets to generate')
    parser.add_argument('--emit-prompts', action='store_true', help='Write optional prompt templates for AI-assisted regeneration review.')
    return parser.parse_args()


def emit_prompt_pack() -> None:
    prompts = {
        'intent': 'Use AI generation only as an optional ideation pass; final assets should stay faithful to real OzBridge UI patterns.',
        'icon': 'Design a crisp VS Code extension icon for OzBridge: developer tooling, bridge metaphor, dark background, neon cyan/green accents, readable at 32px, no mascots, no fake glossy 3D.',
        'hero': 'Create a realistic VS Code dark-theme screenshot for OzBridge showing the actual product layout: activity bar, Runs & Resources sidebar, Copilot Chat panel with @oz cloud run and status updates. Keep typography and spacing close to real VS Code.',
        'gallery': [
            'Realistic OzBridge sidebar screenshot with Active Runs, History, Schedules and quick actions.',
            'Realistic Warp Drive screenshot with prompt tree on the left and markdown prompt preview in the editor.',
            'Realistic MCP management screenshot with local endpoint, registered clients and runtime logs.',
            'Realistic OzBridge dashboard webview screenshot with run analytics and failure triage cards.',
        ],
        'review_rubric': [
            'Would a developer mistake this for a real VS Code capture at first glance?',
            'Are command names, view titles and labels consistent with the actual OzBridge extension?',
            'Is the icon still recognizable and crisp at 32×32?',
        ],
    }
    PROMPT_PACK_PATH.write_text(json.dumps(prompts, indent=2, ensure_ascii=False), encoding='utf-8')


def main() -> None:
    args = parse_args()
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    selected = set(args.assets)
    if 'all' in selected or 'icon' in selected:
        generate_icon()
    if 'all' in selected or 'hero' in selected:
        draw_hero()
    if 'all' in selected or 'runs' in selected:
        draw_runs()
    if 'all' in selected or 'drive' in selected:
        draw_drive()
    if 'all' in selected or 'mcp' in selected:
        draw_mcp()
    if 'all' in selected or 'dashboard' in selected:
        draw_dashboard()
    if args.emit_prompts:
        emit_prompt_pack()


if __name__ == '__main__':
    main()
