import { describe, expect, it } from 'vitest';
import { AtlasSync } from '../src/atlas/sync.js';
import type { AtlasClient } from '../src/atlas/client.js';
import { RulesEngine, spawnMonster } from '../src/rules/engine.js';
import { makeDefaultParty } from '../src/rules/sheet.js';
import type { Actor } from '../src/rules/types.js';
import { ScriptedRollSource } from './helpers.js';
import { createLogs } from '../src/log.js';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function harness() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const tokens = [
    { id: 't1', name: '薇克丝', resources: { hp: { current: 24, max: 24 } }, conditions: [] },
    { id: 't2', name: '布拉姆', resources: { hp: { current: 24, max: 24 } }, conditions: [] },
    { id: 't3', name: '沙华鱼人1', resources: { hp: { current: 5, max: 22 } }, conditions: [] },
  ];
  const initiative = {
    entries: [
      { id: 'i1', tokenId: 't1', name: '薇克丝', initiative: 18 },
      { id: 'i2', tokenId: 't2', name: '布拉姆', initiative: 9 },
    ] as { id: string; tokenId?: string; name: string; initiative: number }[],
    currentIndex: 0,
  };
  const client = {
    async callJson(name: string, args: Record<string, unknown> = {}) {
      calls.push({ name, args });
      if (name === 'atlas_scene_summary') return { tokens: tokens.map((t) => ({ ...t })) };
      if (name === 'atlas_initiative') {
        if (args.action === 'next') initiative.currentIndex = (initiative.currentIndex + 1) % initiative.entries.length;
        if (args.action === 'prev') initiative.currentIndex = (initiative.currentIndex - 1 + initiative.entries.length) % initiative.entries.length;
        if (args.action === 'list') return initiative;
        return {};
      }
      if (name === 'atlas_add_token') return { id: 't_new' };
      if (name === 'atlas_remove_tokens') return { removed: (args.ids as string[]).map((id) => ({ id })) };
      return {};
    },
  } as unknown as AtlasClient;

  const engine = new RulesEngine({ rollSource: new ScriptedRollSource() });
  const { a, b } = makeDefaultParty();
  engine.addActor(a);
  engine.addActor(b);
  const logs = createLogs(mkdtempSync(join(tmpdir(), 'trpg-atlas-')));
  const sync = new AtlasSync(client, engine, logs, mkdtempSync(join(tmpdir(), 'trpg-vault-')));
  return { calls, sync, engine, a, b, tokens, initiative };
}

