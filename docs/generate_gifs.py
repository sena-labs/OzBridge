"""
Generate animated GIF illustrations for the GUIDA-RAPIDA.html guide.
Creates stylized terminal / chat simulations matching the Warp dark theme.
"""
from __future__ import annotations

import math
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# ─── Config ──────────────────────────────────────────────────────────────────
W, H = 800, 450
FPS = 12
OUT_DIR = Path(__file__).parent / "media"
OUT_DIR.mkdir(exist_ok=True)

# ─── Colors (Warp dark theme) ───────────────────────────────────────────────
BG       = (14, 14, 18)
BG_TERM  = (26, 26, 36)
BG_BAR   = (22, 22, 29)
BORDER   = (42, 42, 53)
GREEN    = (1, 214, 143)
GREEN_DK = (0, 140, 95)
WHITE    = (226, 226, 232)
GRAY     = (139, 139, 158)
BLUE     = (108, 156, 255)
YELLOW   = (255, 189, 46)
RED      = (255, 95, 87)
DIM      = (80, 80, 100)

# ─── Fonts ───────────────────────────────────────────────────────────────────
try:
    FONT_MONO  = ImageFont.truetype("consola.ttf", 18)
    FONT_MONO_SM = ImageFont.truetype("consola.ttf", 15)
    FONT_UI    = ImageFont.truetype("segoeui.ttf", 18)
    FONT_UI_SM = ImageFont.truetype("segoeui.ttf", 14)
    FONT_UI_B  = ImageFont.truetype("segoeuib.ttf", 18)
    FONT_UI_LG = ImageFont.truetype("segoeuib.ttf", 24)
except Exception:
    FONT_MONO = FONT_MONO_SM = FONT_UI = FONT_UI_SM = FONT_UI_B = FONT_UI_LG = ImageFont.load_default()


# ═══════════════════════════════════════════════════════════════════════════════
# Drawing helpers
# ═══════════════════════════════════════════════════════════════════════════════

def new_frame() -> Image.Image:
    return Image.new("RGB", (W, H), BG)


def draw_rounded_rect(draw: ImageDraw.ImageDraw, xy, fill, outline=None, r=12):
    x0, y0, x1, y1 = xy
    draw.rounded_rectangle(xy, radius=r, fill=fill, outline=outline)


def draw_terminal_chrome(draw: ImageDraw.ImageDraw, x, y, w, h, title="PowerShell"):
    """Draw a terminal window with title bar and dots."""
    draw_rounded_rect(draw, (x, y, x + w, y + h), fill=BG_TERM, outline=BORDER, r=14)
    # title bar
    draw.rectangle((x + 1, y + 1, x + w - 1, y + 34), fill=BG_BAR)
    draw.line((x, y + 34, x + w, y + 34), fill=BORDER)
    # dots
    for i, c in enumerate([RED, YELLOW, GREEN]):
        cx = x + 18 + i * 22
        draw.ellipse((cx - 6, y + 11, cx + 6, y + 23), fill=c)
    draw.text((x + 90, y + 9), title, fill=DIM, font=FONT_UI_SM)


def draw_chat_chrome(draw: ImageDraw.ImageDraw, x, y, w, h):
    """Draw a VS Code chat panel frame."""
    draw_rounded_rect(draw, (x, y, x + w, y + h), fill=BG_TERM, outline=BORDER, r=14)
    draw.rectangle((x + 1, y + 1, x + w - 1, y + 36), fill=BG_BAR)
    draw.line((x, y + 36, x + w, y + 36), fill=BORDER)
    # Warp icon
    draw_rounded_rect(draw, (x + 14, y + 8, x + 34, y + 28), fill=GREEN, r=6)
    draw.text((x + 18, y + 7), "W", fill=BG, font=FONT_UI_SM)
    draw.text((x + 42, y + 9), "Copilot Chat — @warp", fill=GRAY, font=FONT_UI_SM)


