#!/usr/bin/env python3
"""Build circular Starbucks-style badge PNGs from the 💅 sticker (no AI art)."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SRC = ROOT / "assets" / "emoji-sticker.png"


def draw_gradient_disc(size: int) -> Image.Image:
    """Radial-ish violet → cyan on a square."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    cx = cy = (size - 1) / 2
    rmax = (size / 2) - 4
    for y in range(size):
        for x in range(size):
            dx, dy = x - cx, y - cy
            d = (dx * dx + dy * dy) ** 0.5
            if d > rmax:
                continue
            t = min(1.0, d / rmax)
            # inner: violet, outer rim: teal
            r = int(124 + (6 - 124) * t)
            g = int(58 + (182 - 58) * t * 0.85)
            b = int(237 + (212 - 237) * t * 0.9)
            px[x, y] = (r, g, b, 255)
    return img


def circle_mask(size: int, padding: int = 3) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(m)
    draw.ellipse((padding, padding, size - padding, size - padding), fill=255)
    return m


def ring_overlay(size: int, width: int = 5) -> Image.Image:
    ring = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(ring)
    p = width // 2 + 1
    draw.ellipse((p, p, size - p - 1, size - p - 1), outline=(255, 255, 255, 220), width=width)
    return ring


def compose_badge(src: Path, out_size: int) -> Image.Image:
    sticker = Image.open(src).convert("RGBA")
    base = draw_gradient_disc(out_size)
    mask = circle_mask(out_size)

    # Fit sticker inside inner ~58% diameter
    inner = int(out_size * 0.58)
    scale = min(inner / sticker.width, inner / sticker.height)
    nw = max(1, int(sticker.width * scale))
    nh = max(1, int(sticker.height * scale))
    sticker = sticker.resize((nw, nh), Image.Resampling.LANCZOS)

    layer = Image.new("RGBA", (out_size, out_size), (0, 0, 0, 0))
    layer.paste(base, (0, 0))
    sx = (out_size - nw) // 2
    sy = (out_size - nh) // 2
    layer.paste(sticker, (sx, sy), sticker)

    out = Image.new("RGBA", (out_size, out_size), (0, 0, 0, 0))
    out.paste(layer, (0, 0), mask)
    out = Image.alpha_composite(out, ring_overlay(out_size))
    return out


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
    if not src.is_file():
        print(f"Missing sticker: {src}", file=sys.stderr)
        sys.exit(1)

    public = ROOT / "public"
    public.mkdir(parents=True, exist_ok=True)

    og = compose_badge(src, 512)
    og.save(public / "og-image.png", "PNG", optimize=True)

    touch = compose_badge(src, 180)
    touch.save(public / "apple-touch-icon.png", "PNG", optimize=True)

    # Crisp tab icon fallback (some engines prefer PNG)
    fav_png = compose_badge(src, 48)
    fav_png.save(public / "favicon-48.png", "PNG", optimize=True)

    print("Wrote public/og-image.png, apple-touch-icon.png, favicon-48.png")


if __name__ == "__main__":
    main()
