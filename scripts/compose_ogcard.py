#!/usr/bin/env python3
"""Composite the legally-required independence disclaimer onto the OzBridge OG
card as crisp, real-font text so the OCR compliance gate reads it verbatim.

Deterministic (real glyphs, no AI image model) — the pixels contain exactly the
string we typed, which is the whole point of the fail-closed gate.
"""
from __future__ import annotations
import sys
from PIL import Image, ImageDraw, ImageFont

SRC = sys.argv[1]
DST = sys.argv[2]

FONT_DIR = "/usr/share/fonts/truetype/dejavu"
DISCLAIMER = ("OzBridge is an independent project and is not affiliated with, "
              "endorsed by, or sponsored by Warp.")

img = Image.open(SRC).convert("RGBA")
W, H = img.size

# Footer band across the full bottom edge — semi-opaque so the disclaimer stays
# legible over the circuit-trace artwork underneath.
BAND_H = 52
band = Image.new("RGBA", (W, BAND_H), (8, 11, 14, 219))
img.alpha_composite(band, (0, H - BAND_H))

draw = ImageDraw.Draw(img)

# Thin teal hairline at the top of the band for polish (matches brand accent).
draw.line([(0, H - BAND_H), (W, H - BAND_H)], fill=(122, 197, 197, 150), width=1)

# Fit the disclaimer on one line: start at 22px, shrink until it fits the pad.
PAD_X = 40
max_w = W - 2 * PAD_X
size = 22
while size >= 14:
    font = ImageFont.truetype(f"{FONT_DIR}/DejaVuSans.ttf", size)
    w = draw.textlength(DISCLAIMER, font=font)
    if w <= max_w:
        break
    size -= 1

# Vertically centre in the band.
bbox = draw.textbbox((0, 0), DISCLAIMER, font=font)
text_h = bbox[3] - bbox[1]
ty = (H - BAND_H) + (BAND_H - text_h) // 2 - bbox[1]
draw.text((PAD_X, ty), DISCLAIMER, font=font, fill=(203, 213, 225, 255))

img.convert("RGB").save(DST, "PNG")
print(f"wrote {DST} ({W}x{H}), disclaimer at {size}px, text width {int(w)}px")
