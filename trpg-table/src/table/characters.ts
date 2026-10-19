import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCharacter, type CharacterBuild } from '../rules/build/index.js';
import { actorFromCharacter, DEFAULT_PARTY, type CharacterFile } from '../rules/sheet.js';
import type { Actor } from '../rules/types.js';
import { addCoins, addItem, coinsFrom, DICE_FORMULA, ITEM_KINDS, type ItemKind } from '../rules/inventory.js';
import type { SeatKey } from './types.js';

export interface PartyRuntime {
  a: Actor;
  b: Actor;
  source: 'vault' | 'default';
  warnings: string[];
}

interface ReadResult {
  file: CharacterFile | null;
  /** 读不了 / 不能用的原因（这个座位会退回内置草稿） */
  warning?: string;
  /** 构建器的 errors / warnings 和其它提示，原样并进 PartyRuntime.warnings */
  extra?: string[];
}

/**
 * 新格式：json 里有 `build` 字段（CharacterBuild）就交给构建器算整张卡（见 src/rules/build/README.md）。
 * 顶层的 persona 可以覆盖构建出来的人设；顶层的 notes 追加在构建器的备注后面。
 */
function readBuilt(path: string, seat: SeatKey, raw: Record<string, unknown>): ReadResult {
  const build = { ...(raw.build as CharacterBuild) };
  if (!build.seat) build.seat = seat;
  const tag = `${seat}.json（build）`;
  let res;
  try {
    res = buildCharacter(build);
  } catch (e) {
    return { file: null, warning: `${path} 的 build 构建失败：${(e as Error).message}` };
  }
  const extra = [...res.errors.map((m) => `${tag} 错误：${m}`), ...res.warnings.map((m) => `${tag}：${m}`)];
  if (res.errors.length > 0) {
    return { file: null, warning: `${path} 的 build 有 ${res.errors.length} 个错误，这个座位先用内置草稿（见下面的错误）`, extra };
  }
  const file: CharacterFile = { ...res.file };
  if (typeof raw.persona === 'string' && raw.persona.trim()) file.persona = raw.persona;
  else if (!file.persona) extra.push(`${tag}：没有 persona（build.persona 或顶层 persona），这个角色没有人设`);
  if (typeof raw.notes === 'string' && raw.notes.trim()) file.notes = [file.notes, raw.notes].filter(Boolean).join('\n');
  if (typeof raw.name === 'string' && raw.name.trim()) file.name = raw.name.trim();
  if (typeof raw.xp === 'number' && Number.isFinite(raw.xp) && raw.xp >= 0) file.xp = raw.xp;
  if (Array.isArray(raw.aliases)) file.aliases = raw.aliases.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  return { file, extra };
}

/**
 * 角色卡文件的位置。`set` 不写 = campaign-vault/characters/<seat>.json（现在的 1 级版）；
 * 写了（比如 'lv3'）= campaign-vault/characters/<set>/<seat>.json，那一套另存，不覆盖原来的。
 * 指定的那套里没有这个座位的文件就退回原来的。
 */
export function characterPath(vault: string, seat: SeatKey, set = ''): string {
  if (set) {
    const p = join(vault, 'characters', set, `${seat}.json`);
    if (existsSync(p)) return p;
  }
  return join(vault, 'characters', `${seat}.json`);
}

/** 角色卡里的 build 规格（升级用）；手写整张卡的角色没有。 */
export function readBuildSpec(vault: string, seat: SeatKey, set = ''): CharacterBuild | null {
  try {
    const parsed = JSON.parse(readFileSync(characterPath(vault, seat, set), 'utf8')) as Record<string, unknown>;
    if (!parsed.build || typeof parsed.build !== 'object') return null;
    const build = { ...(parsed.build as CharacterBuild) };
    if (!build.seat) build.seat = seat;
    return build;
  } catch {
    return null;
  }
}

