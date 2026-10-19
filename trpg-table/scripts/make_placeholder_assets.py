"""生成 campaign-vault 的占位地图 / token 图 / .atlasmap。

这些都是原创占位素材（无第三方版权），正式直播前可以用用户选定的地图替换。
运行：
  <python> scripts/make_placeholder_assets.py
"""
import json
import math
import os
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

VAULT = (Path(__file__).resolve().parents[2] / 'campaign-vault')
TEMPLATE = (Path(__file__).resolve().parents[2] / 'vault' / 'scenes' / 'test.atlasmap')
W, H = 1400, 1000


def font(size: int) -> ImageFont.FreeTypeFont:
    for p in [
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\segoeui.ttf",
    ]:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                continue
    return ImageFont.load_default()


def vertical_gradient(size, top, bottom):
    img = Image.new("RGB", size, top)
    d = ImageDraw.Draw(img)
    for y in range(size[1]):
        t = y / max(1, size[1] - 1)
        c = tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(3))
        d.line([(0, y), (size[0], y)], fill=c)
    return img


def deck_map(path: Path):
    img = vertical_gradient((W, H), (10, 24, 34), (5, 12, 18))
    d = ImageDraw.Draw(img, "RGBA")
    # 海面波纹
    for _ in range(220):
        x = random.randint(0, W)
        y = random.randint(0, H)
        ln = random.randint(20, 90)
        d.line([(x, y), (x + ln, y + random.randint(-4, 4))], fill=(70, 130, 150, random.randint(12, 34)), width=2)
    # 船体（倾斜的甲板）
    hull = [(190, 150), (1310, 250), (1190, 890), (110, 760)]
    d.polygon(hull, fill=(52, 42, 33, 255))
    d.polygon(hull, outline=(90, 72, 52, 255), width=8)
    # 甲板板条
    for i in range(26):
        t = i / 25
        x1 = 190 + (110 - 190) * t
        y1 = 150 + (760 - 150) * t
        x2 = 1310 + (1190 - 1310) * t
        y2 = 250 + (890 - 250) * t
        d.line([(x1, y1), (x2, y2)], fill=(70, 56, 42, 255), width=3)
    for i in range(18):
        t = i / 17
        x = 190 + (1310 - 190) * t
        y = 150 + (250 - 150) * t
        x2 = 110 + (1190 - 110) * t
        y2 = 760 + (890 - 760) * t
        d.line([(x, y), (x2, y2)], fill=(44, 36, 28, 180), width=2)
    # 断桅
    d.ellipse([720, 340, 860, 410], fill=(38, 31, 24, 255), outline=(95, 76, 55, 255), width=5)
    d.line([(790, 360), (700, 120)], fill=(86, 68, 48, 255), width=22)
    d.line([(790, 360), (930, 170)], fill=(78, 62, 44, 255), width=14)
    # 货舱口
    d.rounded_rectangle([360, 470, 590, 690], radius=8, fill=(8, 8, 9, 255), outline=(105, 84, 58, 255), width=7)
    for i in range(4):
        d.line([(370 + i * 55, 478), (370 + i * 55, 682)], fill=(40, 33, 25, 255), width=3)
    # 木箱
    for (x, y, w, h) in [(980, 540, 110, 90), (1050, 660, 90, 80), (300, 280, 100, 80)]:
        d.rectangle([x, y, x + w, y + h], fill=(66, 50, 34, 255), outline=(112, 88, 58, 255), width=4)
        d.line([(x, y), (x + w, y + h)], fill=(95, 74, 50, 200), width=2)
        d.line([(x + w, y), (x, y + h)], fill=(95, 74, 50, 200), width=2)
    # 提灯的光
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for r in range(360, 20, -30):
        a = int(6 + (360 - r) / 360 * 10)
        gd.ellipse([1120 - r, 300 - r, 1120 + r, 300 + r], fill=(255, 196, 96, a))
    img = Image.alpha_composite(img.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(40)))
    d = ImageDraw.Draw(img, "RGBA")
    d.ellipse([1110, 290, 1130, 310], fill=(255, 214, 130, 255))
    # 水线泡沫
    for _ in range(90):
        x = random.choice([random.randint(0, 200), random.randint(1200, W)])
        y = random.randint(80, H)
        d.ellipse([x, y, x + random.randint(6, 22), y + random.randint(2, 6)], fill=(180, 220, 230, random.randint(20, 60)))
    img.convert("RGB").save(path, quality=92)