def draw_chat_msg(draw, x, y, is_user=True, text="", w=500):
    """Draw one chat message bubble. Returns the y after this bubble."""
    avatar_bg = BORDER if is_user else GREEN
    avatar_txt = WHITE if is_user else BG
    avatar_label = "Tu" if is_user else "W"
    draw_rounded_rect(draw, (x, y, x + 28, y + 28), fill=avatar_bg, r=8)
    draw.text((x + 5, y + 4), avatar_label, fill=avatar_txt, font=FONT_UI_SM)

    tx = x + 40
    lines = text.split("\n")
    cy = y
    for line in lines:
        # Colorize @warp and /cmd
        if "@warp" in line:
            parts = line.split("@warp", 1)
            draw.text((tx, cy), parts[0], fill=WHITE, font=FONT_UI)
            aw = draw.textlength(parts[0], font=FONT_UI)
            draw.text((tx + aw, cy), "@warp", fill=GREEN, font=FONT_UI_B)
            aw2 = draw.textlength("@warp", font=FONT_UI_B)
            rest = parts[1]
            # Highlight /command
            if rest.startswith(" /"):
                sp = rest.find(" ", 2)
                if sp == -1:
                    sp = len(rest)
                cmd = rest[:sp]
                draw.text((tx + aw + aw2, cy), cmd, fill=BLUE, font=FONT_MONO)
                cw = draw.textlength(cmd, font=FONT_MONO)
                draw.text((tx + aw + aw2 + cw, cy), rest[sp:], fill=WHITE, font=FONT_UI)
            else:
                draw.text((tx + aw + aw2, cy), rest, fill=WHITE, font=FONT_UI)
        elif line.startswith("✅") or line.startswith("✓"):
            draw.text((tx, cy), line, fill=GREEN, font=FONT_UI)
        elif line.startswith("⚙") or line.startswith("☁") or line.startswith("📋"):
            draw.text((tx, cy), line, fill=WHITE, font=FONT_UI_B)
        elif line.startswith("🔄") or line.startswith("⏳"):
            draw.text((tx, cy), line, fill=YELLOW, font=FONT_UI)
        elif line.startswith("❌"):
            draw.text((tx, cy), line, fill=RED, font=FONT_UI)
        else:
            draw.text((tx, cy), line, fill=GRAY if not is_user else WHITE, font=FONT_UI)
        cy += 24
    return cy + 8


def typing_effect(full_text: str, frame_idx: int, chars_per_frame: int = 2) -> str:
    """Return a progressively longer substring for typing animation."""
    n = min(len(full_text), frame_idx * chars_per_frame)
    return full_text[:n]