function readCharacter(vault: string, seat: SeatKey, set = ''): ReadResult {
  const path = characterPath(vault, seat, set);
  if (!existsSync(path)) return { file: null };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (parsed.build && typeof parsed.build === 'object') return readBuilt(path, seat, parsed);

    const raw = parsed as Partial<CharacterFile>;
    if (!raw.name || !raw.abilities || !raw.ac || !raw.maxHp) {
      return { file: null, warning: `${path} 缺字段（name/abilities/ac/maxHp）` };
    }
    const base = DEFAULT_PARTY[seat];
    return {
      file: {
        ...base,
        ...raw,
        abilities: { ...base.abilities, ...raw.abilities },
        saves: raw.saves ?? base.saves,
        skills: raw.skills ?? base.skills,
        expertise: raw.expertise ?? base.expertise,
        attacks: raw.attacks ?? base.attacks,
        spells: raw.spells ?? base.spells,
        resources: raw.resources ?? base.resources,
        hitDice: raw.hitDice ?? base.hitDice,
        persona: raw.persona ?? base.persona,
      },
    };
  } catch (e) {
    return { file: null, warning: `${path} 读取失败：${(e as Error).message}` };
  }
}

/**
 * 角色卡里可选的起始物品：json 顶层 `"kit": { "gold": 15, "items": [{ "name": "治疗药水", "qty": 2, "kind": "consumable", "heal": "2d4+2", "desc": "…" }] }`。
 * 没写就是空背包、没有钱。存档里已经有的角色不会被它覆盖（和人设不同，物品是状态）。
 */
export function applyKit(actor: Actor, vault: string, seat: SeatKey, set = ''): void {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(characterPath(vault, seat, set), 'utf8')) as Record<string, unknown>;
  } catch {
    return;
  }
  const kit = raw.kit as { gold?: unknown; items?: unknown } | undefined;
  if (!kit || typeof kit !== 'object') return;
  if (typeof kit.gold === 'number' && kit.gold > 0) addCoins(actor, coinsFrom({ gp: kit.gold }));
  for (const it of Array.isArray(kit.items) ? (kit.items as Record<string, unknown>[]) : []) {
    if (!it || typeof it.name !== 'string' || !it.name.trim()) continue;
    const kind = (ITEM_KINDS as readonly string[]).includes(String(it.kind)) ? (it.kind as ItemKind) : 'gear';
    const heal = typeof it.heal === 'string' && DICE_FORMULA.test(it.heal) ? it.heal.replace(/\s+/g, '') : undefined;
    addItem(actor, {
      name: it.name,
      qty: typeof it.qty === 'number' ? it.qty : 1,
      kind: heal ? 'consumable' : kind,
      ...(typeof it.desc === 'string' && it.desc ? { desc: it.desc } : {}),
      ...(heal ? { use: { heal } } : {}),
    });
  }
}

/** 角色卡从 campaign-vault/characters/<seat>.json 读（`set` 见 characterPath）；没有就用内置草稿（需要用户定稿）。 */
export function loadParty(vault: string, set = ''): PartyRuntime {
  const warnings: string[] = [];
  const a = readCharacter(vault, 'player_a', set);
  const b = readCharacter(vault, 'player_b', set);
  for (const r of [a, b]) {
    if (r.warning) warnings.push(r.warning);
    if (r.extra) warnings.push(...r.extra);
  }
  const source = a.file && b.file ? 'vault' : 'default';
  const actorA = actorFromCharacter(a.file ?? DEFAULT_PARTY.player_a, 'player_a', 'player_a');
  const actorB = actorFromCharacter(b.file ?? DEFAULT_PARTY.player_b, 'player_b', 'player_b');
  if (a.file) applyKit(actorA, vault, 'player_a', set);
  if (b.file) applyKit(actorB, vault, 'player_b', set);
  return {
    a: actorA,
    b: actorB,
    source,
    warnings,
  };
}