describe('AtlasSync', () => {
  it('写 HP 用正确的 token，并按单数 id 清状态', async () => {
    const { calls, sync, a } = harness();
    await sync.syncAll();
    calls.length = 0;
    await sync.syncActor(a);
    const setRes = calls.find((c) => c.name === 'atlas_set_token_resources');
    expect(setRes?.args.id).toBe('t1');
    expect((setRes?.args.resources as { hp: { current: number } }).hp.current).toBe(24);
    const clear = calls.find((c) => c.name === 'atlas_clear_conditions');
    expect(clear?.args.id).toBe('t1');
    expect(clear?.args).not.toHaveProperty('ids');
  });

  it('状态变化时写 atlas_set_condition，不变则跳过', async () => {
    const { calls, sync, a } = harness();
    await sync.syncAll();
    a.conditions.push({ name: 'prone' });
    calls.length = 0;
    await sync.syncActor(a);
    const set = calls.find((c) => c.name === 'atlas_set_condition');
    expect(set?.args).toMatchObject({ ids: ['t1'], conditionId: 'prone', active: true });

    calls.length = 0;
    await sync.syncActor(a);
    expect(calls.some((c) => c.name === 'atlas_set_condition')).toBe(false);
  });

  it('战斗开始：token 进先攻、写入规则层掷出的值、start', async () => {
    const { calls, sync } = harness();
    await sync.startCombat([
      { actorId: 'player_a', initiative: 18 },
      { actorId: 'player_b', initiative: 9 },
    ]);
    const actions = calls.filter((c) => c.name === 'atlas_initiative').map((c) => c.args.action);
    expect(actions).toContain('add_tokens');
    expect(actions).toContain('update');
    expect(actions).toContain('start');
    const update = calls.filter((c) => c.name === 'atlas_initiative' && c.args.action === 'update');
    expect(update.some((c) => (c.args.updates as { initiative: number }).initiative === 18)).toBe(true);
  });

  it('Atlas 先攻游标落后时，alignTurn 会走到规则层当前行动者', async () => {
    const { sync, engine, initiative } = harness();
    await sync.syncAll();
    engine.combat = {
      active: true,
      round: 1,
      order: [
        { actorId: 'player_a', initiative: 18, dex: 3 },
        { actorId: 'player_b', initiative: 9, dex: 1 },
      ],
      index: 1,
    };
    initiative.currentIndex = 0; // Atlas 还停在薇克丝（上一轮就是这个 bug）
    const r = await sync.alignTurn('player_b');
    expect(r.aligned).toBe(true);
    expect(initiative.currentIndex).toBe(1);
    expect(r.steps).toBe(1);
  });

  it('nextTurn 后 Atlas 游标与规则层当前行动者一致', async () => {
    const { sync, engine, initiative } = harness();
    await sync.syncAll();
    engine.combat = {
      active: true,
      round: 1,
      order: [
        { actorId: 'player_a', initiative: 18, dex: 3 },
        { actorId: 'player_b', initiative: 9, dex: 1 },
      ],
      index: 0,
    };
    initiative.currentIndex = 0;
    engine.nextTurn();
    await sync.nextTurn();
    expect(initiative.currentIndex).toBe(1);
    expect(initiative.entries[initiative.currentIndex].name).toBe(engine.currentActor()?.name);
  });

  it('清理上一场的怪物 token，但不碰 PC', async () => {
    const { calls, sync } = harness();
    await sync.cleanupOrphanMonsters();
    const rm = calls.find((c) => c.name === 'atlas_remove_tokens');
    expect(rm?.args.ids).toEqual(['t3']);
  });

  it('换场景后清空旧 token 映射，按名字重新找/补 token', async () => {
    const { calls, sync, a, tokens } = harness();
    await sync.syncAll();
    expect(sync.tokenId('player_a')).toBe('t1');

    // 新场景：只有布拉姆的新 token，薇克丝的不在了
    tokens.splice(0, tokens.length, { id: 't9', name: '布拉姆', resources: { hp: { current: 24, max: 24 } }, conditions: [] });
    await sync.openScene();
    expect(sync.tokenId('player_a')).toBeUndefined();
    expect(sync.tokenId('player_b')).toBe('t9');

    calls.length = 0;
    await sync.syncActor(a);
    expect(calls.some((c) => c.name === 'atlas_add_token')).toBe(true);
    const setRes = calls.find((c) => c.name === 'atlas_set_token_resources');
    expect(setRes?.args.id).toBe('t_new');
  });

  it('复用上一场同名 token 时，把它的位置校正到规则层位置', async () => {
    const { calls, sync, a, tokens } = harness();
    (tokens[0] as { cell?: { col: number; row: number } }).cell = { col: 9, row: 9 };
    a.position = { col: 2, row: 3 };
    calls.length = 0;
    await sync.syncAll();
    const move = calls.find((c) => c.name === 'atlas_move_token');
    expect(move?.args).toMatchObject({ id: 't1', cell: { col: 2, row: 3 } });
  });

  it('座位换了角色：按头像路径认出旧 token，改成新名字，不另补一个', async () => {
    const { calls, sync, engine, a, tokens } = harness();
    // 地图上留着上一个角色的 token（带这个座位的头像）
    (tokens[0] as { imagePath?: string }).imagePath = 'assets/tokens/faces/player_a-neutral.png';
    (tokens[1] as { imagePath?: string }).imagePath = 'assets/tokens/player_b.png';
    a.name = '维斯坡伊';
    engine.require('player_b').name = '萨珀特菲';
    calls.length = 0;
    await sync.syncAll();
    expect(sync.tokenId('player_a')).toBe('t1');
    expect(sync.tokenId('player_b')).toBe('t2');
    expect(calls.some((c) => c.name === 'atlas_add_token')).toBe(false);
    const renames = calls.filter((c) => c.name === 'atlas_update_token' && 'name' in (c.args.updates as object));
    expect(renames.map((c) => [c.args.id, (c.args.updates as { name: string }).name])).toEqual([
      ['t1', '维斯坡伊'],
      ['t2', '萨珀特菲'],
    ]);
    expect(sync.takeRenamed()).toBe(2); // 调用方据此重置先攻条
    expect(sync.takeRenamed()).toBe(0);
  });

  it('座位换了角色：头像不是这个座位的 token（比如别的座位或作者放的）不会被认走', async () => {
    const { calls, sync, a, tokens } = harness();
    (tokens[0] as { imagePath?: string }).imagePath = 'assets/tokens/player_b.png';
    (tokens[1] as { imagePath?: string }).imagePath = 'assets/tokens/player_b.png';
    a.name = '维斯坡伊';
    calls.length = 0;
    await sync.syncAll();
    expect(sync.tokenId('player_a')).toBe('t_new'); // 补了新的
    expect(calls.some((c) => c.name === 'atlas_add_token')).toBe(true);
  });

  it('规则层位置变了就 atlas_move_token', async () => {
    const { calls, sync, a } = harness();
    a.position = { col: 3, row: 3 };
    await sync.syncAll();
    a.position = { col: 7, row: 5 };
    calls.length = 0;
    const r = await sync.moveActor(a);
    expect(r.moved).toBe(true);
    const move = calls.find((c) => c.name === 'atlas_move_token');
    expect(move?.args).toMatchObject({ id: 't1', cell: { col: 7, row: 5 } });
    calls.length = 0;
    expect((await sync.moveActor(a)).moved).toBe(false); // 同一格不重复写
    expect(calls.some((c) => c.name === 'atlas_move_token')).toBe(false);
  });

  it('没揭示的怪物 token hidden=true，揭示后改回 false', async () => {
    const { calls, sync, engine } = harness();
    const goblin = spawnMonster('goblin', '地精3');
    goblin.position = { col: 9, row: 6 };
    engine.addActor(goblin);
    calls.length = 0;
    await sync.syncAll(new Set(['player_a', 'player_b']));
    const add = calls.find((c) => c.name === 'atlas_add_token' && (c.args as { name?: string }).name === '地精3');
    expect(add?.args).toMatchObject({ hidden: true, cell: { col: 9, row: 6 } });
    calls.length = 0;
    await sync.syncActor(goblin, new Set(['player_a', 'player_b', goblin.id]));
    const upd = calls.find((c) => c.name === 'atlas_update_token');
    expect(upd?.args).toMatchObject({ id: 't_new', updates: { isHidden: false } });
  });
});

