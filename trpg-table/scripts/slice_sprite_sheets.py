"""Slice a 4x2 expression sheet (what ChatGPT gives back) into the 8 expression PNGs of one seat.

Sheet order, left to right, top to bottom:
    neutral happy smug angry / scared surprised thinking hurt
The panels are found from the white gutters, so the sheet does not need to be an exact size.
Each panel is cropped to one common size, and the white background (the part connected to the
panel's top edge and the upper part of its side edges) is made transparent. The bottom edge is
NOT used as a seed, because the body (white robe, white fur) runs off the bottom of the panel.

Usage:
    python slice_sprite_sheets.py <sheet.png> <player_a|player_b> [--dry-run]

Writes campaign-vault/sprites/<seat>/<expression>.png (RGBA). Whatever was there is first copied to
campaign-vault/sprites/_replaced/<seat>/<timestamp>/ so nothing is lost.
Then run make_token_avatars.py (it crops the round-token faces from these).
"""
from __future__ import annotations

import argparse
import shutil
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

VAULT = (Path(__file__).resolve().parents[2] / 'campaign-vault')
EXPRESSIONS = ["neutral", "happy", "smug", "angry", "scared", "surprised", "thinking", "hurt"]
WHITE = 244  # min(R, G, B) at or above this counts as paper white


def runs(profile: np.ndarray, threshold: float, min_len: int) -> list[tuple[int, int]]:
    """Index ranges where profile >= threshold, at least min_len long."""
    out: list[tuple[int, int]] = []
    start = None
    for i, v in enumerate(profile):
        if v >= threshold and start is None:
            start = i
        if (v < threshold or i == len(profile) - 1) and start is not None:
            end = i if v >= threshold else i - 1
            if end - start + 1 >= min_len:
                out.append((start, end))
            start = None
    return out


def find_panels(rgb: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Return 8 boxes (x0, y0, x1, y1), exclusive end, in sheet order."""
    ink = rgb.min(axis=2) < WHITE
    cols = runs(ink.mean(axis=0), 0.02, 100)
    rows = runs(ink.mean(axis=1), 0.02, 100)
    if len(cols) != 4 or len(rows) != 2:
        raise SystemExit(f"expected 4 columns x 2 rows of panels, found {len(cols)} x {len(rows)}: cols={cols} rows={rows}")
    return [(x0, y0, x1 + 1, y1 + 1) for (y0, y1) in rows for (x0, x1) in cols]


def transparent_background(img: Image.Image) -> Image.Image:
    rgba = np.array(img.convert("RGBA"))
    white = rgba[:, :, :3].min(axis=2) >= WHITE
    labels, _ = ndimage.label(white)  # 4-connected
    h, w = white.shape
    # Seeds: the top edge and the top ~40% of the side edges (the head region). Below that the
    # white robe / fur touches the sides and runs off the bottom, so those edges are not seeds
    # (the few white pixels in the rounded bottom corners stay; the avatars never use that area).
    seeds = set()
    seeds.update(labels[0, :].tolist())
    seeds.update(labels[: int(h * 0.4), 0].tolist())
    seeds.update(labels[: int(h * 0.4), -1].tolist())
    seeds.discard(0)
    bg = np.isin(labels, list(seeds))
    # soften the 1px edge so there is no hard white fringe
    edge = ndimage.binary_dilation(bg, iterations=1) & ~bg
    alpha = np.full((h, w), 255, np.uint8)
    alpha[bg] = 0
    alpha[edge] = 120
    rgba[:, :, 3] = alpha
    return Image.fromarray(rgba, "RGBA")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("seat", choices=["player_a", "player_b"])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    sheet = Image.open(args.sheet).convert("RGB")
    rgb = np.array(sheet)
    boxes = find_panels(rgb)
    pw = min(b[2] - b[0] for b in boxes)
    ph = min(b[3] - b[1] for b in boxes)
    print(f"sheet {sheet.size}, panels {pw}x{ph}")
    for exp, (x0, y0, x1, y1) in zip(EXPRESSIONS, boxes):
        # trim to the common size, centred on the panel
        cx0 = x0 + ((x1 - x0) - pw) // 2
        cy0 = y0 + ((y1 - y0) - ph) // 2
        print(f"  {exp:10s} panel ({x0},{y0})-({x1},{y1}) -> crop at ({cx0},{cy0})")
    if args.dry_run:
        return

    out = VAULT / "sprites" / args.seat
    out.mkdir(parents=True, exist_ok=True)
    old = [p for p in out.glob("*.png")]
    if old:
        keep = VAULT / "sprites" / "_replaced" / args.seat / time.strftime("%Y%m%d-%H%M%S")
        keep.mkdir(parents=True, exist_ok=True)
        for p in old:
            shutil.copy2(p, keep / p.name)
        print(f"copied {len(old)} existing file(s) to {keep}")

    for exp, (x0, y0, x1, y1) in zip(EXPRESSIONS, boxes):
        cx0 = x0 + ((x1 - x0) - pw) // 2
        cy0 = y0 + ((y1 - y0) - ph) // 2
        panel = sheet.crop((cx0, cy0, cx0 + pw, cy0 + ph))
        panel = transparent_background(panel)
        dst = out / f"{exp}.png"
        panel.save(dst, "PNG")
        print(f"wrote {dst} {panel.size}")


if __name__ == "__main__":
    sys.exit(main())
