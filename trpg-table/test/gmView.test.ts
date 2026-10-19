import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import type { LLM } from '../src/llm/index.js';
import { RulesEngine, spawnMonster } from '../src/rules/engine.js';
import { LocalRollSource, mulberry32 } from '../src/rules/dice.js';
import { makeDefaultParty } from '../src/rules/sheet.js';
import type { MapInfo } from '../src/rules/types.js';
import type { AdventureScene } from '../src/table/content.js';
import { GameMaster, type GmWorld } from '../src/table/gm.js';
import { RoundClock, parseEnvironment } from '../src/table/roundClock.js';
import { SceneProgress, parseBeats, parseExitRules } from '../src/table/sceneProgress.js';

const MAP: MapInfo = {
  standable: [{ name: '甲板', polygon: [[2.71, 2.14], [18.64, 3.5], [16.86, 12.29], [1.64, 11.0]] }],
  water: [{ name: '海面', polygon: [[0, 0], [20, 0], [20, 14.3], [0, 14.3]] }],
  blocked: [{ name: '货箱 A', cells: { col: [4, 5], row: [4, 5] } }],
  landmarks: [{ name: '货舱口', cells: { col: [5, 8], row: [7, 9] }, note: '半开的货舱口' }],
};

function scene(): AdventureScene {
  return {
    id: 'test',
    title: '测试甲板',
    mapInfo: MAP,
    readAloud: '',
    publicNotes: '',
    gmSecrets: 'GM_ONLY_SECRET',
    encounter: [],
    exits: '',
    ending: false,
  };
}

describe('GM 提示词里的玩家介绍', () => {
  it('按当前角色卡写名字、种族、职业，不再写死薇克丝 / 布拉姆', () => {
    const { a, b } = makeDefaultParty();
    a.name = '维斯坡伊';
    a.race = 'triton';
    a.charClass = '牧师（生命领域） 1';
    b.name = '萨珀特菲';
    b.race = 'tabaxi';
    b.charClass = '野蛮人 1';
    const world = { characters: { player_a: a, player_b: b } } as unknown as GmWorld;
    const config = { models: { seats: { player_a: { provider: 'deepseek' }, player_b: { provider: 'gemini' } } } } as unknown as AppConfig;
    const gm = new GameMaster(null as unknown as LLM, config, world);
    const text = (gm as unknown as { partyIntro: () => string }).partyIntro();
    expect(text).toBe('玩家有两个 AI：DeepSeek 控制的「维斯坡伊」（Triton 牧师（生命领域） 1）和 Gemini 控制的「萨珀特菲」（Tabaxi 野蛮人 1）。');
    expect(text).not.toContain('薇克丝');
    expect(text).not.toContain('布拉姆');
  });
});

describe('GM 视角的位置与地标', () => {
  it('列出所有角色（含隐藏怪物）的格子/地标描述和场景地标', () => {
    const engine = new RulesEngine({ rollSource: new LocalRollSource(mulberry32(1)) });
    const { a, b } = makeDefaultParty();
    a.position = { col: 4, row: 3 };
    b.position = { col: 6, row: 3 };
    engine.addActor(a);
    engine.addActor(b);
    engine.setMapInfo(MAP);
    const hidden = spawnMonster('goblin', '暗处的地精');
    hidden.position = { col: 7, row: 8 };
    engine.addActor(hidden);

    const clock = new RoundClock();
    clock.loadScene(parseEnvironment('- 暮色｜每 5 轮｜天色又暗了一档\n- 暗哨｜第 3 轮｜山上有人打手势 [秘密]'));
    clock.markActed('player_a');
    const progress = new SceneProgress();
    progress.loadScene(parseBeats('- camp｜进营地\n- trail｜找到东北小径'), parseExitRules('- 任一到达 trail 且 第 4 轮起｜找到了小径'));
    progress.markBeat('camp');
    const world = {
      engine,
      scene: scene(),
      visibleActorIds: new Set(['player_a', 'player_b']),
      clock,
      progress,
      characters: { player_a: a, player_b: b },
      expectedSeat: () => clock.nextSeat(),
    } as unknown as GmWorld;
    const gm = new GameMaster(null as unknown as LLM, {} as AppConfig, world);
    const text = (gm as unknown as { stateContext: () => string }).stateContext();

    // 回合计：GM 看得到第几轮、谁动过、下一位是谁，以及（含秘密的）环境条目什么时候到点
    expect(text).toContain('【回合计】桌面第 1 轮（探索）');
    expect(text).toContain(`${a.name}（player_a）已行动`);
    expect(text).toContain(`${b.name}（player_b）还没行动`);
    expect(text).toContain(`下一位：${b.name}`);
    expect(text).toContain('暮色（env:1）：每 5 轮，下次第 5 轮。天色又暗了一档');
    expect(text).toContain('暗哨（env:2，秘密）：第 3 轮，下次第 3 轮。山上有人打手势');

    // 本幕进度：节拍打勾情况和自动出口规则，GM 看得到
    expect(text).toContain('【本幕进度】');
    expect(text).toContain('节拍（1/2）');
    expect(text).toContain('[✓] camp：进营地');
    expect(text).toContain('[ ] trail：找到东北小径');
    expect(text).toContain('任一 PC 到达「trail」 且 这一幕走到第 4 轮：找到了小径');

    expect(text).toContain('【位置与地标】');
    expect(text).toContain('货舱口');
    expect(text).toContain('尺');
    expect(text).toContain('暗处的地精');
    expect(text).toContain('玩家看不见');
    expect(text).not.toContain('GM_ONLY_SECRET');
  });
});
