"""Build the map backgrounds + .atlasmap files for the Phandalin-road adventure from downloaded art.

Inputs (not modified):
  campaign-vault/resource_pack/Forest road/Forest #1 gridless.jpg   Manea Roliste (CC BY-NC + stream permission)
  campaign-vault/resource_pack/Forest camp/Forest #2 day|night gridless.jpg   same
  incoming/dyson-deep-sepulchre/the-deep-sepulchre-nogrid.png        Dyson Logos (free commercial use, credit)

Outputs:
  campaign-vault/assets/maps/phandalin-*.jpg|png
  campaign-vault/scenes/phandalin-*.atlasmap   (same structure as make_placeholder_assets.py)

The forest maps are resampled by a hair so one square is a whole number of pixels
(Forest #1: 120.47 -> 120 px, Forest #2: 102.4 -> 100 px). The Dyson sheet holds three dungeon levels stacked on
one page; two of them are cropped out on square boundaries (300 px native = 100 px after the 1/3 downscale).

Run (GPT-SoVITS python has PIL / numpy / scipy):  python -I build_phandalin_maps.py
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

VAULT = (Path(__file__).resolve().parents[2] / 'campaign-vault')
INCOMING = (Path(__file__).resolve().parents[2] / 'incoming')
TEMPLATE = (Path(__file__).resolve().parents[2] / 'vault' / 'scenes' / 'test.atlasmap')
PACK = VAULT / "resource_pack"
OUT_MAPS = VAULT / "assets" / "maps"
OUT_SCENES = VAULT / "scenes"

# name -> (source image, crop box in source px or None, scale factor, jpeg?, grid size px after scaling, grid offset px)
MAPS = {
    "phandalin-road": dict(
        src=PACK / "Forest road" / "Forest #1 gridless.jpg", crop=None, scale=2040 / 2048, fmt="jpg", cell=120, offset=(0, 0),
    ),
    "phandalin-camp": dict(
        src=PACK / "Forest camp" / "Forest #2 day gridless.jpg", crop=None, scale=2000 / 2048, fmt="jpg", cell=100, offset=(0, 0),
    ),
    "phandalin-camp-night": dict(
        src=PACK / "Forest camp" / "Forest #2 night gridless.jpg", crop=None, scale=2000 / 2048, fmt="jpg", cell=100, offset=(0, 0),
    ),
    # Dyson sheet: level 1 (stream, bridges, side caves) and level 2 (big cavern, wide water). Squares are 300 px native,
    # lines at k*300. x0 = 300 / 600 and y0 = 0 sit on square boundaries; level 2 starts at y=4050 (art begins at 4173),
    # so its first horizontal line is at (4200 - 4050) / 3 = 50 px.
    "phandalin-cave-mouth": dict(
        src=INCOMING / "dyson-deep-sepulchre" / "the-deep-sepulchre-nogrid.png", crop=(300, 0, 7200, 4040), scale=1 / 3, fmt="png", cell=100, offset=(0, 0),
    ),
    "phandalin-cave-hall": dict(
        src=INCOMING / "dyson-deep-sepulchre" / "the-deep-sepulchre-nogrid.png", crop=(600, 4050, 7200, 7800), scale=1 / 3, fmt="png", cell=100, offset=(0, 50),
    ),
}


def atlasmap(name: str, bg: str, cell: int, offset: tuple[int, int]) -> Path:
    data = json.loads(TEMPLATE.read_text(encoding="utf-8"))
    state = data["state"]
    state["mapPath"] = f"scenes/{name}.atlasmap"
    state["background"] = bg
    grid = dict(state["grid"])
    grid.update(size=cell, offsetX=offset[0], offsetY=offset[1])
    state["grid"] = grid
    state["objects"] = {"tokens": {}, "fog": {}, "pins": {}, "texts": {}, "drawings": {}, "walls": {}, "lights": {}}
    state["camera"] = {"x": 0, "y": 0, "scale": 1}
    state["initiative"] = {"entries": [], "currentIndex": 0, "round": 0, "isActive": False, "config": {"autoSort": True}}
    state["initiativeTrackerOpen"] = False
    state["diceLog"] = []
    state["exploredMask"] = None
    state["exploredEdits"] = {}
    state["selection"] = []
    state["selectedIds"] = []
    state["tokenSettings"] = {
        "showNameplates": True,
        "hiddenResources": [],
        "showInstanceBadges": True,
        "tokenRingSize": 1,
        "showHPBars": True,
        "showStressBars": True,
    }
    state["lighting"] = {"enabled": False, "ambient": 1.0, "tokenVision": False, "exploredMemory": False}
    path = OUT_SCENES / f"{name}.atlasmap"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def main() -> None:
    OUT_MAPS.mkdir(parents=True, exist_ok=True)
    OUT_SCENES.mkdir(parents=True, exist_ok=True)
    for name, m in MAPS.items():
        im = Image.open(m["src"]).convert("RGB")
        if m["crop"]:
            im = im.crop(m["crop"])
        w, h = round(im.width * m["scale"]), round(im.height * m["scale"])
        im = im.resize((w, h), Image.LANCZOS)
        ext = m["fmt"]
        dst = OUT_MAPS / f"{name}.{ext}"
        if ext == "jpg":
            im.save(dst, "JPEG", quality=92, optimize=True)
        else:
            im.save(dst, "PNG", optimize=True)
        cols, rows = (w - m["offset"][0]) / m["cell"], (h - m["offset"][1]) / m["cell"]
        atlasmap(name, f"assets/maps/{name}.{ext}", m["cell"], m["offset"])
        print(f"{name}: {w}x{h} px, cell {m['cell']} px, offset {m['offset']} -> {cols:.2f} x {rows:.2f} squares, {dst.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
