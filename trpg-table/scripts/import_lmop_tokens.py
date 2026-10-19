"""把 campaign-vault/resource_pack/Tokens PNG 300ppi 里的凡达林模组 token 放进 vault 的 assets/tokens。

做两件事（重复运行没有副作用）：
  1. 全部 PNG 按文件名转成小写下划线，复制到 assets/tokens/lmop/<slug>.png。
     AtlasSync.imageFor 在 assets/tokens/<怪物 id>.png 找不到时会再找 assets/tokens/lmop/<怪物 id>.png，
     所以以后加 hobgoblin / orc / ogre / owlbear / stirge / nothic 这些怪物时，token 自动就有了。
  2. 引擎里已有的怪物，把对应的图复制成 assets/tokens/<怪物 id>.png；原来的占位图第一次覆盖时留一份在
     assets/tokens/_replaced/ 里（已经留过的不会再覆盖）。

用法：python -I scripts/import_lmop_tokens.py [vault 路径]
图本身不改（不缩放、不去水印）：来源和许可证见 campaign-vault/LICENSES.md。
"""
import re
import shutil
import sys
from pathlib import Path

VAULT = Path(sys.argv[1]) if len(sys.argv) > 1 else (Path(__file__).resolve().parents[2] / 'campaign-vault')
SRC = VAULT / 'resource_pack' / 'Tokens PNG 300ppi'
TOKENS = VAULT / 'assets' / 'tokens'
LMOP = TOKENS / 'lmop'
REPLACED = TOKENS / '_replaced'

# 引擎 monsters.ts 里已有、且包里有对应图的怪物（sahuagin / giant_crab / swarm_of_rats / animated_armor 不是凡达林的怪，
# bandit_captain / scout 包里没有合适的图，继续用原来的占位图）
ENGINE_MAP = {
    'goblin': 'Goblin',
    'wolf': 'Wolf',
    'bugbear': 'Bugbear',
    'skeleton': 'Skeleton',
    'zombie': 'Zombie',
    'ghoul': 'Ghoul',
    'giant_spider': 'Giant Spider',
    'cultist': 'Cultist',
    'bandit': 'Redbrand Ruffian',
}


def slug(name: str) -> str:
    return re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')


def main() -> int:
    if not SRC.is_dir():
        print(f'找不到 {SRC}')
        return 1
    LMOP.mkdir(parents=True, exist_ok=True)
    copied = 0
    by_slug = {}
    for f in sorted(SRC.glob('*.png')):
        s = slug(f.stem)
        by_slug[s] = f
        dst = LMOP / f'{s}.png'
        if not dst.exists() or dst.stat().st_size != f.stat().st_size:
            shutil.copyfile(f, dst)
            copied += 1
    print(f'lmop/ 里共 {len(by_slug)} 张，这次复制了 {copied} 张')

    for eid, pretty in ENGINE_MAP.items():
        src = by_slug.get(slug(pretty))
        if src is None:
            print(f'  跳过 {eid}：包里没有 {pretty}')
            continue
        dst = TOKENS / f'{eid}.png'
        if dst.exists() and dst.read_bytes() == src.read_bytes():
            print(f'  {eid}: 已经是 {pretty}')
            continue
        if dst.exists():
            REPLACED.mkdir(parents=True, exist_ok=True)
            keep = REPLACED / f'{eid}.png'
            if not keep.exists():
                shutil.copyfile(dst, keep)
        shutil.copyfile(src, dst)
        print(f'  {eid}: <- {pretty}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
