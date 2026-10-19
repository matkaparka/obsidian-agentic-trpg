import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RulesEngine, spawnMonster } from '../src/rules/engine.js';
import type { Actor, GridPos } from '../src/rules/types.js';
import { MONSTERS } from '../src/rules/data/monsters.js';
import { loadParty } from '../src/table/characters.js';
import { loadAdventure } from '../src/table/content.js';
import { loadConfig } from '../src/config.js';
import { FakeLLM } from '../src/llm/fake.js';
import { createLogs } from '../src/log.js';
import { LocalRollSource, mulberry32 } from '../src/rules/dice.js';
import { TableLoop } from '../src/table/loop.js';
import { projectRoot } from '../src/util.js';
import { ScriptedRollSource } from './helpers.js';

// 《通往凡达林的路》：剧本 + 地图信息的一致性检查。读的是 用户 的正式 vault，没有就跳过。
const VAULT = '../campaign-vault';
// 场景文件（.atlasmap）是用第三方地图做的，公开仓库里没有，要自己用 scripts/build_phandalin_maps.py 生成；缺了就跳过。
const has =
  existsSync(join(VAULT, 'adventures', 'phandalin-road', '00-overview.md')) &&
  existsSync(join(VAULT, 'scenes', 'phandalin-road.atlasmap'));

function reachable(engine: RulesEngine, actor: Actor, from: GridPos): Set<string> {
  const seen = new Set<string>([`${from.col},${from.row}`]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (!dc && !dr) continue;
        const next = { col: cur.col + dc, row: cur.row + dr };
        const key = `${next.col},${next.row}`;
        if (seen.has(key) || !engine.canStandAt(actor, next)) continue;
        // 斜着走不能从两个障碍的缝里穿过去
        if (dc && dr && !engine.canStandAt(actor, { col: cur.col + dc, row: cur.row }) && !engine.canStandAt(actor, { col: cur.col, row: cur.row + dr })) continue;
        seen.add(key);
        queue.push(next);
      }
    }
  }
  return seen;
}

