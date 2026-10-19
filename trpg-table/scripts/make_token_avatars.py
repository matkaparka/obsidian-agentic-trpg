"""Crop token face avatars from the sprites (2:3 full-body canvas, or the bust panels from slice_sprite_sheets.py).

`campaign-vault/sprites/faces.json` holds a normalized face box per seat
({x, y, w, h}, 0-1 of the sprite canvas; optional "autoCenterX": true re-centres on the head). For every
expression PNG that exists, crop that box (made square), resize to 256x256 and write
`campaign-vault/assets/tokens/faces/<seat>-<expression>.png`. Atlas uses those small
square images as token avatars; the overlay never displays the full-body sprite.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

VAULT = (Path(__file__).resolve().parents[2] / 'campaign-vault')
SPRITES = VAULT / "sprites"
OUT = VAULT / "assets" / "tokens" / "faces"
EXPRESSIONS = ["neutral", "happy", "smug", "angry", "scared", "surprised", "thinking", "hurt"]


def main() -> None:
    boxes = json.loads((SPRITES / "faces.json").read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    for seat in ("player_a", "player_b"):
        box = boxes.get(seat)
        if not box:
            continue
        for exp in EXPRESSIONS:
            src = SPRITES / seat / f"{exp}.png"
            if not src.exists():
                continue
            im = Image.open(src).convert("RGBA")
            w, h = im.size
            x = box["x"] * w
            y = box["y"] * h
            bw = box["w"] * w
            bh = box["h"] * h
            # square crop, centered on the face box
            side = max(8.0, min(max(bw, bh), min(w, h)))
            cx = x + bw / 2
            cy = y + bh / 2
            if box.get("autoCenterX"):
                # Bust sprites: the head shifts a bit from expression to expression (angry / hurt lean).
                # Re-centre horizontally on the opaque pixels in the top rows (hair / ears, no shoulders yet).
                rows = max(1, int(h * box.get("headRows", 0.25)))
                ys, xs = np.nonzero(np.asarray(im.getchannel("A"))[:rows] > 200)
                if len(xs) > 50:
                    cx = float(xs.mean())
            if box.get("allowOutside"):
                # Bust sprites touch the top edge of their canvas; let the crop reach above it
                # (transparent padding) so the hair is not clipped by the round token.
                left = cx - side / 2
                top = cy - side / 2
            else:
                left = max(0.0, min(cx - side / 2, w - side))
                top = max(0.0, min(cy - side / 2, h - side))
            crop = im.crop((round(left), round(top), round(left + side), round(top + side)))
            crop = crop.resize((256, 256), Image.LANCZOS)
            dst = OUT / f"{seat}-{exp}.png"
            crop.save(dst, "PNG")
            print(f"{dst} {crop.size}")


if __name__ == "__main__":
    main()
