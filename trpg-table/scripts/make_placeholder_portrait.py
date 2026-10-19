"""Generate the 2:3 placeholder portraits used by the overlay.

The real sprites are drawn by the user with GPT at 1024x1536. These placeholders
exist so the layout can be judged with a head/body silhouette instead of the old
bowl-shaped blob. They are deliberately simple, flat-shaded, and clearly not final
art. Output: campaign-vault/sprites/<seat>/neutral.png (768x1152, RGBA).
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

W, H = 768, 1152
S = 2  # supersample
OUT = (Path(__file__).resolve().parents[2] / 'campaign-vault' / 'sprites')


def shade(color: tuple[int, int, int], k: float) -> tuple[int, int, int]:
    return tuple(max(0, min(255, int(c * k))) for c in color)


class ScaledDraw:
    """Draws at logical 768x1152 coordinates on the supersampled canvas."""

    def __init__(self, inner: ImageDraw.ImageDraw):
        self.inner = inner

    def _box(self, box):
        return tuple(int(v * S) for v in box)

    def ellipse(self, box, **kw):
        self.inner.ellipse(self._box(box), **kw)

    def rounded_rectangle(self, box, radius=0, **kw):
        self.inner.rounded_rectangle(self._box(box), radius=int(radius * S), **kw)

    def rectangle(self, box, **kw):
        self.inner.rectangle(self._box(box), **kw)

    def polygon(self, points, **kw):
        self.inner.polygon([(int(x * S), int(y * S)) for x, y in points], **kw)

    def line(self, points, **kw):
        if isinstance(points[0], (int, float)):
            pts = [(int(points[i] * S), int(points[i + 1] * S)) for i in range(0, len(points), 2)]
        else:
            pts = [(int(x * S), int(y * S)) for x, y in points]
        if "width" in kw:
            kw["width"] = max(1, int(kw["width"] * S))
        self.inner.line(pts, **kw)

    def arc(self, box, start, end, **kw):
        if "width" in kw:
            kw["width"] = max(1, int(kw["width"] * S))
        self.inner.arc(self._box(box), start, end, **kw)


def rounded(draw: ImageDraw.ImageDraw, box, radius, fill, outline=None, width=0):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def poly(draw: ImageDraw.ImageDraw, points, fill, outline=None, width=0):
    draw.polygon(points, fill=fill)
    if outline:
        draw.line(list(points) + [points[0]], fill=outline, width=width, joint="curve")


def draw_rogue(d: ImageDraw.ImageDraw) -> None:
    skin = (214, 170, 135)
    skin_dark = shade(skin, 0.82)
    hair = (92, 52, 40)
    leather = (44, 78, 88)
    leather_dark = shade(leather, 0.72)
    leather_light = shade(leather, 1.18)
    cloth = (58, 62, 70)
    steel = (176, 186, 196)

    # cloak behind the body
    poly(d, [(170, 470), (250, 410), (520, 410), (612, 470), (650, 1000), (540, 1120), (232, 1120), (120, 1000)], (30, 44, 54, 255))
    # legs
    rounded(d, (268, 860, 366, 1112), 36, cloth)
    rounded(d, (402, 860, 500, 1112), 36, cloth)
    # boots
    rounded(d, (248, 1072, 376, 1124), 20, (46, 34, 30))
    rounded(d, (392, 1072, 520, 1124), 20, (46, 34, 30))
    # torso
    poly(d, [(236, 470), (330, 428), (438, 428), (532, 470), (560, 760), (500, 900), (268, 900), (208, 760)], leather)
    # tunic / shirt
    poly(d, [(330, 430), (384, 520), (438, 430), (470, 452), (438, 610), (330, 610), (298, 452)], cloth)
    # belt
    rounded(d, (248, 746, 520, 790), 10, leather_dark)
    rounded(d, (352, 738, 416, 800), 8, steel)
    # arms
    poly(d, [(226, 492), (286, 500), (300, 760), (244, 790), (206, 700)], leather_dark)
    poly(d, [(542, 492), (482, 500), (468, 760), (524, 790), (562, 700)], leather_dark)
    # hands
    d.ellipse((236, 782, 292, 838), fill=skin)
    d.ellipse((476, 782, 532, 838), fill=skin)
    # dagger at the belt
    poly(d, [(520, 700), (566, 680), (574, 694), (528, 724)], steel)
    rounded(d, (512, 706, 532, 736), 4, (70, 46, 30))
    # neck
    rounded(d, (346, 362, 422, 452), 22, skin_dark)
    # head
    d.ellipse((282, 148, 486, 404), fill=skin)
    # ears
    d.ellipse((272, 254, 300, 306), fill=skin_dark)
    d.ellipse((468, 254, 496, 306), fill=skin_dark)
    # hair: swept side fringe + short bob (face is redrawn over the lower hair)
    d.ellipse((276, 128, 492, 322), fill=hair)
    d.ellipse((292, 196, 478, 404), fill=skin)
    # fringe over forehead
    poly(d, [(298, 214), (316, 158), (398, 138), (456, 188), (438, 214), (388, 196), (338, 206)], hair)
    # brows / eyes
    d.line((322, 244, 360, 238), fill=(60, 40, 34), width=7)
    d.line((408, 238, 446, 244), fill=(60, 40, 34), width=7)
    d.ellipse((330, 254, 362, 282), fill=(36, 40, 44))
    d.ellipse((410, 254, 442, 282), fill=(36, 40, 44))
    d.ellipse((338, 258, 350, 270), fill=(235, 240, 244))
    d.ellipse((418, 258, 430, 270), fill=(235, 240, 244))
    d.ellipse((342, 262, 347, 267), fill=(20, 20, 24))
    d.ellipse((422, 262, 427, 267), fill=(20, 20, 24))
    # nose / mouth / scar
    d.line((384, 288, 376, 322, 394, 326), fill=skin_dark, width=5)
    d.line((354, 350, 414, 344), fill=(120, 70, 62), width=6)
    d.line((446, 260, 462, 310), fill=shade(skin, 0.72), width=4)
    # collar clasp
    d.ellipse((366, 438, 402, 474), fill=steel)
    d.ellipse((376, 448, 392, 464), fill=leather_dark)
    # rim light (a few soft strokes)
    d.line((286, 190, 286, 360), fill=(240, 220, 190, 90), width=4)
    d.line((500, 480, 540, 740), fill=(150, 200, 220, 80), width=5)


def draw_cleric(d: ImageDraw.ImageDraw) -> None:
    skin = (206, 164, 132)
    skin_dark = shade(skin, 0.82)
    beard = (210, 205, 196)
    robe = (222, 214, 196)
    robe_dark = shade(robe, 0.82)
    stole = (78, 62, 104)
    stole_light = shade(stole, 1.25)
    gold = (198, 158, 78)

    # cloak / robe behind
    poly(d, [(150, 500), (250, 420), (518, 420), (618, 500), (668, 1080), (100, 1080)], robe_dark)
    # legs hidden by robe; boots peeking
    rounded(d, (282, 1040, 362, 1118), 18, (70, 54, 42))
    rounded(d, (406, 1040, 486, 1118), 18, (70, 54, 42))
    # robe body
    poly(d, [(232, 470), (326, 424), (442, 424), (536, 470), (588, 1050), (180, 1050)], robe)
    # stole / tabard
    poly(d, [(332, 430), (436, 430), (472, 1050), (296, 1050)], stole)
    poly(d, [(384, 452), (414, 470), (354, 470)], stole_light)
    # belt
    rounded(d, (252, 744, 516, 786), 10, (94, 74, 56))
    d.ellipse((356, 742, 412, 798), fill=gold)
    # arms / sleeves
    poly(d, [(222, 492), (286, 500), (298, 786), (238, 806), (200, 700)], robe_dark)
    poly(d, [(546, 492), (482, 500), (470, 786), (530, 806), (568, 700)], robe_dark)
    # hands
    d.ellipse((232, 796, 290, 854), fill=skin)
    d.ellipse((478, 796, 536, 854), fill=skin)
    # holy symbol hanging from the belt
    d.line((384, 790, 384, 842), fill=gold, width=7)
    d.ellipse((358, 838, 410, 890), fill=None, outline=gold, width=8)
    d.line((384, 846, 384, 882), fill=gold, width=6)
    d.line((366, 864, 402, 864), fill=gold, width=6)
    # neck
    rounded(d, (346, 366, 422, 452), 22, skin_dark)
    # head
    d.ellipse((284, 156, 484, 400), fill=skin)
    # hood
    poly(d, [(258, 360), (270, 180), (330, 108), (438, 104), (500, 176), (510, 360), (470, 300), (446, 190), (330, 190), (300, 300)], stole)
    d.ellipse((286, 150, 486, 348), fill=skin)
    # hood opening rim
    d.arc((272, 138, 500, 380), 300, 240, fill=stole_light, width=14)
    # bald head top / short hair
    d.arc((296, 148, 474, 300), 200, 340, fill=(178, 176, 170), width=10)
    # thick eyebrows
    d.line((318, 246, 360, 240), fill=beard, width=10)
    d.line((408, 240, 450, 246), fill=beard, width=10)
    # eyes (kind, slightly narrowed)
    d.ellipse((330, 258, 360, 284), fill=(44, 48, 50))
    d.ellipse((410, 258, 440, 284), fill=(44, 48, 50))
    d.ellipse((338, 262, 350, 274), fill=(240, 240, 235))
    d.ellipse((418, 262, 430, 274), fill=(240, 240, 235))
    # nose
    d.line((384, 288, 376, 326, 396, 330), fill=skin_dark, width=5)
    # beard
    poly(d, [(300, 332), (330, 320), (384, 350), (438, 320), (468, 332), (450, 420), (384, 466), (318, 420)], beard)
    d.line((348, 366, 420, 360), fill=(150, 80, 74), width=6)
    d.line((356, 402, 412, 398), fill=(150, 80, 74), width=5)
    # moustache
    poly(d, [(342, 338), (384, 348), (426, 338), (416, 360), (384, 368), (352, 360)], beard)
    # rim light
    d.line((296, 208, 296, 380), fill=(250, 240, 210, 90), width=4)
    d.line((540, 500, 570, 980), fill=(240, 230, 200, 80), width=5)


def build(seat: str, painter) -> None:
    im = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    inner = ImageDraw.Draw(im)
    painter(ScaledDraw(inner))
    im = im.resize((W, H), Image.LANCZOS)
    out = OUT / seat / "neutral.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out, "PNG")
    print(f"{out} {im.size} {out.stat().st_size} bytes")


def main() -> None:
    build("player_a", draw_rogue)
    build("player_b", draw_cleric)


if __name__ == "__main__":
    main()