def cursor_char(frame_idx: int) -> str:
    """Blinking cursor."""
    return "█" if (frame_idx // 3) % 2 == 0 else " "


def save_gif(frames: list[Image.Image], name: str, durations: list[int] | int = 83):
    path = OUT_DIR / name
    if isinstance(durations, int):
        durations = [durations] * len(frames)
    # Last frame stays longer
    if len(durations) > 2:
        durations[-1] = max(durations[-1], 1500)
    frames[0].save(
        path,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
    )
    size_kb = path.stat().st_size / 1024
    print(f"  ✓ {name} — {len(frames)} frames, {size_kb:.0f} KB")


# ═══════════════════════════════════════════════════════════════════════════════
# GIF generators
# ═══════════════════════════════════════════════════════════════════════════════

def gif_01_download_warp():
    """Download and install Warp — simulated browser + installer."""
    frames = []

    # Phase 1: Browser with warp.dev (frames 0-8)
    for i in range(9):
        img = new_frame()
        d = ImageDraw.Draw(img)
        # Browser chrome
        draw_rounded_rect(d, (40, 30, 760, 420), fill=BG_TERM, outline=BORDER, r=14)
        d.rectangle((41, 31, 759, 64), fill=BG_BAR)
        d.line((40, 64, 760, 64), fill=BORDER)
        # URL bar
        draw_rounded_rect(d, (60, 38, 740, 58), fill=BG, outline=BORDER, r=8)
        url_text = typing_effect("https://www.warp.dev/", i, 3)
        d.text((70, 39), url_text + cursor_char(i), fill=WHITE, font=FONT_MONO_SM)
        # Page content
        if i >= 4:
            d.text((120, 100), "Warp", fill=WHITE, font=FONT_UI_LG)
            d.text((120, 135), "The terminal reimagined with AI", fill=GRAY, font=FONT_UI)
            # Download button
            alpha = min(1.0, (i - 4) / 3)
            btn_green = tuple(int(c * alpha + BG_TERM[j] * (1 - alpha)) for j, c in enumerate(GREEN))
            draw_rounded_rect(d, (120, 180, 340, 220), fill=btn_green, r=10)
            if i >= 5:
                d.text((140, 188), "Download for Windows", fill=BG, font=FONT_UI_SM)
            # Highlight click on button
            if i >= 7:
                d.ellipse((220, 192, 232, 204), outline=WHITE, width=2)
        frames.append(img)

    # Phase 2: Download progress (frames 9-16)
    for i in range(8):
        img = new_frame()
        d = ImageDraw.Draw(img)
        draw_rounded_rect(d, (40, 30, 760, 420), fill=BG_TERM, outline=BORDER, r=14)
        d.rectangle((41, 31, 759, 64), fill=BG_BAR)
        d.line((40, 64, 760, 64), fill=BORDER)
        draw_rounded_rect(d, (60, 38, 740, 58), fill=BG, outline=BORDER, r=8)
        d.text((70, 39), "https://www.warp.dev/", fill=GRAY, font=FONT_MONO_SM)

        # Download bar at bottom
        draw_rounded_rect(d, (40, 380, 760, 418), fill=BG_BAR, outline=BORDER, r=8)
        progress = min(1.0, (i + 1) / 7)
        bar_w = int(680 * progress)
        if bar_w > 0:
            draw_rounded_rect(d, (50, 390, 50 + bar_w, 408), fill=GREEN, r=6)
        d.text((60, 392), f"Warp-Setup.exe  —  {int(progress * 100)}%", fill=WHITE, font=FONT_UI_SM)
        if progress >= 1.0:
            d.text((550, 392), "Download completato!", fill=GREEN, font=FONT_UI_SM)
        frames.append(img)

    # Phase 3: Installer (frames 17-22)
    for i in range(6):
        img = new_frame()
        d = ImageDraw.Draw(img)
        # Installer window
        draw_rounded_rect(d, (150, 60, 650, 390), fill=BG_TERM, outline=GREEN_DK, r=16)
        d.text((190, 90), "Warp Setup", fill=WHITE, font=FONT_UI_LG)
        d.text((190, 130), "Installing Warp Terminal...", fill=GRAY, font=FONT_UI)

        # Progress
        progress = min(1.0, (i + 1) / 5)
        draw_rounded_rect(d, (190, 180, 610, 204), fill=BG, outline=BORDER, r=8)
        bar_w = int(400 * progress)
        if bar_w > 4:
            draw_rounded_rect(d, (192, 182, 192 + bar_w, 202), fill=GREEN, r=6)

        steps = ["Extracting files...", "Installing CLI...", "Adding to PATH...", "Creating shortcuts...", "Done!"]
        for si, step in enumerate(steps):
            if si <= i:
                color = GREEN if si < i or progress >= 1.0 else YELLOW
                prefix = "✓ " if si < i or progress >= 1.0 else "→ "
                d.text((190, 230 + si * 26), prefix + step, fill=color, font=FONT_UI_SM)

        if progress >= 1.0:
            draw_rounded_rect(d, (320, 340, 480, 375), fill=GREEN, r=10)
            d.text((365, 348), "Finish", fill=BG, font=FONT_UI_B)
        frames.append(img)

    save_gif(frames, "gif-01-download-warp.gif")


def gif_02_verify_oz():
    """Verify oz in PATH — PowerShell command."""
    frames = []
    cmd = "where oz"
    output_line = r"C:\Users\User\AppData\Local\Programs\Warp\oz.cmd"

    for i in range(14):
        img = new_frame()
        d = ImageDraw.Draw(img)
        draw_terminal_chrome(d, 40, 40, 720, 370)
        y = 90

        # Prompt + typing
        d.text((60, y), "PS C:\\>", fill=GREEN, font=FONT_MONO)
        pw = d.textlength("PS C:\\> ", font=FONT_MONO)
        typed = typing_effect(cmd, i, 2)
        d.text((60 + pw, y), typed + cursor_char(i), fill=WHITE, font=FONT_MONO)

        # Output appears after typing done
        if i >= 5:
            y += 30
            out_typed = typing_effect(output_line, i - 5, 6)
            d.text((60, y), out_typed, fill=BLUE, font=FONT_MONO)

        # Success message
        if i >= 10:
            y += 40
            d.text((60, y), "✓ Oz CLI trovato nel PATH!", fill=GREEN, font=FONT_UI_B)

        frames.append(img)

    save_gif(frames, "gif-02-verify-oz.gif")


def gif_03_oz_login():
    """oz auth login — terminal + browser simulation."""
    frames = []
    cmd = "oz auth login"

    for i in range(20):
        img = new_frame()
        d = ImageDraw.Draw(img)
        draw_terminal_chrome(d, 40, 40, 720, 370)
        y = 90

        # Typing command
        d.text((60, y), "PS C:\\>", fill=GREEN, font=FONT_MONO)
        pw = d.textlength("PS C:\\> ", font=FONT_MONO)
        typed = typing_effect(cmd, i, 2)
        d.text((60 + pw, y), typed + cursor_char(i), fill=WHITE, font=FONT_MONO)

        if i >= 7:
            y += 30
            d.text((60, y), "Opening browser for authentication...", fill=YELLOW, font=FONT_MONO_SM)

        # Browser overlay
        if 9 <= i <= 16:
            draw_rounded_rect(d, (100, 120, 700, 360), fill=BG_TERM, outline=GREEN_DK, r=14)
            d.text((120, 140), "Warp — Sign In", fill=WHITE, font=FONT_UI_LG)
            d.text((120, 180), "Authorize Oz CLI to access your account", fill=GRAY, font=FONT_UI)
            if i >= 11:
                # Email field
                draw_rounded_rect(d, (120, 220, 500, 250), fill=BG, outline=BORDER, r=8)
                email_typed = typing_effect("user@example.com", i - 11, 3)
                d.text((130, 225), email_typed, fill=WHITE, font=FONT_MONO_SM)
            if i >= 14:
                draw_rounded_rect(d, (120, 270, 300, 305), fill=GREEN, r=10)
                d.text((155, 278), "Authorize", fill=BG, font=FONT_UI_B)
            if i >= 15:
                d.ellipse((200, 280, 212, 292), outline=WHITE, width=2)

        # Success
        if i >= 17:
            y += 30
            d.text((60, y), "Callback received!", fill=GRAY, font=FONT_MONO_SM)
            y += 25
            d.text((60, y), "✓ Successfully logged in as user@example.com", fill=GREEN, font=FONT_MONO)

        frames.append(img)

    save_gif(frames, "gif-03-oz-login.gif")


def gif_04_install_vsix():
    """Install VSIX from VS Code terminal."""
    frames = []
    cmd = "code --install-extension warp-vsc-bridge-0.1.0.vsix"

    for i in range(16):
        img = new_frame()
        d = ImageDraw.Draw(img)
        # VS Code frame
        draw_rounded_rect(d, (20, 20, 780, 430), fill=BG_TERM, outline=BORDER, r=14)
        # Activity bar
        d.rectangle((21, 21, 60, 429), fill=BG_BAR)
        # Editor area hint
        d.text((80, 40), "extension.ts", fill=DIM, font=FONT_UI_SM)
        d.line((61, 60, 779, 60), fill=BORDER)

        # Terminal panel
        draw_rounded_rect(d, (61, 220, 779, 429), fill=BG_TERM, outline=BORDER, r=0)
        d.rectangle((62, 220, 778, 248), fill=BG_BAR)
        d.text((75, 225), "TERMINAL", fill=GRAY, font=FONT_UI_SM)
        y = 260

        d.text((75, y), "PS>", fill=GREEN, font=FONT_MONO)
        pw = d.textlength("PS> ", font=FONT_MONO)
        typed = typing_effect(cmd, i, 4)
        d.text((75 + pw, y), typed, fill=WHITE, font=FONT_MONO_SM)

        if i < 13:
            cw = d.textlength(typed, font=FONT_MONO_SM)
            d.text((75 + pw + cw, y), cursor_char(i), fill=WHITE, font=FONT_MONO_SM)

        if i >= 13:
            y += 25
            d.text((75, y), "Installing extensions...", fill=YELLOW, font=FONT_MONO_SM)
        if i >= 14:
            y += 25
            d.text((75, y), "Extension 'warp-vsc-bridge-0.1.0.vsix'", fill=WHITE, font=FONT_MONO_SM)
            y += 20
            d.text((75, y), "was successfully installed.", fill=GREEN, font=FONT_MONO_SM)

        frames.append(img)

    save_gif(frames, "gif-04-install-vsix.gif")


def gif_05_reload_window():
    """Command Palette → Reload Window."""
    frames = []
    search_text = "Reload Window"

    for i in range(14):
        img = new_frame()
        d = ImageDraw.Draw(img)
        # VS Code background
        draw_rounded_rect(d, (20, 20, 780, 430), fill=BG_TERM, outline=BORDER, r=14)
        d.rectangle((21, 21, 60, 429), fill=BG_BAR)

        # Command palette appears from frame 2
        if i >= 2:
            # Backdrop
            draw_rounded_rect(d, (140, 50, 660, 300), fill=BG_BAR, outline=BORDER, r=14)
            # Search input
            draw_rounded_rect(d, (160, 65, 640, 95), fill=BG, outline=BORDER, r=8)
            d.text((170, 70), ">", fill=YELLOW, font=FONT_MONO)
            typed = typing_effect(search_text, i - 2, 2)
            d.text((190, 70), typed + cursor_char(i), fill=WHITE, font=FONT_MONO)

            # Results
            if i >= 5:
                # Highlighted result
                sel_y = 110
                draw_rounded_rect(d, (160, sel_y, 640, sel_y + 36), fill=(1, 214, 143, 20), r=6)
                d.rectangle((160, sel_y, 164, sel_y + 36), fill=GREEN)
                d.text((175, sel_y + 8), "Developer: Reload Window", fill=WHITE, font=FONT_UI)
                # Other results
                for j, txt in enumerate(["Developer: Toggle Developer Tools", "Developer: Open Webview Dev Tools"]):
                    ry = sel_y + 40 + j * 36
                    d.text((175, ry + 8), txt, fill=DIM, font=FONT_UI_SM)

            # Click animation
            if i >= 10:
                draw_rounded_rect(d, (160, 110, 640, 146), fill=GREEN_DK, r=6)
                d.text((175, 118), "Developer: Reload Window", fill=WHITE, font=FONT_UI_B)

        # Reload effect
        if i >= 12:
            d.rectangle((20, 20, 780, 430), fill=BG)
            d.text((300, 200), "Reloading...", fill=GREEN, font=FONT_UI_LG)
            # Spinner
            angle = (i - 12) * 45
            cx, cy = 400, 240
            for a in range(8):
                a_rad = math.radians(angle + a * 45)
                x1 = cx + int(20 * math.cos(a_rad))
                y1 = cy + int(20 * math.sin(a_rad))
                brightness = int(255 * (1 - a / 8))
                d.ellipse((x1 - 3, y1 - 3, x1 + 3, y1 + 3), fill=(brightness, brightness, brightness))

        frames.append(img)

    save_gif(frames, "gif-05-reload-window.gif")


def gif_06_first_config():
    """@warp /config in Copilot Chat — first verification."""
    frames = []
    user_msg = "@warp /config"

    for i in range(20):
        img = new_frame()
        d = ImageDraw.Draw(img)
        draw_chat_chrome(d, 40, 30, 720, 390)
        y = 80

        # User typing
        d.text((60, y), "Tu", fill=WHITE, font=FONT_UI_SM)
        draw_rounded_rect(d, (56, y - 4, 82, y + 18), fill=BORDER, r=6)
        d.text((62, y - 2), "Tu", fill=WHITE, font=FONT_UI_SM)
        tx = 100
        typed = typing_effect(user_msg, i, 2)
        # Colorize
        if len(typed) <= 5:
            d.text((tx, y), typed + cursor_char(i), fill=WHITE, font=FONT_UI)
        else:
            d.text((tx, y), "@warp", fill=GREEN, font=FONT_UI_B)
            aw = d.textlength("@warp", font=FONT_UI_B)
            rest = typed[5:]
            if rest.startswith(" /"):
                d.text((tx + aw, y), rest, fill=BLUE, font=FONT_MONO)
                rw = d.textlength(rest, font=FONT_MONO)
                d.text((tx + aw + rw, y), cursor_char(i), fill=WHITE, font=FONT_MONO)
            else:
                d.text((tx + aw, y), rest + cursor_char(i), fill=WHITE, font=FONT_UI)

        # Response appears progressively
        if i >= 8:
            y += 50
            # Warp avatar
            draw_rounded_rect(d, (56, y - 4, 82, y + 18), fill=GREEN, r=6)
            d.text((64, y - 2), "W", fill=BG, font=FONT_UI_SM)

            resp_lines = [
                ("⚙️  Configurazione Warp Bridge", WHITE, FONT_UI_B),
                ("━━━━━━━━━━━━━━━━━━━━━━━━━━━", DIM, FONT_UI_SM),
                ("✅ Disponibile — versione: unknown", GREEN, FONT_UI),
                ("Modello: auto", GRAY, FONT_UI),
                ("Profilo: Default", GRAY, FONT_UI),
                ("Timeout: 300 s", GRAY, FONT_UI),
            ]
            visible_lines = min(len(resp_lines), (i - 8) + 1)
            for li in range(visible_lines):
                text, color, font = resp_lines[li]
                d.text((100, y), text, fill=color, font=font)
                y += 28

        frames.append(img)

    save_gif(frames, "gif-06-first-config.gif")


def gif_07_run_local():
    """@warp /run — local agent execution with progress."""
    frames = []
    user_msg = "@warp /run correggi il bug nella funzione login"

    for i in range(24):
        img = new_frame()
        d = ImageDraw.Draw(img)
        draw_chat_chrome(d, 40, 30, 720, 390)
        y = 80

        # User message (fully typed after a few frames)
        draw_rounded_rect(d, (56, y - 4, 82, y + 18), fill=BORDER, r=6)
        d.text((62, y - 2), "Tu", fill=WHITE, font=FONT_UI_SM)
        tx = 100
        typed = typing_effect(user_msg, i, 4)
        if len(typed) > 5:
            d.text((tx, y), "@warp", fill=GREEN, font=FONT_UI_B)
            aw = d.textlength("@warp", font=FONT_UI_B)
            rest = typed[5:]
            if rest.startswith(" /run"):
                cmd_end = 5
                d.text((tx + aw, y), rest[:cmd_end], fill=BLUE, font=FONT_MONO)
                cw = d.textlength(rest[:cmd_end], font=FONT_MONO)
                d.text((tx + aw + cw, y), rest[cmd_end:], fill=WHITE, font=FONT_UI)
            else:
                d.text((tx + aw, y), rest, fill=WHITE, font=FONT_UI)
        else:
            d.text((tx, y), typed, fill=WHITE, font=FONT_UI)

        if i < 12:
            clen = d.textlength(typed, font=FONT_UI)
            # cursor approx
            pass

        # Response
        if i >= 12:
            y += 50
            draw_rounded_rect(d, (56, y - 4, 82, y + 18), fill=GREEN, r=6)
            d.text((64, y - 2), "W", fill=BG, font=FONT_UI_SM)

            if i < 16:
                # Progress animation
                d.text((100, y), "🔄 Esecuzione agente in corso", fill=YELLOW, font=FONT_UI)
                dots = "." * ((i - 12) % 4)
                dw = d.textlength("🔄 Esecuzione agente in corso", font=FONT_UI)
                d.text((100 + dw, y), dots, fill=YELLOW, font=FONT_UI)

                # Progress bar
                y += 35
                draw_rounded_rect(d, (100, y, 700, y + 12), fill=BG, outline=BORDER, r=6)
                prog = (i - 12) / 4
                bw = int(580 * prog)
                if bw > 4:
                    draw_rounded_rect(d, (102, y + 2, 102 + bw, y + 10), fill=GREEN, r=4)
            else:
                d.text((100, y), "✅ Completato", fill=GREEN, font=FONT_UI_B)
                y += 30

                result_lines = [
                    "Ho trovato e corretto il bug:",
                    "la variabile isAuthenticated non veniva",
                    "aggiornata dopo il refresh del token.",
                    "",
                    "File modificato: src/auth/login.ts",
                ]
                visible = min(len(result_lines), (i - 16) + 1)
                for li in range(visible):
                    line = result_lines[li]
                    color = BLUE if "src/" in line else GRAY
                    d.text((100, y), line, fill=color, font=FONT_UI)
                    y += 24

        frames.append(img)

    save_gif(frames, "gif-07-run-local.gif")


def gif_08_init():
    """@warp /init — scaffolding animation."""
    frames = []

    for i in range(18):
        img = new_frame()
        d = ImageDraw.Draw(img)
        draw_chat_chrome(d, 40, 30, 720, 390)
        y = 80

        # User message
        draw_rounded_rect(d, (56, y - 4, 82, y + 18), fill=BORDER, r=6)
        d.text((62, y - 2), "Tu", fill=WHITE, font=FONT_UI_SM)
        msg = "@warp /init"
        d.text((100, y), "@warp", fill=GREEN, font=FONT_UI_B)
        aw = d.textlength("@warp", font=FONT_UI_B)
        d.text((100 + aw, y), " /init", fill=BLUE, font=FONT_MONO)

        if i >= 3:
            y += 50
            draw_rounded_rect(d, (56, y - 4, 82, y + 18), fill=GREEN, r=6)
            d.text((64, y - 2), "W", fill=BG, font=FONT_UI_SM)

            d.text((100, y), "🏗️  Scaffolding progetto...", fill=WHITE, font=FONT_UI_B)
            y += 35

            files = [
                ".agents/skills/01-spec-agent.md",
                ".agents/skills/02-design-agent.md",
                ".agents/skills/03-implement-agent.md",
                ".agents/skills/04-review-agent.md",
                ".agents/skills/05-test-agent.md",
                ".agents/skills/06-deploy-agent.md",
                ".agents/skills/07-maintenance-agent.md",
                ".warp/rules/PROJECT.md",
            ]
            visible = min(len(files), max(0, i - 3))
            for fi in range(visible):
                icon = "✓" if fi < visible - 1 or i > 3 + len(files) else "→"
                color = GREEN if icon == "✓" else YELLOW
                d.text((100, y), icon, fill=color, font=FONT_MONO)
                d.text((120, y), f"Creato  {files[fi]}", fill=GRAY, font=FONT_MONO_SM)
                y += 22

            if i >= 12:
                y += 10
                d.text((100, y), "✅ Scaffolding completato — 8 file creati!", fill=GREEN, font=FONT_UI_B)

        frames.append(img)

    save_gif(frames, "gif-08-init.gif")


def gif_09_settings():
    """VS Code Settings panel — warpBridge search and edit."""
    frames = []
    search = "warpBridge"

    for i in range(18):
        img = new_frame()
        d = ImageDraw.Draw(img)
        # VS Code settings frame
        draw_rounded_rect(d, (20, 20, 780, 430), fill=BG_TERM, outline=BORDER, r=14)
        # Title bar
        d.rectangle((21, 21, 779, 54), fill=BG_BAR)
        d.text((40, 28), "⚙️  Settings", fill=WHITE, font=FONT_UI_B)
        d.line((20, 54, 780, 54), fill=BORDER)

        # Search bar
        draw_rounded_rect(d, (40, 66, 760, 94), fill=BG, outline=BORDER, r=8)
        d.text((50, 72), "🔍", fill=DIM, font=FONT_UI_SM)
        typed = typing_effect(search, i, 2)
        d.text((75, 72), typed + cursor_char(i), fill=WHITE, font=FONT_MONO)

        # Settings entries appear
        if i >= 5:
            settings_data = [
                ("warpBridge.ozPath", "oz", "Percorso del CLI Oz"),
                ("warpBridge.defaultModel", "auto", "Modello AI predefinito"),
                ("warpBridge.timeoutMs", "300000", "Timeout per esecuzioni locali"),
                ("warpBridge.maxOutputChars", "5000", "Max caratteri output in chat"),
            ]
            sy = 110
            visible = min(len(settings_data), (i - 5) + 1)
            for si in range(visible):
                key, val, desc = settings_data[si]
                # Setting row
                draw_rounded_rect(d, (40, sy, 760, sy + 70), fill=BG_BAR if si % 2 == 0 else BG_TERM, r=0)
                d.text((60, sy + 8), key, fill=GREEN, font=FONT_MONO)
                d.text((60, sy + 30), desc, fill=DIM, font=FONT_UI_SM)
                # Value box
                draw_rounded_rect(d, (520, sy + 8, 740, sy + 34), fill=BG, outline=BORDER, r=6)
                d.text((530, sy + 11), val, fill=BLUE, font=FONT_MONO_SM)

                # Edit animation on timeoutMs
                if si == 2 and i >= 13:
                    draw_rounded_rect(d, (520, sy + 8, 740, sy + 34), fill=BG, outline=GREEN, r=6)
                    new_val = typing_effect("600000", i - 13, 2)
                    d.text((530, sy + 11), new_val + cursor_char(i), fill=WHITE, font=FONT_MONO_SM)

                sy += 72

        frames.append(img)

    save_gif(frames, "gif-09-settings.gif")


# ═══════════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    print("Generating GIFs for GUIDA-RAPIDA...")
    print()
    gif_01_download_warp()
    gif_02_verify_oz()
    gif_03_oz_login()
    gif_04_install_vsix()
    gif_05_reload_window()
    gif_06_first_config()
    gif_07_run_local()
    gif_08_init()
    gif_09_settings()
    print()
    print(f"Done! All GIFs saved to {OUT_DIR}")
