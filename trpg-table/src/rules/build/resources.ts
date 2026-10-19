// 次数型资源（CharacterFile.resources）。key 和 recharge 用 contract.ts 的 RESOURCE_SPECS，max 按职业等级和属性算。
import { RESOURCE_SPECS } from '../contract.js';
import type { CharacterFile } from '../sheet.js';
import { activeSubclass, classLevel, mod, type Ctx } from './ctx.js';

type Resources = NonNullable<CharacterFile['resources']>;

/** 引擎里「无限次」就用一个很大的数。 */
export const UNLIMITED = 99;

export function computeResources(ctx: Ctx): Resources {
  const out: Resources = {};
  const put = (key: string, max: number, recharge?: 'short' | 'long' | 'none', name?: string): void => {
    if (max <= 0) return;
    const spec = RESOURCE_SPECS[key];
    const base = out[key];
    out[key] = { name: name ?? spec?.name ?? key, max: (base?.max ?? 0) + max, used: 0, recharge: recharge ?? spec?.recharge ?? 'long' };
  };

  const lv = (id: string): number => classLevel(ctx, id);

  // 战士
  if (lv('fighter') >= 1) put('second_wind', 1);
  if (lv('fighter') >= 2) put('action_surge', lv('fighter') >= 17 ? 2 : 1);
  if (lv('fighter') >= 9) put('indomitable', lv('fighter') >= 17 ? 3 : lv('fighter') >= 13 ? 2 : 1);
  const bm = ctx.classes.find((c) => c.def.id === 'fighter' && activeSubclass(c)?.id === 'battle_master');
  if (bm) put('superiority_dice', bm.level >= 15 ? 6 : bm.level >= 7 ? 5 : 4);

  // 野蛮人：狂暴 2/3/4/5/6/无限
  const barb = lv('barbarian');
  if (barb >= 1) put('rage', barb >= 20 ? UNLIMITED : barb >= 17 ? 6 : barb >= 12 ? 5 : barb >= 6 ? 4 : barb >= 3 ? 3 : 2);

  // 武僧：气 = 武僧等级（2 级起）
  if (lv('monk') >= 2) put('ki', lv('monk'));
  const oh = ctx.classes.find((c) => c.def.id === 'monk' && activeSubclass(c)?.id === 'open_hand');
  if (oh && oh.level >= 6) put('wholeness_of_body', 1);

  // 诗人：魅力调整值至少 1，5 级起短休恢复
  const bard = lv('bard');
  if (bard >= 1) put('bardic_inspiration', Math.max(1, mod(ctx, 'cha')), bard >= 5 ? 'short' : 'long');

  // 牧师 1/2/3 次、圣武士 1 次
  let cd = 0;
  const cleric = lv('cleric');
  if (cleric >= 2) cd += cleric >= 18 ? 3 : cleric >= 6 ? 2 : 1;
  if (lv('paladin') >= 3) cd += 1;
  if (cd > 0) put('channel_divinity', cd);

  // 圣武士
  const pal = lv('paladin');
  if (pal >= 1) {
    put('lay_on_hands', pal * 5);
    put('divine_sense', Math.max(1, 1 + mod(ctx, 'cha')));
  }
  if (pal >= 14) put('cleansing_touch', Math.max(1, mod(ctx, 'cha')));

  // 术士：术法点
  if (lv('sorcerer') >= 2) put('sorcery_points', lv('sorcerer'));

  // 德鲁伊
  const dr = lv('druid');
  if (dr >= 2) put('wild_shape', dr >= 20 ? UNLIMITED : 2);
  const land = ctx.classes.find((c) => c.def.id === 'druid' && activeSubclass(c)?.id === 'land');
  if (land && land.level >= 2) put('natural_recovery', 1);

  // 法师：奥术回复
  if (lv('wizard') >= 1) put('arcane_recovery', 1);

  // 盗贼 20：幸运一击
  if (lv('rogue') >= 20) put('stroke_of_luck', 1);

  // 邪术师宗主（邪魔）
  const fiend = ctx.classes.find((c) => c.def.id === 'warlock' && activeSubclass(c)?.id === 'fiend');
  if (fiend && fiend.level >= 6) put('dark_ones_own_luck', 1);
  if (fiend && fiend.level >= 14) put('hurl_through_hell', 1);

  // 种族
  for (const r of ctx.race.resources ?? []) if (ctx.totalLevel >= (r.minLevel ?? 1)) put(r.key, r.max);
  // 专长
  for (const f of ctx.feats) if (f.def.resource) put(f.def.resource.key, f.def.resource.max, f.def.resource.recharge);
  return out;
}
