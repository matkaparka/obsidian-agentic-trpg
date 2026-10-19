import type { DieRoll, RollOutcome, RollRequest, RollSource } from '../rules/types.js';
import type { AtlasClient } from './client.js';

interface AtlasDice {
  die?: string;
  value?: number;
  max?: number;
  dropped?: boolean;
  negative?: boolean;
}

/**
 * 真实桌面：每一次掷骰都走 atlas_roll_dice（Atlas 在代码里掷、写进它自己的骰子日志、
 * 推 dice_rolled 事件）。引擎不再自己算。
 */
export class AtlasRollSource implements RollSource {
  readonly name = 'atlas';

  constructor(
    private readonly client: AtlasClient,
    private readonly tokenForActor?: (actorId: string) => string | undefined
  ) {}

  async roll(req: RollRequest): Promise<RollOutcome> {
    const tokenId = req.player ? this.tokenForActor?.(req.player) : undefined;
    const r = await this.client.callJson<{
      formula?: string;
      total?: number;
      dice?: AtlasDice[];
      modifiers?: number;
      logged?: boolean;
      writtenToAtlas?: boolean;
    }>('atlas_roll_dice', {
      formula: req.formula,
      label: req.label,
      ...(req.player ? { player: req.player } : {}),
      ...(tokenId ? { tokenId } : {}),
    });
    if (typeof r.total !== 'number') throw new Error('atlas_roll_dice 没有返回 total');
    const dice: DieRoll[] = (r.dice ?? []).map((d) => ({
      sides: Number(String(d.die ?? '').replace(/^d/i, '')) || Number(d.max) || 20,
      value: Number(d.value ?? 0),
      kept: !d.dropped && !d.negative,
    }));
    return {
      formula: r.formula ?? req.formula,
      dice,
      modifiers: r.modifiers ?? 0,
      total: r.total,
      source: this.name,
    };
  }
}
