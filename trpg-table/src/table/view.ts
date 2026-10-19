import type { RulesEngine } from '../rules/engine.js';
import { ABILITY_ZH, CONDITION_ZH, SKILL_ZH, abilityMod, type Actor, type LegalAction, type MapInfo } from '../rules/types.js';
import { SPELLS } from '../rules/data/spells.js';
import { WEAPONS } from '../rules/data/weapons.js';
import { skillBonus } from '../rules/sheet.js';
import { describeFeatures } from '../rules/features/describe.js';
import { describeInventory } from '../rules/inventory.js';
import type { TablePhase } from './types.js';

export interface PlayerViewInput {
  engine: RulesEngine;
  /** 玩家角色的 actor id（等于座位 id） */
  selfId: string;
  visibleActorIds: ReadonlySet<string>;
  sceneTitle: string;
  phase: TablePhase;
  round: number;
  /** 回合计的一行（桌面第几轮、你是第几位、队友动过没有）；不填就不写 */
  roundLine?: string;
  /** 前几幕的前情和公开的世界事实（只含玩家知道的，见 CampaignMemory.playerBlock）；没有就不写 */
  memoryText?: string;
  gmNarration: string;
  publicEvents: string[];
  otherPlayerSays: string[];
  legalActions: LegalAction[];
  inCombat: boolean;
  turnNote?: string;
  /** 场景地图信息；不填就用 engine.mapInfo。 */
  mapInfo?: MapInfo | null;
}

export interface PlayerView {
  text: string;
  visibleActorIds: string[];
}

const HP_DESCRIPTOR = (hp: number, max: number): string => {
  if (hp <= 0) return '倒下了';
  const ratio = max > 0 ? hp / max : 0;
  if (ratio >= 0.99) return '看起来没事';
  if (ratio > 0.6) return '有点伤';
  if (ratio > 0.3) return '伤得很重';
  return '摇摇欲坠';
};

function conditionsText(actor: Actor): string {
  if (!actor.conditions.length) return '无';
  return actor.conditions
    .map((c) => (c.name === 'exhaustion' ? `力竭${c.level ?? 1}` : CONDITION_ZH[c.name]))
    .join('、');
}

/** 倒地的 PC 是什么状态：濒死（几成几败）/ 稳定 / 死亡。没倒地就是空串。 */
function dyingText(actor: Actor): string {
  if (actor.deathSaves.dead) return '已死亡';
  if (actor.kind !== 'pc' || actor.hp > 0) return '';
  return actor.deathSaves.stable ? '昏迷，已稳定' : `濒死（死亡豁免 ${actor.deathSaves.successes} 成 ${actor.deathSaves.failures} 败）`;
}

function characterCard(actor: Actor, engine: RulesEngine): string {
  const lines: string[] = [];
  lines.push(`【你的角色卡】${actor.name}，${actor.kind === 'pc' ? `等级 ${actor.level}${actor.charClass ? `，${actor.charClass}` : ''}` : '角色'}`);
  lines.push(
    `HP ${actor.hp}/${engine.maxHpOf(actor)}${actor.tempHp ? `（临时 ${actor.tempHp}）` : ''}，AC ${engine.acOf(actor)}，速度 ${engine.speedOf(actor)} 尺${dyingText(actor) ? `；${dyingText(actor)}` : ''}`
  );
  lines.push(
    ['str', 'dex', 'con', 'int', 'wis', 'cha']
      .map((a) => `${ABILITY_ZH[a as keyof typeof ABILITY_ZH]} ${actor.abilities[a as keyof Actor['abilities']]}（${signed(abilityMod(actor.abilities[a as keyof Actor['abilities']]))}）`)
      .join('，')
  );
  if (actor.saves.length) {
    lines.push(`豁免熟练：${actor.saves.map((s) => `${ABILITY_ZH[s]} ${signed(abilityMod(actor.abilities[s]) + actor.proficiencyBonus)}`).join('、')}`);
  }
  if (actor.skills.length) {
    lines.push(
      `技能：${actor.skills
        .map((s) => `${SKILL_ZH[s]} ${signed(skillBonus(actor, s))}${actor.expertise.includes(s) ? '（专精）' : ''}`)
        .join('、')}`
    );
  }
  const attacks = actor.attacks.map((a) => {
    const w = a.weaponId ? WEAPONS[a.weaponId] : undefined;
    const name = a.name ?? w?.name ?? '攻击';
    const math = engine.attackMath(actor, a);
    return `${name} ${signed(math.attackBonus)}，${math.damageFormula} ${math.damageType}`;
  });
  if (attacks.length) lines.push(`攻击：${attacks.join('；')}`);
  if (actor.spells) {
    const slots = Object.entries(actor.spells.slots)
      .map(([lvl, s]) => `${lvl} 环 ${s.max - s.used}/${s.max}`)
      .join('，');
    lines.push(
      `法术（${ABILITY_ZH[actor.spells.ability]}）：${actor.spells.known
        .map((id) => SPELLS[id]?.name ?? id)
        .join('、')}`
    );
    if (slots) lines.push(`法术位：${slots}`);
  }
  const feats = describeFeatures(actor);
  if (feats.usable.length) lines.push(`特性·要主动用（用法见下面「能做的事」）：${feats.usable.join('、')}`);
  if (feats.auto.length) lines.push(`特性·自动生效：${feats.auto.join('、')}`);
  if (feats.adjudicated.length) lines.push(`其它特性（GM 口头裁定，你知道自己有就行）：${feats.adjudicated.slice(0, 30).join('、')}`);
  lines.push(`状态：${conditionsText(actor)}`);
  const resources = Object.values(actor.resources);
  if (resources.length) {
    lines.push(`资源：${resources.map((r) => `${r.name} ${r.max - r.used}/${r.max}`).join('，')}`);
  }
  return lines.join('\n');
}