def hold_map(path: Path):
    img = vertical_gradient((W, H), (26, 22, 18), (12, 11, 10))
    d = ImageDraw.Draw(img, "RGBA")
    # 木墙 / 地板
    for x in range(0, W, 70):
        d.line([(x, 0), (x, H)], fill=(48, 38, 28, 255), width=3)
    for y in range(0, H, 70):
        d.line([(0, y), (W, y)], fill=(40, 32, 24, 200), width=2)
    # 积水
    for (x, y, rx, ry) in [(120, 720, 300, 90), (900, 170, 240, 70), (620, 800, 200, 60)]:
        d.ellipse([x - rx, y - ry, x + rx, y + ry], fill=(18, 44, 56, 210), outline=(40, 90, 100, 160), width=3)
    # 木箱堆
    for (x, y, w, h) in [(240, 200, 140, 120), (420, 260, 120, 100), (970, 560, 150, 130), (840, 640, 100, 90)]:
        d.rectangle([x, y, x + w, y + h], fill=(60, 46, 32, 255), outline=(105, 82, 54, 255), width=5)
        d.line([(x, y), (x + w, y + h)], fill=(92, 72, 48, 220), width=2)
        d.line([(x + w, y), (x, y + h)], fill=(92, 72, 48, 220), width=2)
    # 钉死的门 + 太阳记号
    d.rectangle([660, 330, 860, 620], fill=(35, 28, 21, 255), outline=(92, 74, 50, 255), width=8)
    for yy in (370, 470, 570):
        d.line([(650, yy), (870, yy)], fill=(70, 56, 40, 255), width=8)
    cx, cy = 760, 390
    d.ellipse([cx - 38, cy - 38, cx + 38, cy + 38], outline=(180, 150, 90, 230), width=4)
    for k in range(12):
        a = k * math.pi / 6
        d.line([(cx + math.cos(a) * 42, cy + math.sin(a) * 42), (cx + math.cos(a) * 58, cy + math.sin(a) * 58)], fill=(180, 150, 90, 210), width=3)
    # 一盏冷光
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for r in range(300, 10, -30):
        gd.ellipse([700 - r, 480 - r, 700 + r, 480 + r], fill=(80, 150, 190, 8))
    img = Image.alpha_composite(img.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(50)))
    img.convert("RGB").save(path, quality=92)


def cave_map(path: Path):
    img = vertical_gradient((W, H), (12, 16, 20), (4, 6, 9))
    d = ImageDraw.Draw(img, "RGBA")
    # 岩壁
    for _ in range(160):
        x = random.randint(0, W)
        y = random.randint(0, H)
        r = random.randint(30, 120)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(20 + random.randint(0, 16), 24 + random.randint(0, 16), 30, 40))
    # 水池
    d.ellipse([250, 480, 1150, 950], fill=(8, 28, 40, 255), outline=(30, 90, 110, 200), width=6)
    for _ in range(120):
        x = random.randint(280, 1120)
        y = random.randint(510, 920)
        d.arc([x, y, x + random.randint(20, 80), y + random.randint(8, 24)], 200, 340, fill=(70, 160, 190, 90), width=2)
    # 祭坛
    d.polygon([(600, 430), (800, 430), (840, 520), (560, 520)], fill=(34, 36, 40, 255), outline=(80, 84, 92, 255))
    d.rectangle([640, 380, 760, 440], fill=(44, 46, 52, 255), outline=(100, 104, 112, 255))
    d.ellipse([680, 340, 720, 380], fill=(90, 200, 230, 220))
    # 冷蓝光
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for r in range(420, 30, -40):
        gd.ellipse([700 - r, 380 - r, 700 + r, 380 + r], fill=(50, 140, 200, 8))
    img = Image.alpha_composite(img.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(60)))
    d = ImageDraw.Draw(img, "RGBA")
    # 钟乳石
    for _ in range(26):
        x = random.randint(0, W)
        h = random.randint(30, 120)
        d.polygon([(x, 0), (x + random.randint(10, 30), 0), (x + random.randint(8, 22), h)], fill=(18, 22, 28, 255))
    img.convert("RGB").save(path, quality=92)


