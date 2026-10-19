import type { SeatId } from '../config.js';
import type { GridPos } from '../rules/types.js';
import type { ActionType } from './player.js';
import type { RoundClockSnapshot } from './roundClock.js';
import type { CampaignMemorySnapshot } from './memory.js';
import type { SceneProgressSnapshot } from './sceneProgress.js';

export type SeatKey = 'player_a' | 'player_b';
export const PLAYER_SEATS: SeatKey[] = ['player_a', 'player_b'];

export type Expression = 'neutral' | 'happy' | 'smug' | 'angry' | 'scared' | 'surprised' | 'thinking' | 'hurt';

export const EXPRESSIONS: Expression[] = [
  'neutral',
  'happy',
  'smug',
  'angry',
  'scared',
  'surprised',
  'thinking',
  'hurt',
];

export interface PlayerAction {
  type: ActionType;
  target?: string;
  detail?: string;
  /** 移动/接近的目标格（方格坐标）；有它规则层才会真的移动 token。 */
  cell?: GridPos;
}

export interface PlayerDecision {
  say: string;
  action: PlayerAction;
  expression: Expression;
}

export interface ThoughtBeat {
  text: string;
  tag: string;
  score: number;
  /** 原文里逐字可查的片段，用来做依据校验 */
  quote: string;
}

export interface RendererOutput {
  beats: ThoughtBeat[];
  contrast: string | null;
  headline: string | null;
  /** 上屏的唯一一句第一人称心里话；不合格/没有就是 null（不出云朵）。 */
  bubble: string | null;
  /** bubble 的原文依据。 */
  bubbleQuote: string | null;
}

export interface RendererMeta {
  ok: boolean;
  latencyMs: number;
  reason?: string;
  droppedBeats: number;
  keywords: string[];
  bubbleReason?: string;
  bubbleRetried?: boolean;
}

export interface PlayerTurnResult {
  seat: SeatKey;
  decision: PlayerDecision;
  reasoning: string | null;
  reasoningKind: 'raw' | 'summary' | null;
  parseRetries: number;
  fallback: boolean;
  latencyMs: number;
  model: string;
  usage: { inputTokens: number; outputTokens: number; reasoningTokens?: number };
}

export interface TurnUsageRecord {
  seat: SeatId | 'gm' | 'renderer';
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface TurnRecord {
  id: string;
  at: number;
  seat: SeatKey;
  phase: TablePhase;
  round: number;
  sceneId: string;
  gmNarration: string;
  decision: PlayerDecision;
  reasoning: string | null;
  reasoningKind: 'raw' | 'summary' | null;
  renderer: RendererOutput | null;
  rendererMeta: RendererMeta | null;
  executed: { ok: boolean; summary: string; rolls: number; errors: string[] };
  beatsShown: number;
  latencyMs: number;
  usage: TurnUsageRecord[];
}

export type TablePhase = 'explore' | 'social' | 'combat' | 'ended';

export interface TranscriptEntry {
  at: number;
  kind: 'gm' | 'player' | 'event' | 'scene';
  seat?: SeatKey;
  text: string;
}

export interface TableSnapshot {
  version: 1;
  campaignVault: string;
  adventure: string;
  sceneId: string;
  sceneIndex: number;
  phase: TablePhase;
  round: number;
  turnSeat: SeatKey | null;
  history: TurnRecord[];
  transcript: TranscriptEntry[];
  summary: string;
  visibleActorIds: string[];
  sceneFlags: Record<string, unknown>;
  seq: number;
  updatedAt: number;
  rules: unknown;
  /** 回合计（第几轮、本轮谁行动过、环境条目的进度）；老存档没有，读档时从第 1 轮开始 */
  clock?: RoundClockSnapshot;
  /** 战役记忆（前情 + GM 登记的世界事实）；老存档没有，读档时从记录里尽量补 */
  memory?: CampaignMemorySnapshot;
  /** 已经发出去的战利品（`${场景 id}:${loot id}`） */
  lootTaken?: string[];
  /** 这一幕的进度：打了勾的节拍、已经满足正在等收尾的出口 */
  progress?: SceneProgressSnapshot;
}
