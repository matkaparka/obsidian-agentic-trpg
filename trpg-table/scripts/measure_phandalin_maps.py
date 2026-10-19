"""Measure `地图信息` (standable polygons / blocked cells) for the Phandalin-road maps straight from the pictures.

Writes, per map, a JSON fragment + a debug overlay PNG:
  <out>/<map>.mapinfo.json   {"standable": [...], "blocked": [...]}   (cell units, 0-based, like the other scenes)
  <out>/<map>.debug.png      floor / blocked cells tinted, for eyeballing

Caves (Dyson line art): the floor is every white region that is walled in by the black outline and is not the
outside paper. A few places where the art simply ends (stream mouths) are closed with the PATCHES lines first.
Forests: blocked cells = tree canopies (green blobs) and rocks found by colour, plus hand-listed tents / fire pit.

Run:  python -I measure_phandalin_maps.py <out_dir>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None
MAPS = (Path(__file__).resolve().parents[2] / 'campaign-vault' / 'assets' / 'maps')


# ----------------------------------------------------------------- polygons from a cell mask
def mask_to_polygons(mask: np.ndarray) -> list[list[list[float]]]:
    """Axis-aligned outlines (cell units) of the True cells; holes come out as extra polygons (reverse orientation)."""
    rows, cols = mask.shape
    pad = np.zeros((rows + 2, cols + 2), bool)
    pad[1:-1, 1:-1] = mask
    # directed boundary edges with the True cell on the left of travel
    nxt: dict[tuple[int, int], list[tuple[int, int]]] = {}

    def add(a, b):
        nxt.setdefault(a, []).append(b)

    for r in range(rows):
        for c in range(cols):
            if not mask[r, c]:
                continue
            if not pad[r, c + 1]:  # top neighbour empty: edge along the top, going east
                add((c, r), (c + 1, r))
            if not pad[r + 2, c + 1]:  # bottom empty: going west
                add((c + 1, r + 1), (c, r + 1))
            if not pad[r + 1, c]:  # left empty: going north
                add((c, r + 1), (c, r))
            if not pad[r + 1, c + 2]:  # right empty: going south
                add((c + 1, r), (c + 1, r + 1))
    polys: list[list[tuple[int, int]]] = []
    while nxt:
        start = next(iter(nxt))
        poly = [start]
        cur = start
        prev_dir = None
        while True:
            outs = nxt[cur]
            if len(outs) == 1:
                n = outs.pop(0)
            else:  # saddle: turn consistently (prefer a right turn to keep regions separate)
                def turn(o):
                    d = (o[0] - cur[0], o[1] - cur[1])
                    if prev_dir is None:
                        return 0
                    cross = prev_dir[0] * d[1] - prev_dir[1] * d[0]
                    return -cross
                outs.sort(key=turn)
                n = outs.pop(0)
            if not nxt[cur]:
                del nxt[cur]
            prev_dir = (n[0] - cur[0], n[1] - cur[1])
            cur = n
            if cur == start:
                break
            poly.append(cur)
        polys.append(poly)
    out = []
    for p in polys:
        # drop collinear points
        q = []
        for i, pt in enumerate(p):
            a, b = p[i - 1], p[(i + 1) % len(p)]
            if (pt[0] - a[0]) * (b[1] - pt[1]) - (pt[1] - a[1]) * (b[0] - pt[0]) != 0:
                q.append(pt)
        if len(q) >= 3:
            out.append([[float(x), float(y)] for x, y in q])
    return out


def poly_area(p) -> float:
    return 0.5 * sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p)))


def split_outer_holes(polys):
    outers = [p for p in polys if poly_area(p) > 0]
    holes = [p for p in polys if poly_area(p) < 0]
    return outers, holes


def mask_to_rects(mask: np.ndarray) -> list[dict]:
    """Greedy merge of True cells into {col:[a,b], row:[c,d]} rectangles."""
    m = mask.copy()
    rows, cols = m.shape
    rects = []
    for r in range(rows):
        c = 0
        while c < cols:
            if not m[r, c]:
                c += 1
                continue
            c2 = c
            while c2 + 1 < cols and m[r, c2 + 1]:
                c2 += 1
            r2 = r
            while r2 + 1 < rows and m[r2 + 1, c : c2 + 1].all():
                r2 += 1
            m[r : r2 + 1, c : c2 + 1] = False
            rects.append({"col": [c, c2], "row": [r, r2]})
            c = c2 + 1
    return rects


# ----------------------------------------------------------------- caves
# Seeds are (col, row) cells that are certainly floor. The floor is the flood fill of the free space (everything that
# is not a thick black stroke) from those seeds, so the stream lines / planks / grid never matter, and the only thing
# that can go wrong is a leak through a place where the art simply ends -> closed with PATCHES (image px segments).
CAVE_SEEDS = {
    "phandalin-cave-mouth": [(2, 5), (7, 3), (7, 8), (12, 11), (18, 10), (18, 5), (15, 10)],
    "phandalin-cave-hall": [(2, 7), (6, 3), (11, 8), (18, 4), (16, 7)],
}
CAVE_PATCHES = {
    # level 1: where the stream leaves the picture at the top
    "phandalin-cave-mouth": [(552, 89, 1124, 84), (437, 697, 437, 797)],
    # level 2: stream end at the top right, the east exit at the right edge, and the small passage that just stops
    "phandalin-cave-hall": [(1273, 91, 1235, 155), (2012, 1053, 2004, 1112), (1327, 557, 1327, 653)],
}
# floor cells the flood cannot find on its own (the planked room on level 1 is cut up by thick plank strokes)
MANUAL_FLOOR = {
    "phandalin-cave-mouth": [
        {"col": [1, 1], "row": [5, 7]}, {"col": [2, 4], "row": [5, 5]}, {"col": [2, 4], "row": [7, 7]}, {"col": [5, 5], "row": [5, 5]},
        # plank bridges / stream crossings the thick strokes hide: (7,7) mid cave <-> west passage, (11-12,9) mid cave <-> loop passage
        {"col": [7, 7], "row": [7, 7]}, {"col": [11, 12], "row": [9, 9]},
    ],
    "phandalin-cave-hall": [
        {"col": [11, 11], "row": [1, 1]},   # top end of the stream passage
        {"col": [15, 16], "row": [5, 6]},   # the small north-east passage <-> east side
        {"col": [17, 18], "row": [9, 10]},  # east exit
    ],
}


def cave(name: str, cell: int, off: tuple[int, int]) -> dict:
    im = Image.open(MAPS / f"{name}.png").convert("L")
    a = np.asarray(im)
    h, w = a.shape
    ink = a < 120
    # the outline is a thick stroke; stream lines, planks and the grid are thin. An opening removes the thin ones.
    wall = ndimage.binary_opening(ink, structure=np.ones((9, 9), bool))
    pm = Image.new("L", (w, h), 0)
    pd = ImageDraw.Draw(pm)
    for (x0, y0, x1, y1) in CAVE_PATCHES[name]:
        pd.line([(x0, y0), (x1, y1)], fill=255, width=14)
    wall = wall | (np.asarray(pm) > 0)
    # The outline is a chain of blobs with small gaps. Close the gaps (dilate by GAP px), flood the interior from the
    # seeds, then grow the interior back by the same amount (never into the real wall).
    GAP = 14
    wall_d = ndimage.binary_dilation(wall, iterations=GAP)
    labels, _ = ndimage.label(~wall_d)
    border = set(labels[0, :]) | set(labels[-1, :]) | set(labels[:, 0]) | set(labels[:, -1])
    border.discard(0)
    keep = set()
    for (c, r) in CAVE_SEEDS[name]:
        cx, cy = off[0] + c * cell + cell // 2, off[1] + r * cell + cell // 2
        lab = 0
        for rad in range(0, 45, 3):  # nearest free pixel around the cell centre
            win = labels[max(0, cy - rad) : cy + rad + 1, max(0, cx - rad) : cx + rad + 1]
            vals = win[win > 0]
            if vals.size:
                lab = int(np.bincount(vals).argmax())
                break
        if lab == 0:
            print(f"  {name}: seed {(c, r)} has no free pixel within 45 px")
            continue
        keep.add(lab)
        if lab in border:
            print(f"  {name}: seed {(c, r)} is in a region that touches the picture edge")
    for lab in keep:
        if lab in border:
            print(f"  {name}: LEAK - a seeded region touches the picture edge ({int((labels == lab).sum())} px); add a patch")
    interior = np.isin(labels, list(keep))
    floor_px = ndimage.binary_dilation(interior, iterations=GAP) & ~wall
    cols = int((w - off[0]) / cell)
    rows = int((h - off[1]) / cell) + 1
    mask = np.zeros((rows, cols), bool)
    for r in range(rows):
        for c in range(cols):
            x0, y0 = off[0] + c * cell, off[1] + r * cell
            sub = floor_px[max(0, y0) : min(h, y0 + cell), x0 : x0 + cell]
            if sub.size and sub.mean() >= 0.4:
                mask[r, c] = True
    for rc in MANUAL_FLOOR[name]:
        mask[rc["row"][0] : rc["row"][1] + 1, rc["col"][0] : rc["col"][1] + 1] = True
    return {"mask": mask, "floor_px": floor_px, "size": (w, h), "cell": cell, "off": off}

# ----------------------------------------------------------------- forests
# Hand-measured from the picture with the 100 px grid overlay (colour classification is useless here:
# trees, grass and moss are all green). Rectangles are {col:[a,b], row:[c,d]}, inclusive, 0-based.
CAMP_ROCKS = [
    {"col": [1, 3], "row": [0, 2]},     # big rock, top left
    {"col": [17, 19], "row": [1, 2]},   # big rock, top right
    {"col": [16, 17], "row": [6, 8]},   # rock, right
    {"col": [3, 4], "row": [11, 12]},   # flat rock, bottom left
]
CAMP_TENTS = [
    {"col": [6, 7], "row": [4, 5]},     # teal tent, north
    {"col": [5, 7], "row": [8, 9]},     # teal tent, south
    {"col": [9, 11], "row": [7, 9]},    # red tent
    {"col": [8, 8], "row": [6, 6]},     # fire pit
]
CAMP_TREES = [
    {"col": [0, 0], "row": [0, 1]}, {"col": [4, 4], "row": [0, 0]}, {"col": [8, 9], "row": [0, 1]},
    {"col": [11, 12], "row": [0, 0]}, {"col": [14, 15], "row": [1, 2]}, {"col": [15, 16], "row": [0, 0]},
    {"col": [10, 12], "row": [2, 4]}, {"col": [5, 6], "row": [3, 4]}, {"col": [0, 2], "row": [2, 4]},
    {"col": [1, 3], "row": [5, 6]}, {"col": [4, 4], "row": [6, 6]}, {"col": [14, 15], "row": [5, 6]},
    {"col": [16, 17], "row": [3, 3]}, {"col": [18, 19], "row": [4, 4]}, {"col": [18, 18], "row": [6, 6]},
    {"col": [13, 15], "row": [8, 9]}, {"col": [19, 19], "row": [7, 8]}, {"col": [16, 17], "row": [10, 10]},
    {"col": [18, 18], "row": [9, 9]}, {"col": [19, 19], "row": [11, 13]}, {"col": [14, 15], "row": [11, 12]},
    {"col": [16, 17], "row": [12, 13]}, {"col": [8, 9], "row": [11, 13]}, {"col": [10, 11], "row": [12, 12]},
    {"col": [12, 13], "row": [13, 14]}, {"col": [15, 16], "row": [14, 14]}, {"col": [0, 2], "row": [11, 12]},
    {"col": [5, 6], "row": [11, 12]}, {"col": [0, 1], "row": [13, 14]}, {"col": [3, 4], "row": [14, 14]},
    {"col": [8, 9], "row": [14, 14]}, {"col": [0, 1], "row": [8, 9]}, {"col": [2, 2], "row": [8, 8]},
    {"col": [6, 7], "row": [13, 13]},
]


def forest(cols: int, rows: int, rect_lists: list[list[dict]]) -> dict:
    mask = np.zeros((rows, cols), bool)
    for lst in rect_lists:
        for rc in lst:
            mask[rc["row"][0] : rc["row"][1] + 1, rc["col"][0] : rc["col"][1] + 1] = True
    return {"mask": mask}

def tint(path_in: Path, path_out: Path, mask: np.ndarray, cell: int, off=(0, 0), color=(255, 0, 0), alpha=90, invert=False):
    im = Image.open(path_in).convert("RGBA")
    ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    rows, cols = mask.shape
    for r in range(rows):
        for c in range(cols):
            v = mask[r, c]
            if invert:
                v = not v
            if v:
                d.rectangle([off[0] + c * cell, off[1] + r * cell, off[0] + (c + 1) * cell - 1, off[1] + (r + 1) * cell - 1], fill=color + (alpha,))
    out = Image.alpha_composite(im, ov).convert("RGB")
    s = 1500 / out.width
    out.resize((1500, round(out.height * s))).save(path_out)


def rects_to_polys(rects: list[dict]) -> list[list[list[float]]]:
    return [[[r["col"][0], r["row"][0]], [r["col"][1] + 1, r["row"][0]], [r["col"][1] + 1, r["row"][1] + 1], [r["col"][0], r["row"][1] + 1]] for r in rects]


def L(id_: str, name: str, col: tuple[int, int], row: tuple[int, int], note: str = "") -> dict:
    d = {"id": id_, "name": name, "cells": {"col": list(col), "row": list(row)}}
    if note:
        d["note"] = note
    return d


# Hand-written parts of each scene's 地图信息 (cells are 0-based). Spawn / start cells were checked against the floor masks.
EXTRAS = {
    "phandalin-road": {
        "scene": "01-road-ambush.md",
        "extra_blocked": [{"name": "两匹死马", "cells": {"col": [8, 9], "row": [7, 8]}}],
        "blocked_names": ["倒木", "倒木", "倒木", "倒木"],
        "landmarks": [
            L("west", "来路（西端）", (0, 1), (7, 9), "你们来的方向"),
            L("wagon", "货车", (2, 3), (7, 8), "你们护送的那辆货车，停在路上"),
            L("horses", "两匹死马", (8, 9), (7, 8), "横在路中间，堵住大半个路面，只有南侧留着一条窄缝"),
            L("logs", "北侧倒木", (8, 15), (2, 3), "几根倒下的老树干，可以当掩体"),
            L("brush_n", "北侧灌木丛", (10, 14), (4, 6), "密，能藏人"),
            L("brush_s", "南侧灌木丛", (7, 11), (10, 11), "密，能藏人"),
            L("east", "去路（东端）", (15, 16), (7, 9), "路继续往东，通向凡达林"),
        ],
        "start": {"player_a": [4, 7], "player_b": [4, 8]},
        "spawns": {"goblin": [[12, 5], [9, 10]]},
    },
    "phandalin-camp": {
        "scene": "02-forest-camp.md",
        "blocked_names": None,
        "landmarks": [
            L("west", "来路（西）", (3, 4), (6, 8), "你们从这边走进空地"),
            L("fire", "篝火坑", (8, 8), (6, 6), "余烬还是温的"),
            L("tent_n", "北侧帐篷", (6, 7), (4, 5), "灰绿色的小帐篷"),
            L("tent_s", "南侧帐篷", (5, 7), (8, 9), "灰绿色的小帐篷"),
            L("red", "红顶大帐", (9, 11), (7, 9), "最大的一顶，门帘半掀着"),
            L("wolf", "拴狼的柱子", (12, 12), (8, 8), "红帐旁边的木桩，拴着一条粗绳"),
            L("rock_w", "大石（西北）", (1, 3), (0, 2), "一块平顶的大石头"),
            L("rock_e", "大石（东）", (16, 17), (6, 8), "半人高的岩石"),
            L("trail", "东北小径", (13, 14), (3, 4), "被踩出来的窄径，通向溪水声的方向"),
        ],
        "start": {"player_a": [3, 7], "player_b": [4, 8]},
        "spawns": {"wolf": [[12, 8]]},
    },
    "phandalin-cave-mouth": {
        "scene": "03-cave-mouth.md",
        "blocked_names": None,
        "landmarks": [
            L("entrance", "洞口（溪水出口）", (6, 10), (1, 1), "山壁的裂缝，冷溪从这里流出来"),
            L("passage", "狭窄通道", (7, 8), (2, 3), "两格宽，溪水到脚踝，石头很滑"),
            L("kennel", "木板兽栏", (1, 5), (5, 7), "木板围起来的栏，里面有狼的低吼"),
            L("bridge_w", "木板桥（西）", (5, 6), (6, 7), "几块搭在溪上的木板"),
            L("mid", "中洞", (7, 10), (7, 9), "溪水绕着石头流"),
            L("bridge_e", "木板桥（东）", (13, 14), (9, 10), "几块搭在溪上的木板"),
            L("loot", "堆箱子的石室", (17, 18), (4, 6), "三只木箱靠墙放着"),
            L("hall", "东南洞厅", (14, 20), (7, 11), "最宽的一段，溪水在这里分成两股"),
            L("alcove", "南边的小洞", (12, 12), (10, 12), "一个落脚的小凹洞，地上有些碎石"),
            L("stair", "向下的暗道", (18, 20), (10, 11), "湿滑的斜坡，水声在下面变大"),
        ],
        "start": {"player_a": [7, 1], "player_b": [9, 1]},
        "spawns": {"goblin": [[8, 3], [6, 5]], "wolf": [[1, 6]]},
    },
    "phandalin-cave-hall": {
        "scene": "04-water-hall.md",
        "blocked_names": None,
        "landmarks": [
            L("top", "上游洞口（来路）", (11, 12), (0, 1), "你们从斜坡下来的地方"),
            L("upper", "上游窄洞", (5, 10), (2, 4), "溪水从这里流下来"),
            L("cage", "西洞（铁笼）", (1, 4), (6, 9), "洞里放着一只铁笼"),
            L("shallows", "中央浅滩", (7, 15), (8, 10), "溪水摊开，齐膝深，有石头可踩"),
            L("main", "大溶洞", (6, 14), (6, 9), "洞里最开阔的地方"),
            L("lair", "东侧石室", (17, 19), (4, 8), "头目的窝，门口堆着箱子"),
            L("ne", "东北小洞", (14, 16), (5, 6), "一条短窄的侧洞"),
            L("outflow", "东南出水口", (17, 19), (9, 10), "溪水流出洞外，有风吹进来"),
        ],
        "start": {"player_a": [11, 0], "player_b": [12, 0]},
        "spawns": {"bugbear": [[19, 5]], "goblin": [[18, 6]]},
    },
    "phandalin-camp-night": {
        "scene": "05-night-camp.md",
        "blocked_names": None,
        "landmarks": [
            L("fire", "营火", (8, 8), (6, 6), "你们生起的火，火星往上飘"),
            L("tent_n", "北侧帐篷", (6, 7), (4, 5), ""),
            L("tent_s", "南侧帐篷", (5, 7), (8, 9), ""),
            L("red", "红顶大帐", (9, 11), (7, 9), "货车上的货堆在这边"),
            L("rock_e", "大石（东）", (16, 17), (6, 8), "背风"),
        ],
        "start": {"player_a": [7, 6], "player_b": [9, 6]},
        "spawns": {},
    },
}

ADVENTURE_DIR = (Path(__file__).resolve().parents[2] / 'campaign-vault' / 'adventures' / 'phandalin-road' / 'scenes')


def compact_json(info: dict) -> str:
    """Readable but short: top-level keys on their own lines, one list item (polygon / cell range / landmark) per line."""
    def j(v) -> str:
        return json.dumps(v, ensure_ascii=False)
    lines = ["{"]
    keys = list(info.keys())
    for ki, k in enumerate(keys):
        v = info[k]
        comma = "," if ki < len(keys) - 1 else ""
        if isinstance(v, list) and v:
            lines.append(f'  "{k}": [')
            for i, item in enumerate(v):
                lines.append("    " + j(item) + ("," if i < len(v) - 1 else ""))
            lines.append("  ]" + comma)
        else:
            lines.append(f'  "{k}": {j(v)}{comma}')
    lines.append("}")
    return "\n".join(lines)


def assemble(report: dict) -> None:
    """Rewrite the `## 地图信息` section (to the end of the file) of each scene markdown with a fresh JSON block."""
    for name, ex in EXTRAS.items():
        rep = report[name]
        blocked = []
        names = ex.get("blocked_names")
        for i, r in enumerate(rep["blocked"]):
            label = names[i] if names and i < len(names) else ("树丛 / 岩石 / 帐篷" if "camp" in name else "障碍")
            blocked.append({"name": label, "cells": r})
        blocked += ex.get("extra_blocked", [])
        if "camp" in name:
            # name the camp obstacles a little better than one catch-all label
            for b in blocked:
                c = b["cells"]
                if c in CAMP_ROCKS:
                    b["name"] = "岩石"
                elif c in CAMP_TENTS:
                    b["name"] = "帐篷 / 篝火"
                else:
                    b["name"] = "树丛"
        standable_polys = rep["standable"]
        if "cave" in name:
            standable_polys = rep["standable_rect_polys"]
        info = {
            "standable": [{"name": "洞穴地面" if "cave" in name else "林地", "kind": "cave" if "cave" in name else "forest", "polygon": p} for p in standable_polys],
            "water": [],
            "blocked": blocked,
            "landmarks": ex["landmarks"],
            "start": ex["start"],
            "spawns": ex["spawns"],
        }
        path = ADVENTURE_DIR / ex["scene"]
        if not path.exists():
            print("  (no scene file yet)", path.name)
            continue
        md = path.read_text(encoding="utf-8")
        marker = "## 地图信息"
        head = md.split(marker)[0].rstrip() + "\n\n"
        body = compact_json(info)
        path.write_text(head + marker + "\n\n```json\n" + body + "\n```\n", encoding="utf-8")
        print(f"  wrote 地图信息 into {path.name}: {len(standable_polys)} standable polygon(s), {len(blocked)} blocked")


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    report = {}

    # --- road: blocked = fallen trunks (hand-listed from the picture) ---
    road_blocked = [
        {"col": [2, 3], "row": [2, 3]},
        {"col": [8, 9], "row": [2, 3]},
        {"col": [10, 12], "row": [3, 3]},
        {"col": [14, 15], "row": [2, 3]},
    ]
    report["phandalin-road"] = {"standable": [[[0, 0], [17, 0], [17, 12.75], [0, 12.75]]], "blocked": road_blocked}

    # --- camps ---
    for nm in ("phandalin-camp", "phandalin-camp-night"):
        f = forest(20, 15, [CAMP_ROCKS, CAMP_TENTS, CAMP_TREES])
        report[nm] = {"standable": [[[0, 0], [20, 0], [20, 15], [0, 15]]], "blocked": mask_to_rects(f["mask"])}
        tint(MAPS / f"{nm}.jpg", out / f"{nm}.debug.png", f["mask"], 100)

    # --- caves ---
    for nm, off in (("phandalin-cave-mouth", (0, 0)), ("phandalin-cave-hall", (0, 50))):
        c = cave(nm, 100, off)
        rects = mask_to_rects(c["mask"])
        report[nm] = {"standable": [], "standable_rect_polys": rects_to_polys(rects), "blocked": []}
        tint(MAPS / f"{nm}.png", out / f"{nm}.debug.png", c["mask"], 100, c["off"], color=(0, 200, 0), alpha=70)
        print(nm, "floor cells", int(c["mask"].sum()), "of", c["mask"].size, "in", len(rects), "rectangles")

    for nm, v in report.items():
        (out / f"{nm}.mapinfo.json").write_text(json.dumps({k: x for k, x in v.items()}, ensure_ascii=False), encoding="utf-8")
    assemble(report)


if __name__ == "__main__":
    main()