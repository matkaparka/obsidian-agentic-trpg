import { buildCharacter, type CharacterBuild } from '../rules/build/index.js';
import { applyCharacterFile, type LevelUpDelta } from '../rules/sheet.js';
import type { Actor } from '../rules/types.js';
import { MAX_LEVEL } from '../rules/xp.js';

export interface LevelUpOutcome extends LevelUpDelta {
  /** 构建器的提示（自动选了什么属性提升 / 法术），原样给日志 */
  warnings: string[];
}

/**
 * 把一个 PC 升一级：拿角色卡里的 build 规格，第一个职业的等级 +1，重新构建，再覆盖到正在玩的 Actor 上
 * （当前 HP、状态、法术位已用数这些保留，见 applyCharacterFile）。
 * 属性提升、新法术、子职业等没写进 build 的选择，由构建器按默认偏好自动选（职业主属性 +2；法术按偏好表补）。
 * build 里要是已经写了更高等级的选择（asi / spells），照写的来。
 * 失败（构建器报错、已满级）返回 null，Actor 原样不动。
 */
export function levelUpActor(actor: Actor, spec: CharacterBuild): { ok: true; outcome: LevelUpOutcome } | { ok: false; reason: string } {
  if (actor.level >= MAX_LEVEL) return { ok: false, reason: `${actor.name} 已经是 ${MAX_LEVEL} 级` };
  const build: CharacterBuild = JSON.parse(JSON.stringify(spec));
  if (!build.classes?.length) return { ok: false, reason: `${actor.name} 的 build 里没有职业` };
  const toLevel = actor.level + 1;
  const total = build.classes.reduce((s, c) => s + c.level, 0);
  // 规格的等级可能落后于正在玩的等级（存档里已经升过）：直接按 Actor 现在的等级 + 1 来
  build.classes[0].level += toLevel - total;
  const res = buildCharacter(build);
  if (res.errors.length) return { ok: false, reason: `构建 ${toLevel} 级失败：${res.errors.join('；')}` };
  const delta = applyCharacterFile(actor, res.file);
  return { ok: true, outcome: { ...delta, warnings: res.warnings } };
}
