import { describe, expect, it } from 'vitest';
import { RulesEngine, spawnMonster } from '../src/rules/engine.js';
import { makeDefaultParty } from '../src/rules/sheet.js';
import { LocalRollSource, mulberry32 } from '../src/rules/dice.js';
import { buildPlayerView } from '../src/table/view.js';
import type { AdventureScene } from '../src/table/content.js';

const SECRET = 'SECRET_RELIC_藏在货舱夹层里';

function scene(): AdventureScene {
  return {
    id: 'test',
    title: '测试甲板',
    mapInfo: {
      standable: [{ name: '甲板', kind: 'deck', polygon: [[0, 0], [20, 0], [20, 14.3], [0, 12]] }],
      water: [{ name: '海面', polygon: [[0, 0], [20, 0], [20, 20], [0, 20]] }],
      blocked: [],
      landmarks: [{ name: '货舱口', cells: { col: [5, 8], row: [7, 9] }, note: '半开的货舱口' }],
      wholeBoard: false,
    },
    readAloud: '风吹过甲板。',
    publicNotes: '甲板是湿的。',
    gmSecrets: `${SECRET}；怪物 HP 是 3，别告诉玩家。`,
    encounter: [{ monsterId: 'goblin', count: 1 }],
    exits: '',
    ending: false,
  };
}

function setup() {
  const engine = new RulesEngine({ rollSource: new LocalRollSource(mulberry32(1)) });
  const { a, b } = makeDefaultParty();
  a.position = { col: 4, row: 3 };
  b.position = { col: 6, row: 3 };
  engine.addActor(a);
  engine.addActor(b);
  engine.setMapInfo(scene().mapInfo);
  const visibleGoblin = spawnMonster('goblin', '看得见的地精');
  visibleGoblin.hp = 3;
  visibleGoblin.position = { col: 7, row: 7 };
  const hiddenGoblin = spawnMonster('goblin', '藏在暗处的地精');
  hiddenGoblin.position = { col: 9, row: 9 };
  engine.addActor(visibleGoblin);
  engine.addActor(hiddenGoblin);
  return { engine, visibleGoblin, hiddenGoblin };
}

describe('玩家视角不出秘密', () => {
  it('剧本秘密、隐藏 token、怪物精确 HP、队友思维链都不进玩家输入', () => {
    const { engine, visibleGoblin } = setup();
    const view = buildPlayerView({
      engine,
      selfId: 'player_a',
      visibleActorIds: new Set(['player_a', 'player_b', visibleGoblin.id]),
      sceneTitle: scene().title,
      phase: 'explore',
      round: 1,
      gmNarration: '甲板上只有你们两个。',
      publicEvents: ['你们看见一只地精'],
      otherPlayerSays: ['布拉姆说：「这船不对劲。」'],
      legalActions: engine.legalActions('player_a'),
      inCombat: false,
    });
    expect(view.text).not.toContain(SECRET);
    expect(view.text).not.toContain('藏在暗处的地精');
    expect(view.text).not.toContain(`${visibleGoblin.hp}/${visibleGoblin.maxHp}`);
    expect(view.text).toContain('看得见的地精');
    expect(view.text).toContain('伤得很重'); // 3/7
    expect(view.text).toContain('布拉姆说');
    // 玩家自己的 HP 是精确的
    expect(view.text).toContain('HP 24/24');
  });

  it('没被揭示的怪物完全不出现；揭示后才出现', () => {
    const { engine, hiddenGoblin } = setup();
    const v1 = buildPlayerView({
      engine,
      selfId: 'player_a',
      visibleActorIds: new Set(['player_a', 'player_b']),
      sceneTitle: '测试',
      phase: 'combat',
      round: 2,
      gmNarration: '',
      publicEvents: [],
      otherPlayerSays: [],
      legalActions: [],
      inCombat: true,
    });
    expect(v1.text).not.toContain('藏在暗处的地精');

    const v2 = buildPlayerView({
      engine,
      selfId: 'player_a',
      visibleActorIds: new Set(['player_a', 'player_b', hiddenGoblin.id]),
      sceneTitle: '测试',
      phase: 'combat',
      round: 2,
      gmNarration: '',
      publicEvents: [],
      otherPlayerSays: [],
      legalActions: [],
      inCombat: true,
    });
    expect(v2.text).toContain('藏在暗处的地精');
  });

  it('玩家视角有「自己的位置」「地标」和按尺写的距离，且不漏秘密', () => {
    const { engine } = setup();
    const view = buildPlayerView({
      engine,
      selfId: 'player_a',
      visibleActorIds: new Set(['player_a', 'player_b', engine.get('goblin:看得见的地精')!.id]),
      sceneTitle: scene().title,
      phase: 'explore',
      round: 1,
      gmNarration: '',
      publicEvents: [],
      otherPlayerSays: [],
      legalActions: engine.legalActions('player_a'),
      inCombat: false,
    });
    expect(view.text).toContain('【你自己的位置】');
    expect(view.text).toContain('【地标】');
    expect(view.text).toContain('货舱口');
    expect(view.text).toContain('距你');
    expect(view.text).toContain('尺');
    expect(view.text).toContain('看得见的地精');
    expect(view.text).not.toContain('藏在暗处的地精');
    expect(view.text).not.toContain(SECRET);
  });
});