// 避免把引擎的 attackMath 逻辑复制一遍：直接用引擎的
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/**
 * 玩家视角：只包含公开信息。
 * - 怪物 HP 只给描述，不给数字；
 * - 隐藏 token、剧本秘密、别人的思维链都不进来；
 * - 这是玩家输入的**唯一**来源，测试会检查秘密不漏。
 */
export function buildPlayerView(input: PlayerViewInput): PlayerView {
  const { engine, selfId } = input;
  const self = engine.require(selfId);
  const lines: string[] = [];

  lines.push(`【场景】${input.sceneTitle}`);
  lines.push(
    `【局面】${input.inCombat ? `战斗中，第 ${input.round} 轮` : input.phase === 'social' ? '交谈中' : '探索中'}` +
      (input.turnNote ? `。${input.turnNote}` : '')
  );
  if (input.roundLine) lines.push(`【回合】${input.roundLine}`);
  if (input.memoryText) lines.push(`\n【前情（你们都记得的）】\n${input.memoryText}`);
  if (input.gmNarration) lines.push(`【GM 刚才说】\n${input.gmNarration}`);

  lines.push(`\n${characterCard(self, engine)}`);
  if (self.kind === 'pc') lines.push(`【你的背包】${describeInventory(self)}。背包里没有的东西，你就是没有——不要说自己用了、拿出了。`);

  lines.push(`\n【你自己的位置】${self.position ? engine.describeCell(self.position) : '规则层还没有记录位置'}`);

  const selfPos = self.position;
  const positionText = (actor: Actor): string => {
    if (!actor.position) return '，位置未知';
    const feet = selfPos ? engine.distanceFeet(selfPos, actor.position) : null;
    return `，位置：${engine.describeCell(actor.position)}${feet === null ? '' : `，距你 ${feet} 尺`}`;
  };

  const others: string[] = [];
  for (const actor of engine.actors.values()) {
    if (actor.id === selfId) continue;
    if (actor.kind === 'pc') {
      others.push(
        `- ${actor.name}（队友）：HP ${actor.hp}/${engine.maxHpOf(actor)}，AC ${engine.acOf(actor)}，状态：${conditionsText(actor)}${dyingText(actor) ? `，${dyingText(actor)}` : ''}${positionText(actor)}`
      );
      continue;
    }
    if (!input.visibleActorIds.has(actor.id)) continue;
    if (actor.hp <= 0 && actor.deathSaves.dead) continue;
    const kind = actor.kind === 'monster' ? '敌人/生物' : '人物';
    others.push(
      `- ${actor.name}（${kind}）：${HP_DESCRIPTOR(actor.hp, actor.maxHp)}，状态：${conditionsText(actor)}${positionText(actor)}`
    );
  }
  if (others.length) lines.push(`\n【你看到的其他人】\n${others.join('\n')}`);

  const map = input.mapInfo ?? engine.mapInfo;
  lines.push('\n【地标】');
  if (map?.standable.length) {
    const water = map.water.map((w) => w.name).join('、');
    lines.push(
      `可站立区域：${map.standable.map((s) => s.name).join('、')}${water ? `；水面：${water}（没有游泳速度不能站）` : ''}`
    );
  }
  if (map?.landmarks.length) {
    for (const lm of map.landmarks) {
      const note = lm.note ? `；${lm.note}` : '';
      lines.push(`- ${lm.name}：列 ${lm.cells.col[0]}–${lm.cells.col[1]}，行 ${lm.cells.row[0]}–${lm.cells.row[1]}${note}`);
    }
  } else {
    lines.push('- 这个场景没有标注地标。');
  }

  if (input.otherPlayerSays.length) {
    lines.push(`\n【队友说过的话（你只听到这些，不知道他在想什么）】\n${input.otherPlayerSays.map((s) => `- ${s}`).join('\n')}`);
  }

  if (input.publicEvents.length) {
    lines.push(`\n【最近发生】\n${input.publicEvents.map((e) => `- ${e}`).join('\n')}`);
  }

  // 法术很多的角色：攻击、特性、基本动作排在法术前面，免得被截断
  const KIND_ORDER = ['attack', 'feature', 'move', 'dash', 'dodge', 'disengage', 'hide', 'help', 'item', 'talk', 'check', 'other', 'cast'];
  const legal = input.legalActions
    .filter((a) => a.available)
    .map((a, i) => ({ a, i }))
    .sort((x, y) => KIND_ORDER.indexOf(x.a.kind) - KIND_ORDER.indexOf(y.a.kind) || x.i - y.i)
    .map((x) => x.a);
  if (legal.length) {
    lines.push(
      `\n【你现在能做的事（战斗中的行动必须从这里选）】\n${legal
        .slice(0, 80)
        .map((a) => `- [${a.cost}] ${a.name}：${a.detail}`)
        .join('\n')}`
    );
  }

  lines.push(
    '\n【记住】你只知道上面这些。不要编造你没看到的东西，不要提隐藏的怪物/陷阱/秘密，不要读队友的想法。'
  );

  return {
    text: lines.join('\n'),
    visibleActorIds: [...input.visibleActorIds],
  };
}

export function hpDescriptor(hp: number, max: number): string {
  return HP_DESCRIPTOR(hp, max);
}
