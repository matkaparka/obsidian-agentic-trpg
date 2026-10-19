import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CellRange, GridPos, Landmark, MapInfo, MapPoint } from '../rules/types.js';
import { DEFAULT_ADVENTURE } from './defaultAdventure.js';
import { parseEnvironment, type SceneEnv } from './roundClock.js';
import { parseLoot, type LootEntry } from './loot.js';
import { parseBeats, parseExitRules, type Beat, type ExitRule } from './sceneProgress.js';

export interface EncounterEntry {
  monsterId: string;
  count: number;
  /** 覆盖显示名，比如“沙华鱼人斥候” */
  name?: string;
  /**
   * 一进场就摆在地图上、玩家看得见的生物（拴着的狼、看守的 NPC）：写成 `- wolf x 1 (饿狼) [可见]`。
   * 它们不在先攻里；GM 之后 start_combat 里写同样的 monster_id，就是把它们拉进战斗（不会再生成一份）。
   * 没写 [可见] 的（伏兵）还是开战时才出现。
   */
  visible?: boolean;
}

export interface AdventureScene {
  id: string;
  title: string;
  map?: string;
  /** 场景地图信息（可站立区域 / 水 / 障碍 / 地标）；缺失时整块棋盘都能站。 */
  mapInfo?: MapInfo;
  readAloud: string;
  publicNotes: string;
  gmSecrets: string;
  encounter: EncounterEntry[];
  /**
   * 自己会动的环境（水位、天色、巡逻、倒计时），在场景 md 的 `## 环境` 里一行一条：
   * `- 暮色｜每 5 轮｜天色又暗了一档`。每一轮的世界回合里，到点的条目要由 GM 处理一次。没有这一段就是空。
   */
  environment?: SceneEnv[];
  /**
   * 场景里能找到的东西（GM 的清单，玩家不知道）。场景 md 的 `## 战利品`，一行一件：`- 名字 ×数量｜类别｜说明｜在哪里`，
   * 钱写成 `- 碎银 9 gp｜红帐的战利品箱里`；格式见 loot.ts。
   */
  loot?: LootEntry[];
  /** 这一幕该走完的几件事（`## 节拍`，`- id｜描述`），GM 打勾、导演打勾，画面显示进度；格式见 sceneProgress.ts */
  beats?: Beat[];
  /** 自动出口规则（`## 自动出口`，`- 条件｜说明`）：满足了桌面就让 GM 收尾，GM 不收桌面替它收 */
  autoExit?: ExitRule[];
  exits: string;
  ending: boolean;
}

export interface Adventure {
  id: string;
  title: string;
  overview: string;
  scenes: AdventureScene[];
  source: 'vault' | 'builtin';
}

const listDirs = (path: string): string[] => {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
};

/** 读 `## 标题` 到下一个二级标题之间的正文 */
function section(md: string, heading: string): string {
  const re = new RegExp(`^##\\s*${heading}\\s*$`, 'm');
  const start = re.exec(md);
  if (!start) return '';
  const rest = md.slice(start.index + start[0].length);
  const next = /^##\s+/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

function frontmatter(md: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.+)$/.exec(line.trim());
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function parseEncounter(raw: string): EncounterEntry[] {
  const out: EncounterEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*[-*]\s*([a-z0-9_]+)\s*(?:[x×*]\s*(\d+))?(?:\s*[（(]([^）)]+)[）)])?/i.exec(line);
    if (!m) continue;
    const visible = /[\[【](?:可见|visible)[\]】]/i.test(line);
    out.push({ monsterId: m[1], count: Math.max(1, Number(m[2] ?? 1)), name: m[3], ...(visible ? { visible: true } : {}) });
  }
  return out;
}

/** 没有地图信息时的兜底：整个棋盘都能站，没有地标。 */
export const FALLBACK_MAP_INFO: MapInfo = {
  standable: [],
  water: [],
  blocked: [],
  landmarks: [],
  wholeBoard: true,
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parsePolygon(raw: unknown): MapPoint[] | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const points: MapPoint[] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2 || !isNum(p[0]) || !isNum(p[1])) return null;
    points.push([p[0], p[1]]);
  }
  return points;
}

function parseCellRange(raw: unknown): CellRange | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = (raw as { col?: unknown }).col;
  const r = (raw as { row?: unknown }).row;
  if (!Array.isArray(c) || !Array.isArray(r) || !isNum(c[0]) || !isNum(c[1]) || !isNum(r[0]) || !isNum(r[1])) {
    return null;
  }
  return {
    col: [Math.min(c[0], c[1]), Math.max(c[0], c[1])],
    row: [Math.min(r[0], r[1]), Math.max(r[0], r[1])],
  };
}