describe.skipIf(!has)('《通往凡达林的路》', () => {
  const adventure = loadAdventure(VAULT, 'phandalin-road');
  const party = loadParty(VAULT);

  it('五幕，顺序对，最后一幕是结局，地图文件都在 vault 里', () => {
    expect(adventure.source).toBe('vault');
    expect(adventure.scenes.map((s) => s.id)).toEqual(['road-ambush', 'forest-camp', 'cave-mouth', 'water-hall', 'night-camp']);
    expect(adventure.scenes.map((s) => s.ending)).toEqual([false, false, false, false, true]);
    for (const s of adventure.scenes) {
      expect(s.map, s.id).toBeTruthy();
      expect(existsSync(join(VAULT, s.map!)), `${s.id} 的 ${s.map}`).toBe(true);
      expect(s.readAloud.length, `${s.id} 读给玩家`).toBeGreaterThan(40);
      expect(s.gmSecrets.length, `${s.id} GM 秘密`).toBeGreaterThan(40);
      expect(s.mapInfo?.wholeBoard, `${s.id} 地图信息没解析出来`).toBe(false);
    }
  });

  it('每张 atlasmap 引用的背景图存在，格子大小是整数像素', async () => {
    const { readFileSync } = await import('node:fs');
    for (const s of adventure.scenes) {
      const state = JSON.parse(readFileSync(join(VAULT, s.map!), 'utf8')).state;
      expect(existsSync(join(VAULT, state.background)), `${s.id} 背景 ${state.background}`).toBe(true);
      expect(Number.isInteger(state.grid.size), `${s.id} 格子大小`).toBe(true);
      expect(state.mapPath).toBe(s.map);
    }
  });

  for (const [index, scene] of adventure.scenes.entries()) {
    it(`第 ${index + 1} 幕「${scene.title}」：起始格 / 出场格合法，且互相走得通`, async () => {
      const engine = new RulesEngine({ rollSource: new ScriptedRollSource() });
      const { a, b } = loadParty(VAULT);
      engine.addActor(a);
      engine.addActor(b);
      engine.setMapInfo(scene.mapInfo);
      const start = scene.mapInfo!.start!;
      expect(start.player_a && start.player_b, '两个座位都要有起始格').toBeTruthy();
      expect(engine.placeParty().sort()).toEqual(['player_a', 'player_b']);
      expect(a.position).toEqual(start.player_a);
      expect(b.position).toEqual(start.player_b);

      const region = reachable(engine, a, a.position!);
      expect(region.has(`${b.position!.col},${b.position!.row}`), '两个起始格要连通').toBe(true);

      // 遭遇里的每种怪都要有够数的出场格，且都在同一片连通的地面上
      const spawned: Actor[] = [];
      for (const enc of scene.encounter) {
        expect(MONSTERS[enc.monsterId], `怪物 ${enc.monsterId} 不在 MONSTERS 里`).toBeDefined();
        for (let i = 0; i < enc.count; i++) {
          const m = spawnMonster(enc.monsterId, `${enc.monsterId}${i + 1}`);
          const cell = engine.spawnCellFor(m, enc.monsterId, i);
          expect(cell, `${scene.id}：${enc.monsterId} 第 ${i + 1} 个没有出场格`).not.toBeNull();
          expect(cell).toEqual(scene.mapInfo!.spawns![enc.monsterId][i]); // 没被挪动：写的格子本身就合法
          m.position = cell!;
          engine.addActor(m);
          spawned.push(m);
          expect(region.has(`${cell!.col},${cell!.row}`), `${scene.id}：${enc.monsterId}${i + 1} 的出场格 ${cell!.col},${cell!.row} 和玩家不连通`).toBe(true);
        }
      }

      // 地标至少有一格在能站的地面上（没有写在墙里）；所有地标名字不重复
      const names = new Set<string>();
      for (const lm of scene.mapInfo!.landmarks) {
        expect(names.has(lm.name), `${scene.id}：地标重名 ${lm.name}`).toBe(false);
        names.add(lm.name);
        let ok = false;
        for (let c = lm.cells.col[0]; c <= lm.cells.col[1] && !ok; c++) {
          for (let r = lm.cells.row[0]; r <= lm.cells.row[1] && !ok; r++) ok = engine.canStandAt(a, { col: c, row: r });
        }
        // 死马 / 倒木 / 帐篷这类障碍本身就站不了，不要求
        if (!/死马|倒木|帐|篝火|营火|大石|拴狼|铁笼|栏/.test(lm.name)) expect(ok, `${scene.id}：地标「${lm.name}」没有一格能站`).toBe(true);
      }

      // 能开战：先攻掷得出来，不抛错
      if (spawned.length) {
        const order = await engine.startCombat([a.id, b.id, ...spawned.map((m) => m.id)]);
        expect(order).toHaveLength(2 + spawned.length);
        engine.endCombat();
      }
    });
  }

  it('第三幕从洞口能一路走到向下的暗道，第四幕从上游洞口能走到铁笼和石室', () => {
    const engine = new RulesEngine({ rollSource: new ScriptedRollSource() });
    const { a, b } = loadParty(VAULT);
    engine.addActor(a);
    engine.addActor(b);
    const cave3 = adventure.scenes[2];
    engine.setMapInfo(cave3.mapInfo);
    engine.placeParty();
    const r3 = reachable(engine, a, a.position!);
    expect(r3.has('19,10') || r3.has('19,11'), '暗道（18-20, 10-11）').toBe(true);
    expect(r3.has('3,6') || r3.has('1,6'), '兽栏（1-5, 5-7）').toBe(true);
    expect(r3.has('17,5') || r3.has('18,5'), '石室（17-18, 4-6）').toBe(true);

    const cave4 = adventure.scenes[3];
    engine.setMapInfo(cave4.mapInfo);
    engine.placeParty();
    const r4 = reachable(engine, a, a.position!);
    expect(r4.has('2,7') || r4.has('3,7'), '铁笼所在的西洞').toBe(true);
    expect(r4.has('19,5') || r4.has('18,5'), '头目的石室').toBe(true);
    expect(r4.has('18,9') || r4.has('19,10'), '东南出水口').toBe(true);
  });

  it('TableLoop 开局把两个角色放到第一幕的起始格，换幕之后放到下一幕的起始格并清掉怪物', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trpg-phandalin-'));
    const config = loadConfig(projectRoot());
    config.paths.state = join(dir, 'state');
    config.paths.logs = join(dir, 'logs');
    config.table.pacing = { tThought: 0, tDecision: 0, tBetween: 0, tReact: 0, tScene: 0, tResolve: 0 };
    config.table.startPaused = true;
    expect(config.table.adventure).toBe('phandalin-road'); // 配置里已经切到这个剧本
    const logs = createLogs(dir);
    const { a, b } = loadParty(VAULT);
    const loop = new TableLoop({
      config,
      llm: new FakeLLM(config, logs),
      logs,
      adventure,
      characters: { player_a: a, player_b: b },
      rollSource: new LocalRollSource(mulberry32(7)),
      dryRun: true,
      resume: false,
    });
    await loop.init();
    const s0 = adventure.scenes[0].mapInfo!.start!;
    expect(loop.engine.get('player_a')!.position).toEqual(s0.player_a);
    expect(loop.engine.get('player_b')!.position).toEqual(s0.player_b);

    // 刷两个怪，再换幕
    const g = spawnMonster('goblin', '骨哨帮的哥布林');
    g.position = { col: 12, row: 5 };
    loop.engine.addActor(g);
    loop.requestSceneEnd('测试：直接换幕');
    await (loop as unknown as { applySceneEnd: () => Promise<void> }).applySceneEnd();
    const s1 = adventure.scenes[1].mapInfo!.start!;
    expect(loop.scene.id).toBe('forest-camp');
    expect(loop.engine.get('player_a')!.position).toEqual(s1.player_a);
    expect(loop.engine.get('player_b')!.position).toEqual(s1.player_b);
    // 上一幕的哥布林清掉了；第二幕标了 [可见] 的那只拴着的狼一进场就在场上（没进先攻）
    expect([...loop.engine.actors.values()].filter((x) => x.kind === 'monster').map((x) => x.name)).toEqual(['饿狼']);
    expect(loop.engine.combat.active).toBe(false);
  });
});