import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { loadAdventure, parseMapInfo } from '../src/table/content.js';
import { projectRoot } from '../src/util.js';

describe('剧本里的地图信息', () => {
  it('真实 vault 的甲板场景解析出可站立区域、水面、障碍和地标', () => {
    const config = loadConfig(projectRoot());
    const adventure = loadAdventure(config.paths.campaignVault, 'crashed-ship');
    expect(adventure.source).toBe('vault');
    const deck = adventure.scenes.find((s) => s.id === 'wreck-deck');
    expect(deck).toBeTruthy();
    const info = deck!.mapInfo!;
    expect(info.wholeBoard).toBe(false);
    expect(info.standable[0].name).toBe('甲板');
    expect(info.standable[0].polygon).toEqual([
      [2.71, 2.14],
      [18.64, 3.5],
      [16.86, 12.29],
      [1.64, 11.0],
    ]);
    expect(info.water[0].name).toBe('海面');
    expect(info.blocked.map((b) => b.name)).toContain('货箱 A');
    expect(info.landmarks.map((l) => l.name)).toEqual(
      expect.arrayContaining(['货舱口', '桅杆', '货箱', '提灯/船尾', '左舷', '右舷'])
    );
    const hatch = info.landmarks.find((l) => l.name === '货舱口');
    expect(hatch?.cells).toEqual({ col: [5, 8], row: [7, 9] });
  });

  it('货舱和洞穴场景也带地图信息（水洼 / 水池）', () => {
    const config = loadConfig(projectRoot());
    const adventure = loadAdventure(config.paths.campaignVault, 'crashed-ship');
    const hold = adventure.scenes.find((s) => s.id === 'cargo-hold');
    expect(hold?.mapInfo?.water).toHaveLength(3);
    expect(hold?.mapInfo?.landmarks.map((l) => l.name)).toEqual(
      expect.arrayContaining(['钉死的门', '旧盔甲', '货箱', '水洼（东）'])
    );
    const cave = adventure.scenes.find((s) => s.id === 'shore-cave');
    expect(cave?.mapInfo?.water[0].name).toBe('水池');
    expect(cave?.mapInfo?.landmarks.map((l) => l.name)).toEqual(
      expect.arrayContaining(['祭坛', '水池', '洞口'])
    );
  });

  it('缺失/损坏的地图信息回退到整块棋盘，不抛错', () => {
    expect(parseMapInfo('# 没有地图信息')).toMatchObject({ wholeBoard: true, standable: [], landmarks: [] });
    expect(parseMapInfo('## 地图信息\n\n```json\n{ 这不是 JSON\n```')).toMatchObject({
      wholeBoard: true,
      standable: [],
      landmarks: [],
    });
    expect(parseMapInfo('## 地图信息\n\n```json\n{"standable":[]}\n```')).toMatchObject({ wholeBoard: true });

    const partial = parseMapInfo(
      '## 地图信息\n\n```json\n' +
        JSON.stringify({
          standable: [{ name: '地面', polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] }],
          landmarks: [{ name: '门', cells: { col: [1, 2], row: [3, 4] }, note: '钉死' }],
        }) +
        '\n```\n'
    );
    expect(partial.wholeBoard).toBe(false);
    expect(partial.landmarks[0]).toMatchObject({ name: '门', note: '钉死' });
  });
});