/** 解析场景 md 的 `## 地图信息` 代码块；缺失/JSON 不合法都返回整块棋盘可站的兜底。 */
export function parseMapInfo(md: string): MapInfo {
  const raw = section(md, '地图信息');
  if (!raw) return { ...FALLBACK_MAP_INFO };
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (!fence) return { ...FALLBACK_MAP_INFO };
  let data: unknown;
  try {
    data = JSON.parse(fence[1]);
  } catch {
    return { ...FALLBACK_MAP_INFO };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ...FALLBACK_MAP_INFO };
  const obj = data as Record<string, unknown>;

  const standable: MapInfo['standable'] = [];
  if (Array.isArray(obj.standable)) {
    for (const item of obj.standable) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const polygon = parsePolygon(rec.polygon);
      if (!polygon) continue;
      standable.push({
        name: typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : '可站立区域',
        kind: typeof rec.kind === 'string' ? rec.kind : undefined,
        polygon,
      });
    }
  }
  // 连一块合法可站立区域都没有 → 按“没有地图数据”处理，不让场景变成死局
  if (!standable.length) return { ...FALLBACK_MAP_INFO };

  const water: MapInfo['water'] = [];
  if (Array.isArray(obj.water)) {
    for (const item of obj.water) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const polygon = parsePolygon(rec.polygon);
      if (!polygon) continue;
      water.push({
        name: typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : '水面',
        polygon,
      });
    }
  }

  const blocked: MapInfo['blocked'] = [];
  if (Array.isArray(obj.blocked)) {
    for (const item of obj.blocked) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const cells = parseCellRange(rec.cells);
      if (!cells) continue;
      blocked.push({
        name: typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : '障碍',
        cells,
      });
    }
  }

  const landmarks: Landmark[] = [];
  if (Array.isArray(obj.landmarks)) {
    for (const item of obj.landmarks) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const cells = parseCellRange(rec.cells);
      if (!cells) continue;
      landmarks.push({
        id: typeof rec.id === 'string' ? rec.id : undefined,
        name: typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : '地标',
        cells,
        note: typeof rec.note === 'string' && rec.note.trim() ? rec.note.trim() : undefined,
      });
    }
  }

  const cellOf = (v: unknown): GridPos | null => {
    if (Array.isArray(v) && isNum(v[0]) && isNum(v[1])) return { col: v[0], row: v[1] };
    if (v && typeof v === 'object' && isNum((v as { col?: unknown }).col) && isNum((v as { row?: unknown }).row)) {
      return { col: (v as GridPos).col, row: (v as GridPos).row };
    }
    return null;
  };
  // 起始位置：{"player_a": [3, 7], "player_b": {"col": 3, "row": 8}}
  const start: NonNullable<MapInfo['start']> = {};
  if (obj.start && typeof obj.start === 'object' && !Array.isArray(obj.start)) {
    for (const seat of ['player_a', 'player_b'] as const) {
      const c = cellOf((obj.start as Record<string, unknown>)[seat]);
      if (c) start[seat] = c;
    }
  }
  // 怪物出场格：{"goblin": [[12, 4], [9, 10]]}
  const spawns: NonNullable<MapInfo['spawns']> = {};
  if (obj.spawns && typeof obj.spawns === 'object' && !Array.isArray(obj.spawns)) {
    for (const [id, list] of Object.entries(obj.spawns as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const cells = list.map(cellOf).filter((c): c is GridPos => !!c);
      if (cells.length) spawns[id] = cells;
    }
  }

  return {
    standable,
    water,
    blocked,
    landmarks,
    wholeBoard: false,
    ...(Object.keys(start).length ? { start } : {}),
    ...(Object.keys(spawns).length ? { spawns } : {}),
  };
}

function parseScene(md: string, fallbackId: string): AdventureScene {
  const fm = frontmatter(md);
  const title = /^#\s+(.+)$/m.exec(md)?.[1]?.trim() ?? fm.title ?? fallbackId;
  return {
    id: fm.id ?? fallbackId,
    title,
    map: fm.map,
    mapInfo: parseMapInfo(md),
    readAloud: section(md, '读给玩家') || section(md, '读给玩家听'),
    publicNotes: section(md, '公开信息'),
    gmSecrets: section(md, 'GM 秘密') || section(md, 'GM秘密'),
    encounter: parseEncounter(section(md, '遭遇')),
    environment: parseEnvironment(section(md, '环境')),
    loot: parseLoot(section(md, '战利品')),
    beats: parseBeats(section(md, '节拍')),
    autoExit: parseExitRules(section(md, '自动出口')),
    exits: section(md, '出口') || section(md, '出口条件'),
    ending: /^(true|yes|1)$/i.test(fm.ending ?? ''),
  };
}

/** 从 vault 读剧本；没有就用内置的 same-name 冒险。读不到不抛错，返回内置并标记 source。 */
export function loadAdventure(campaignVault: string, adventureId: string): Adventure {
  const dir = join(campaignVault, 'adventures', adventureId);
  const overviewPath = join(dir, '00-overview.md');
  if (!existsSync(overviewPath)) {
    if (DEFAULT_ADVENTURE.id === adventureId) return { ...DEFAULT_ADVENTURE, source: 'builtin' };
    return { ...DEFAULT_ADVENTURE, source: 'builtin' };
  }
  const overview = readFileSync(overviewPath, 'utf8');
  const fm = frontmatter(overview);
  const scenesDir = join(dir, 'scenes');
  const scenes: AdventureScene[] = [];
  if (existsSync(scenesDir)) {
    for (const file of readdirSync(scenesDir).filter((f) => f.endsWith('.md')).sort()) {
      scenes.push(parseScene(readFileSync(join(scenesDir, file), 'utf8'), file.replace(/\.md$/, '')));
    }
  }
  if (!scenes.length) return { ...DEFAULT_ADVENTURE, source: 'builtin' };
  return {
    id: fm.id ?? adventureId,
    title: fm.title ?? /^#\s+(.+)$/m.exec(overview)?.[1]?.trim() ?? adventureId,
    overview: overview.replace(/^---[\s\S]*?---/, '').trim(),
    scenes,
    source: 'vault',
  };
}

/** 列出 vault 里可用的剧本 id（给 CLI / 文档用） */
export function listAdventures(campaignVault: string): string[] {
  return listDirs(join(campaignVault, 'adventures'));
}
