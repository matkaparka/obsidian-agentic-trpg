import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import type { LLM } from '../src/llm/index.js';
import { RulesEngine } from '../src/rules/engine.js';
import { makeDefaultParty } from '../src/rules/sheet.js';
import { parseMapInfo } from '../src/table/content.js';
import { GameMaster, type GmWorld } from '../src/table/gm.js';
import { ScriptedRollSource } from './helpers.js';

const MD = `## 地图信息

\`\`\`json
{
  "standable": [{ "name": "林地", "polygon": [[0, 0], [17, 0], [17, 12.75], [0, 12.75]] }],
  "blocked": [{ "name": "死马", "cells": { "col": [8, 9], "row": [7, 8] } }],
  "landmarks": [],
  "start": { "player_a": [3, 7], "player_b": { "col": 3, "row": 8 } },
  "spawns": { "goblin": [[12, 4], [9, 10]], "wolf": [[8, 8]] }
}
\`\`\`
`;

function setup() {
  const engine = new RulesEngine({ rollSource: new ScriptedRollSource() });
  const { a, b } = makeDefaultParty();
  a.position = { col: 15, row: 1 };
  b.position = { col: 16, row: 1 };
  engine.addActor(a);
  engine.addActor(b);
  engine.setMapInfo(parseMapInfo(MD));
  return { engine, a, b };
}

describe('场景地图信息：起始位置和怪物出场格', () => {
  it('从剧本 markdown 读出 start 和 spawns（数组和 {col,row} 两种写法都行）', () => {
    const info = parseMapInfo(MD);
    expect(info.start).toEqual({ player_a: { col: 3, row: 7 }, player_b: { col: 3, row: 8 } });
    expect(info.spawns).toEqual({ goblin: [{ col: 12, row: 4 }, { col: 9, row: 10 }], wolf: [{ col: 8, row: 8 }] });
    // 没写就没有这两项，老剧本不受影响
    expect(parseMapInfo(MD.replace(/"start"[\s\S]*"wolf": \[\[8, 8\]\] \}/, '"x": 1')).start).toBeUndefined();
  });

  it('placeParty：把 PC 放到起始格；起始格是障碍就挪到最近的合法格；没写 start 的地图不动', () => {
    const { engine, a, b } = setup();
    expect(engine.placeParty().sort()).toEqual(['player_a', 'player_b']);
    expect(a.position).toEqual({ col: 3, row: 7 });
    expect(b.position).toEqual({ col: 3, row: 8 });
    expect(engine.placeParty()).toEqual([]); // 已经在位，不重复报告

    // 起始格落在死马（blocked）上：挪到旁边合法格
    engine.setMapInfo({ ...parseMapInfo(MD), start: { player_a: { col: 8, row: 7 } } });
    expect(engine.placeParty()).toEqual(['player_a']);
    expect(engine.canStandAt(a, a.position!)).toBe(true);
    expect(engine.distanceCells(a.position!, { col: 8, row: 7 })).toBeLessThanOrEqual(2);

    // 不带 start 的地图：谁也不动
    engine.setMapInfo({ ...parseMapInfo(MD), start: undefined });
    const before = { ...b.position! };
    expect(engine.placeParty()).toEqual([]);
    expect(b.position).toEqual(before);
  });

  it('spawnCellFor：按生成顺序取出场格，不合法的挪开，没写的返回 null', () => {
    const { engine } = setup();
    const g = { ...makeDefaultParty().a, id: 'g1', kind: 'monster' as const, seat: undefined, position: undefined };
    expect(engine.spawnCellFor(g, 'goblin', 0)).toEqual({ col: 12, row: 4 });
    expect(engine.spawnCellFor(g, 'goblin', 1)).toEqual({ col: 9, row: 10 });
    expect(engine.spawnCellFor(g, 'goblin', 2)).toBeNull();
    expect(engine.spawnCellFor(g, 'ogre', 0)).toBeNull();
    // 狼的出场格 (8,8) 是死马：挪到旁边合法格
    const w = engine.spawnCellFor(g, 'wolf', 0)!;
    expect(engine.canStandAt(g, w)).toBe(true);
    expect(engine.distanceCells(w, { col: 8, row: 8 })).toBeLessThanOrEqual(2);
  });

  it('GM 的 start_combat：怪物站到地图信息写的出场格上，没写的怪物用老的默认格', async () => {
    const { engine } = setup();
    const published: string[] = [];
    const world = {
      engine,
      visibleActorIds: new Set<string>(),
      transcript: [] as unknown[],
      setPhase: () => undefined,
      bus: { publish: (_k: string, text: string) => published.push(text) },
    } as unknown as GmWorld;
    const gm = new GameMaster(null as unknown as LLM, {} as AppConfig, world);
    const out = await (gm as unknown as { execTool: (n: string, a: Record<string, unknown>) => Promise<{ ok: boolean }> }).execTool('start_combat', {
      monsters: [{ monster_id: 'goblin', count: 2 }, { monster_id: 'skeleton', count: 1 }],
    });
    expect(out.ok).toBe(true);
    const goblins = [...engine.actors.values()].filter((x) => x.id.startsWith('goblin:'));
    expect(goblins.map((x) => x.position)).toEqual([{ col: 12, row: 4 }, { col: 9, row: 10 }]);
    const skeleton = [...engine.actors.values()].find((x) => x.id.startsWith('skeleton:'))!;
    expect(skeleton.position).toEqual({ col: 10, row: 7 }); // 没写出场格：8 + 已生成的 2 个
  });
});
