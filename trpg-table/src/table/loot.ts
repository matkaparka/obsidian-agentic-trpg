import { CP_PER_GP, CP_PER_SP, healFormulaIn, ITEM_KIND_ZH, type ItemKind } from '../rules/inventory.js';

/**
 * 剧本场景里的战利品清单：场景 md 的 `## 战利品`，一行一件：
 *   - 名字[ ×数量]｜类别｜说明｜在哪里 / 怎么拿到
 * 类别可省（消耗品 / 任务物品 / 财宝 / 杂物 / 武器 / 护甲），最后一栏永远是位置。
 * 钱写成 `- 碎银 9 gp｜红帐的战利品箱里`（名字里带「数字 + gp/sp/cp」就是钱）。
 * 说明里写「恢复 2d4+2」的消耗品，喝下就按这个公式回血。这份清单只给 GM 看（玩家不知道有什么），
 * GM 在玩家搜到、拿到之后才用 give_item / give_gold 发出去，loot_id 写清单里的 id，发过的会标「已发」。
 */
export interface LootEntry {
  id: string;
  name: string;
  qty: number;
  /** 钱：总铜币数（有它就是一笔钱，不是物品） */
  coinsCp?: number;
  kind: ItemKind;
  desc: string;
  /** 喝下恢复的骰子公式（从说明里读出来） */
  heal?: string;
  /** 单件价值（铜币），说明里写了「价值 5 gp」才有 */
  valueCp?: number;
  where: string;
}

const KIND_WORDS: Record<string, ItemKind> = {
  消耗品: 'consumable',
  药水: 'consumable',
  任务物品: 'quest',
  任务: 'quest',
  财宝: 'treasure',
  杂物: 'gear',
  装备: 'gear',
  武器: 'weapon',
  护甲: 'armor',
};

const UNIT: Record<string, number> = { gp: CP_PER_GP, sp: CP_PER_SP, cp: 1 };

export function parseLoot(raw: string): LootEntry[] {
  const out: LootEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*[-*]\s*(.+)$/.exec(line);
    if (!m) continue;
    const parts = m[1].split(/[|｜]/).map((s) => s.trim()).filter((s) => s !== '');
    if (!parts.length) continue;
    const head = parts[0];
    let rest = parts.slice(1);
    let kind: ItemKind | null = null;
    if (rest.length && KIND_WORDS[rest[0]]) {
      kind = KIND_WORDS[rest[0]];
      rest = rest.slice(1);
    }
    const where = rest.length ? rest[rest.length - 1] : '';
    const desc = rest.slice(0, -1).join('；');
    const id = `loot:${out.length + 1}`;

    const coin = /(\d+(?:\.\d+)?)\s*(gp|sp|cp)\b/i.exec(head);
    if (coin) {
      out.push({ id, name: head, qty: 1, coinsCp: Math.round(Number(coin[1]) * UNIT[coin[2].toLowerCase()]), kind: 'treasure', desc, where });
      continue;
    }
    const q = /^(.+?)\s*[×x*]\s*(\d{1,2})$/i.exec(head);
    const name = (q ? q[1] : head).trim();
    const qty = q ? Math.max(1, Number(q[2])) : 1;
    const heal = healFormulaIn(`${head} ${desc}`) ?? undefined;
    const worth = /价值\s*(\d+(?:\.\d+)?)\s*(gp|sp|cp)/i.exec(desc);
    out.push({
      id,
      name,
      qty,
      kind: kind ?? (heal ? 'consumable' : 'gear'),
      desc,
      ...(heal ? { heal } : {}),
      ...(worth ? { valueCp: Math.round(Number(worth[1]) * UNIT[worth[2].toLowerCase()]) } : {}),
      where,
    });
  }
  return out;
}

/** 给 GM 看的一行。taken = 已经发出去了。 */
export function lootLine(l: LootEntry, taken: boolean): string {
  const what = l.coinsCp !== undefined ? l.name : `${l.name}${l.qty > 1 ? ` ×${l.qty}` : ''}（${ITEM_KIND_ZH[l.kind]}${l.desc ? `，${l.desc}` : ''}）`;
  return `- [${l.id}] ${what}${l.where ? ` —— ${l.where}` : ''}${taken ? ' 【已发】' : ''}`;
}
