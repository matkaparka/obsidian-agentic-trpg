// 给提示词用的特性清单：把角色的特性 id 按“引擎怎么处理”分成三组，名字取自构建器的特性目录。
//   主动：要玩家 / GM 用 action.type=feature 按下去（详细用法在“能做的事”里）
//   自动：引擎自动生效，附一句话说明
//   裁定：引擎不管，由 GM 口头裁定（玩家知道自己有就行）

import type { Actor } from '../types.js';
import { featureInfo } from '../build/catalog.js';
import { AUTO_FEATURES, ATTACK_OPTIONS, USABLE_FEATURES } from './registry.js';

export interface FeatureGroups {
  usable: string[];
  auto: string[];
  adjudicated: string[];
}

const ATTACK_OPTION_IDS = new Set(ATTACK_OPTIONS.map((o) => o.feature));

export const isUsableFeature = (id: string): boolean =>
  USABLE_FEATURES[id] !== undefined || id === 'channel_divinity' || id === 'channel_divinity_preserve_life';

export function featureName(id: string): string {
  const info = featureInfo(id);
  return info?.zh ?? info?.name ?? id;
}

export function describeFeatures(actor: Actor): FeatureGroups {
  const out: FeatureGroups = { usable: [], auto: [], adjudicated: [] };
  for (const id of actor.features ?? []) {
    if (isUsableFeature(id)) out.usable.push(featureName(id));
    else if (ATTACK_OPTION_IDS.has(id)) out.usable.push(`${featureName(id)}（攻击时声明）`);
    else if (AUTO_FEATURES[id]) out.auto.push(`${featureName(id)}（${AUTO_FEATURES[id]}）`);
    else out.adjudicated.push(featureName(id));
  }
  return out;
}
