import type { Actor } from './types.js';

/**
 * 背包和金币。以前运行时完全没有：GM 说「你找到一小袋碎银」只是一句旁白，规则层没有物品栏，`item` 行动也没有结算。
 * 现在每个 PC 有 `inventory`（物品堆）和 `coinsCp`（铜币总数，1 gp = 100 cp），进存档，GM 用工具给 / 收，玩家能用。
 * 纯函数，只改传进来的 Actor，不碰引擎，可以单独测。
 */

export const ITEM_KINDS = ['consumable', 'treasure', 'quest', 'gear', 'weapon', 'armor'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_KIND_ZH: Record<ItemKind, string> = {
  consumable: '消耗品',
  treasure: '财宝',
  quest: '任务物品',
  gear: '杂物',
  weapon: '武器',
  armor: '护甲',
};

/** 物品用掉时的规则效果。没有 use = 没有规则效果，用它是 GM 裁定的叙事。 */
export interface ItemUse {
  /** 恢复生命：骰子公式，如 2d4+2 */
  heal?: string;
  /** 没有数值效果但用掉就没了（火把、毒药涂剂…）：写给 GM 看的一句话 */
  note?: string;
}

export interface ItemStack {
  name: string;
  qty: number;
  kind: ItemKind;
  desc?: string;
  /** 单件价值（铜币）；不知道就不写 */
  valueCp?: number;
  use?: ItemUse;
}

export type NewItem = Omit<ItemStack, 'qty'> & { qty?: number };

export const CP_PER_GP = 100;
export const CP_PER_SP = 10;
export const MAX_STACK = 99;
export const MAX_GOLD_PER_CALL_GP = 10000;

/** 一个骰子公式：2d4+2、1d8、4d4-1。 */
export const DICE_FORMULA = /^\d{1,2}d\d{1,3}(?:\s*[+-]\s*\d{1,3})?$/i;

/** 从一段话里找出治疗骰子公式（「恢复 2d4+2 HP」）。 */
export function healFormulaIn(text: string): string | null {
  const m = /(?:恢复|回复|治疗)\s*(\d{1,2}d\d{1,3}(?:\s*[+-]\s*\d{1,3})?)/i.exec(text);
  return m ? m[1].replace(/\s+/g, '') : null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '');

export function inventoryOf(actor: Actor): ItemStack[] {
  if (!actor.inventory) actor.inventory = [];
  return actor.inventory;
}

/** 按名字找：先全等，再互相包含（玩家写「喝治疗药水」、物品叫「治疗药水」）。 */
export function findItem(items: readonly ItemStack[], ref: string): ItemStack | null {
  const want = norm(ref);
  if (!want) return null;
  return (
    items.find((i) => norm(i.name) === want) ??
    items.find((i) => norm(i.name).includes(want) || want.includes(norm(i.name))) ??
    null
  );
}

/** 加物品：同名同类的合并数量，上限 99。返回合并后的那一堆。 */
export function addItem(actor: Actor, item: NewItem): ItemStack {
  const inv = inventoryOf(actor);
  const qty = Math.max(1, Math.min(MAX_STACK, Math.floor(item.qty ?? 1)));
  const existing = inv.find((i) => norm(i.name) === norm(item.name) && i.kind === item.kind);
  if (existing) {
    existing.qty = Math.min(MAX_STACK, existing.qty + qty);
    if (item.desc && !existing.desc) existing.desc = item.desc;
    if (item.use && !existing.use) existing.use = item.use;
    return existing;
  }
  const stack: ItemStack = { name: item.name.trim(), qty, kind: item.kind, ...(item.desc ? { desc: item.desc } : {}), ...(item.valueCp ? { valueCp: item.valueCp } : {}), ...(item.use ? { use: item.use } : {}) };
  inv.push(stack);
  return stack;
}

/** 拿走（扔掉 / 用掉 / 被抢）。数量不够返回 null，不动背包。 */
export function removeItem(actor: Actor, ref: string, qty = 1): { item: ItemStack; left: number } | null {
  const inv = inventoryOf(actor);
  const stack = findItem(inv, ref);
  const n = Math.max(1, Math.floor(qty));
  if (!stack || stack.qty < n) return null;
  stack.qty -= n;
  const item = { ...stack, qty: n };
  if (stack.qty <= 0) inv.splice(inv.indexOf(stack), 1);
  return { item, left: Math.max(0, stack.qty) };
}

/** gp / sp / cp 三个数合成铜币（可以带小数，如 0.5 gp）。 */
export function coinsFrom(parts: { gp?: number; sp?: number; cp?: number }): number {
  const total = (parts.gp ?? 0) * CP_PER_GP + (parts.sp ?? 0) * CP_PER_SP + (parts.cp ?? 0);
  return Math.round(total);
}

export function coinsOf(actor: Actor): number {
  return actor.coinsCp ?? 0;
}

export function addCoins(actor: Actor, cp: number): number {
  actor.coinsCp = Math.max(0, coinsOf(actor) + Math.floor(cp));
  return actor.coinsCp;
}

/** 付钱。不够返回 false，不动。 */
export function spendCoins(actor: Actor, cp: number): boolean {
  const n = Math.floor(cp);
  if (n < 0 || coinsOf(actor) < n) return false;
  actor.coinsCp = coinsOf(actor) - n;
  return true;
}

/** 铜币总数 → 「9 gp 3 sp」。0 就是「没有钱」。 */
export function formatCoins(cp: number): string {
  const n = Math.max(0, Math.floor(cp));
  if (n === 0) return '没有钱';
  const gp = Math.floor(n / CP_PER_GP);
  const sp = Math.floor((n % CP_PER_GP) / CP_PER_SP);
  const c = n % CP_PER_SP;
  return [gp ? `${gp} gp` : '', sp ? `${sp} sp` : '', c ? `${c} cp` : ''].filter(Boolean).join(' ');
}

/** 一堆物品的一行：「治疗药水 ×2（恢复 2d4+2）」。 */
export function itemLine(i: ItemStack, withKind = false): string {
  const bits = [i.desc, withKind && i.kind !== 'gear' ? ITEM_KIND_ZH[i.kind] : '', i.use?.heal ? `喝下恢复 ${i.use.heal}` : '', i.use?.note].filter(Boolean);
  return `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}${bits.length ? `（${bits.join('，')}）` : ''}`;
}

/** 整个背包的描述（给提示词用）。 */
export function describeInventory(actor: Actor, opts: { withKind?: boolean } = {}): string {
  const inv = actor.inventory ?? [];
  const coins = formatCoins(coinsOf(actor));
  return `金币：${coins}；物品：${inv.length ? inv.map((i) => itemLine(i, opts.withKind)).join('、') : '（空）'}`;
}

/** 给 overlay 面板的一小条：「9 gp 3 sp」；没钱就是空串。 */
export function coinChip(actor: Actor): string {
  const cp = coinsOf(actor);
  return cp > 0 ? formatCoins(cp) : '';
}