describe('AtlasSync 怪物 token 图', () => {
  const imageOf = (vault: string, id: string): string => {
    const engine = new RulesEngine({ rollSource: new ScriptedRollSource() });
    const sync = new AtlasSync({} as AtlasClient, engine, createLogs(mkdtempSync(join(tmpdir(), 'trpg-atlas-'))), vault);
    return (sync as unknown as { imageFor(a: Actor): string }).imageFor({ id, kind: 'monster' } as Actor);
  };

  it('assets/tokens/<id>.png 优先，其次 assets/tokens/lmop/<id>.png，都没有才用通用 monster.png', () => {
    const vault = mkdtempSync(join(tmpdir(), 'trpg-vault-'));
    mkdirSync(join(vault, 'assets', 'tokens', 'lmop'), { recursive: true });
    writeFileSync(join(vault, 'assets', 'tokens', 'goblin.png'), 'x');
    writeFileSync(join(vault, 'assets', 'tokens', 'lmop', 'goblin.png'), 'x');
    writeFileSync(join(vault, 'assets', 'tokens', 'lmop', 'owlbear.png'), 'x');
    expect(imageOf(vault, 'goblin:1')).toBe('assets/tokens/goblin.png');
    expect(imageOf(vault, 'owlbear:2')).toBe('assets/tokens/lmop/owlbear.png');
    expect(imageOf(vault, 'swarm_of_rats:1')).toBe('assets/tokens/monster.png');
  });
});
