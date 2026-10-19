// 玩家行动层：要选模式的法术从 detail 里认选项；己方增益不写目标不会默认打到眼前的怪物上。
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createLogs } from '../src/log.js';
import { FakeLLM } from '../src/llm/fake.js';
import { LocalRollSource, mulberry32 } from '../src/rules/dice.js';
import { spawnMonster } from '../src/rules/engine.js';
import { loadAdventure } from '../src/table/content.js';
import { makeDefaultParty } from '../src/rules/sheet.js';
import { TableLoop } from '../src/table/loop.js';
import type { PlayerAction, PlayerDecision } from '../src/table/types.js';
import { projectRoot } from '../src/util.js';

async function makeLoop() {
  const root = projectRoot();
  const dir = mkdtempSync(join(tmpdir(), 'trpg-rollmod-'));
  const config = loadConfig(root);
  config.paths.state = join(dir, 'state');
  config.paths.logs = join(dir, 'logs');
  config.table.pacing = { tThought: 0, tDecision: 0, tBetween: 0, tReact: 0, tScene: 0, tResolve: 0 };
  config.table.startPaused = true;
  const logs = createLogs(dir);
  const party = makeDefaultParty();
  party.b.spells!.known.push('enhance_ability', 'pass_without_trace');
  const loop = new TableLoop({
    config,
    llm: new FakeLLM(config, logs),
    logs,
    adventure: loadAdventure(config.paths.campaignVault, 'crashed-ship'),
    characters: { player_a: party.a, player_b: party.b },
    rollSource: new LocalRollSource(mulberry32(7)),
    dryRun: true,
    resume: true,
  });
  await loop.init();
  party.a.position = { col: 10, row: 10 };
  party.b.position = { col: 11, row: 10 };
  const run = (seat: 'player_a' | 'player_b', action: PlayerAction) =>
    (loop as unknown as { executePlayerAction(seat: string, d: PlayerDecision): Promise<{ ok: boolean; summary: string; errors: string[] }> }).executePlayerAction(
      seat,
      { say: '', action, expression: 'neutral' } as unknown as PlayerDecision
    );
  return { loop, party, run };
}

describe('玩家施放要选模式的法术', () => {
  it('detail 里写了「熊之耐力」就按熊之耐力结算；只写法术名就被拒绝，法术位不扣', async () => {
    const { party, run } = await makeLoop();
    const bram = party.b;
    const refused = await run('player_b', { type: 'cast', target: '薇克丝', detail: '增强属性' });
    expect(refused.ok).toBe(false);
    expect(refused.errors.join('')).toContain('要先选一种');
    expect(bram.spells!.slots[2].used).toBe(0);

    const ok = await run('player_b', { type: 'cast', target: '薇克丝', detail: '增强属性：熊之耐力' });
    expect(ok.errors).toEqual([]);
    expect(ok.ok).toBe(true);
    expect(party.a.tempHp).toBeGreaterThan(0);
    expect(party.a.effects.some((e) => e.checkEdges?.some((c) => c.abilities?.includes('con')))).toBe(true);
    expect(bram.spells!.slots[2].used).toBe(1);
  });
});

describe('己方增益不写目标', () => {
  it('无痕步不写目标：两位玩家都吃到 +10 隐匿，眼前的地精没有', async () => {
    const { loop, party, run } = await makeLoop();
    const goblin = spawnMonster('goblin', '地精甲');
    goblin.position = { col: 12, row: 10 };
    loop.engine.addActor(goblin);
    loop.visibleActorIds.add(goblin.id);
    const r = await run('player_b', { type: 'cast', detail: '无痕步' });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(party.a.effects.some((e) => e.skillBonuses?.stealth === 10)).toBe(true);
    expect(party.b.effects.some((e) => e.skillBonuses?.stealth === 10)).toBe(true);
    expect(goblin.effects).toHaveLength(0);
  });
});