def token_icon(path: Path, bg, ring, label: str, kind: str = "pc"):
    size = 256
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([8, 8, size - 8, size - 8], fill=bg, outline=ring, width=9)
    if kind == "pc":
        f = font(120)
        box = d.textbbox((0, 0), label, font=f)
        d.text(((size - (box[2] - box[0])) / 2, (size - (box[3] - box[1])) / 2 - 6), label, font=f, fill=(235, 242, 248, 255))
    elif kind == "fish":
        d.polygon([(60, 128), (150, 70), (196, 128), (150, 186)], fill=(160, 210, 220, 255))
        d.polygon([(70, 128), (36, 92), (44, 164)], fill=(110, 170, 190, 255))
        d.ellipse([156, 108, 172, 124], fill=(20, 30, 40, 255))
    elif kind == "armor":
        d.polygon([(128, 52), (186, 86), (170, 182), (128, 208), (86, 182), (70, 86)], fill=(170, 176, 184, 255))
        d.rectangle([104, 112, 152, 124], fill=(30, 34, 40, 255))
        d.line([(128, 124), (128, 172)], fill=(60, 64, 72, 255), width=5)
    elif kind == "ghoul":
        d.ellipse([84, 74, 172, 168], fill=(120, 150, 110, 255))
        d.polygon([(92, 120), (60, 82), (78, 150)], fill=(96, 126, 90, 255))
        d.polygon([(164, 120), (196, 82), (178, 150)], fill=(96, 126, 90, 255))
        d.ellipse([108, 104, 120, 116], fill=(230, 240, 220, 255))
        d.ellipse([136, 104, 148, 116], fill=(230, 240, 220, 255))
    elif kind == "crab":
        d.ellipse([78, 96, 178, 186], fill=(200, 140, 100, 255))
        d.ellipse([40, 70, 100, 120], fill=(210, 150, 110, 255))
        d.ellipse([156, 70, 216, 120], fill=(210, 150, 110, 255))
        d.line([(80, 180), (52, 214)], fill=(180, 120, 84, 255), width=7)
        d.line([(176, 180), (204, 214)], fill=(180, 120, 84, 255), width=7)
    else:
        f = font(110)
        box = d.textbbox((0, 0), label, font=f)
        d.text(((size - (box[2] - box[0])) / 2, (size - (box[3] - box[1])) / 2 - 6), label, font=f, fill=(235, 242, 248, 255))
    img.save(path)


def atlasmap(scene_path: Path, bg: str, map_name: str):
    data = json.loads(TEMPLATE.read_text(encoding="utf-8"))
    state = data["state"]
    state["mapPath"] = map_name
    state["background"] = bg
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
    state["lighting"] = {"enabled": True, "ambient": 0.25, "tokenVision": True, "exploredMemory": True}
    scene_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    random.seed(20261017)
    for sub in ["assets/maps", "assets/tokens", "scenes"]:
        (VAULT / sub).mkdir(parents=True, exist_ok=True)
    deck_map(VAULT / "assets/maps/crashed-ship-deck.png")
    hold_map(VAULT / "assets/maps/crashed-ship-hold.png")
    cave_map(VAULT / "assets/maps/crashed-ship-cave.png")

    token_icon(VAULT / "assets/tokens/player_a.png", (44, 78, 110, 255), (127, 182, 216, 255), "A")
    token_icon(VAULT / "assets/tokens/player_b.png", (70, 60, 104, 255), (167, 154, 208, 255), "B")
    token_icon(VAULT / "assets/tokens/sahuagin.png", (20, 52, 60, 255), (120, 190, 200, 255), "S", "fish")
    token_icon(VAULT / "assets/tokens/ghoul.png", (34, 46, 34, 255), (140, 170, 120, 255), "G", "ghoul")
    token_icon(VAULT / "assets/tokens/animated_armor.png", (54, 58, 64, 255), (170, 176, 184, 255), "AA", "armor")
    token_icon(VAULT / "assets/tokens/giant_crab.png", (66, 40, 30, 255), (220, 160, 120, 255), "C", "crab")
    token_icon(VAULT / "assets/tokens/goblin.png", (36, 52, 34, 255), (150, 180, 120, 255), "G", "generic")
    token_icon(VAULT / "assets/tokens/monster.png", (46, 40, 46, 255), (170, 150, 170, 255), "?", "generic")

    atlasmap(VAULT / "scenes/crashed-ship-deck.atlasmap", "assets/maps/crashed-ship-deck.png", "scenes/crashed-ship-deck.atlasmap")
    atlasmap(VAULT / "scenes/crashed-ship-hold.atlasmap", "assets/maps/crashed-ship-hold.png", "scenes/crashed-ship-hold.atlasmap")
    atlasmap(VAULT / "scenes/crashed-ship-cave.atlasmap", "assets/maps/crashed-ship-cave.png", "scenes/crashed-ship-cave.atlasmap")
    print("assets written to", VAULT)


if __name__ == "__main__":
    main()
