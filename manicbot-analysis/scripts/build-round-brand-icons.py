#!/usr/bin/env python3
"""Crop canonical brand mark to a square, then emit public/ icon sizes."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SRC = ROOT / "src" / "assets" / "manicbot-emoji-mark.png"


def cover_square(im: Image.Image, side: int) -> Image.Image:
    """Scale to cover `side`×`side`, center-crop."""
    w, h = im.size
    scale = max(side / w, side / h)
    nw = max(1, int(w * scale))
    nh = max(1, int(h * scale))
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - side) // 2
    top = (nh - side) // 2
    return im.crop((left, top, left + side, top + side))


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
    if not src.is_file():
        print(f"Missing source: {src}", file=sys.stderr)
        sys.exit(1)

    public = ROOT / "public"
    public.mkdir(parents=True, exist_ok=True)
    ui_dir = ROOT / "src" / "assets"
    ui_dir.mkdir(parents=True, exist_ok=True)

    img = Image.open(src).convert("RGBA")
    base = cover_square(img, 1024)

    def write(size: int, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        out = base.resize((size, size), Image.Resampling.LANCZOS)
        out.save(path, "PNG", optimize=True)

    write(512, public / "og-image.png")
    write(180, public / "apple-touch-icon.png")
    write(48, public / "favicon-48.png")
    # Small asset for Vite bundle (header + phone mockup) — avoid shipping multi‑MB source in JS
    write(256, ui_dir / "manicbot-emoji-mark-ui.png")

    print("Wrote public/* icons + src/assets/manicbot-emoji-mark-ui.png")


if __name__ == "__main__":
    main()
