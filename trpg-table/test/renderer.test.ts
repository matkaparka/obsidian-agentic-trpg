import { describe, expect, it } from 'vitest';
import { parseRendererJson, validateRendererOutput } from '../src/table/renderer.js';

const reasoning =
  '我盯着那只箱子，先别让她看见。要是她问起来，就说我去探路。其实我根本不想分她一半，真打起来我先躲。';

function out(beats: unknown[], contrast: unknown = null, headline: unknown = null) {
  return { beats, contrast, headline };
}

describe('renderer 依据校验', () => {
  it('quote 在原文里逐字存在才保留', () => {
    const r = validateRendererOutput(
      out([
        { text: '这箱子得先到手', tag: '贪心', score: 9, quote: '先别让她看见' },
        { text: '我编的', tag: '算计', score: 8, quote: '原文里没有这句话' },
      ]),
      reasoning
    );
    expect(r.output.beats).toHaveLength(1);
    expect(r.output.beats[0].text).toBe('这箱子得先到手');
    expect(r.dropped).toBe(1);
  });

  it('最多 3 条，按分数排序，text 裁剪到 30 字', () => {
    const beats = Array.from({ length: 5 }, (_, i) => ({
      text: `第${i}条` + '很长的想法'.repeat(10),
      tag: '计划',
      score: i,
      quote: '先别让她看见',
    }));
    const r = validateRendererOutput(out(beats), reasoning);
    expect(r.output.beats).toHaveLength(3);
    expect(r.output.beats[0].score).toBe(4);
    for (const b of r.output.beats) expect([...b.text].length).toBeLessThanOrEqual(31);
  });

  it('网址、长数字、现实政治话题会挡掉；headline 裁剪到 16 字', () => {
    const bad = validateRendererOutput(
      out([{ text: '看 https://example.com', tag: '计划', score: 9, quote: '先别让她看见' }], null, '台湾属于中国'),
      reasoning
    );
    expect(bad.output.beats).toHaveLength(0);
    expect(bad.output.headline).toBeNull();

    const good = validateRendererOutput(
      out([{ text: '她不知道我的算盘', tag: '算计', score: 8, quote: '先别让她看见' }], '嘴上说探路，心里想独吞', '她想独吞'),
      reasoning
    );
    expect(good.output.headline).toBe('她想独吞');
    expect(good.output.contrast).toContain('独吞');
  });

  it('一条 beat 的 tag/score 写歪了，只丢这一条，不影响其余 beat 和 bubble', () => {
    const r = validateRendererOutput(
      {
        beats: [
          { text: '先别让她看见', tag: '自嘲', score: '8', quote: '先别让她看见' },
          { text: '真打起来我先躲', tag: '恐惧', score: '7', quote: '真打起来我先躲' },
          'not an object',
        ],
        bubble: '真打起来我先躲。',
        bubbleQuote: '真打起来我先躲',
        contrast: { not: 'a string' },
        headline: null,
      },
      reasoning,
      { name: '布拉姆' }
    );
    expect(r.output.beats).toHaveLength(1);
    expect(r.output.beats[0].score).toBe(7);
    expect(r.output.bubble).toBe('真打起来我先躲。');
    expect(r.output.contrast).toBeNull();
    expect(r.dropped).toBe(2);
  });

  it('坏 JSON / 空返回不抛错', () => {
    expect(parseRendererJson('not json')).toBeNull();
    expect(validateRendererOutput(null, reasoning).output.beats).toHaveLength(0);
  });

  it('把「选表情」这类格式思考当成心里话的 beat 会被丢掉', () => {
    const withMeta =
      reasoning +
      '被咬了一口，hurt 更合适，但嘴上带刺是 angry。expression 该填什么？选 angry。我需要以薇克丝的身份输出 JSON。';
    const r = validateRendererOutput(
      out([
        { text: '明明疼得龇牙，偏要摆出凶相', tag: '算计', score: 9, quote: '选 angry' },
        { text: '我需要以薇克丝的身份回答', tag: '计划', score: 8, quote: '我需要以薇克丝的身份输出 JSON' },
        { text: '这箱子得先到手', tag: '贪心', score: 7, quote: '先别让她看见' },
      ]),
      withMeta
    );
    expect(r.output.beats.map((b) => b.text)).toEqual(['这箱子得先到手']);
    expect(r.dropped).toBe(2);
  });

  it('meta 内容也不会变成 headline / contrast', () => {
    const withMeta = reasoning + '输出格式要 JSON，expression 选 smug。';
    const r = validateRendererOutput(
      out([], 'expression 选 smug，这样更合适', '选 expression'),
      withMeta
    );
    expect(r.output.contrast).toBeNull();
    expect(r.output.headline).toBeNull();
  });

  it('正常的英文思考（I am thinking about the lock）不会被当格式丢掉', () => {
    const english = 'I am thinking about the lock. The rogue wants the chest for herself and would lie to the cleric.';
    const r = validateRendererOutput(
      out([{ text: '我想独吞那只箱子', tag: '贪心', score: 9, quote: 'wants the chest for herself' }]),
      english
    );
    expect(r.output.beats).toHaveLength(1);
  });
});

describe('bubble 第一人称校验（V2）', () => {
  const reasoning2 =
    '我盯着那只箱子，先别让她看见。要是她问起来，就说我去探路。其实我根本不想分她一半，真打起来我先躲。这锈罐子要是动一下我就跑。';
  const base = (bubble: unknown, quote: unknown = '先别让她看见') => ({
    beats: [],
    contrast: null,
    headline: null,
    bubble,
    bubbleQuote: quote,
  });
  const check = (bubble: unknown, quote: unknown = '先别让她看见', name = '薇克丝', aliases: string[] = ['Vex', 'Vix']) =>
    validateRendererOutput(base(bubble, quote), reasoning2, { name, aliases });

  it('合格的第一人称心里话保留', () => {
    const r = check('这锈罐子要是动一下我就跑。', '这锈罐子要是动一下我就跑');
    expect(r.output.bubble).toBe('这锈罐子要是动一下我就跑。');
    expect(r.output.bubbleQuote).toContain('这锈罐子');
  });

  it('真实反例：自己的名字 / 第三人称标签 / 用他指代自己 都不合格', () => {
    expect(check('布拉姆老是这样，永远挑最稳的打法', '先别让她看见', '布拉姆', ['Bram']).output.bubble).toBeNull();
    expect(check('布拉姆那套虔诚说辞，其实我也有点被传染了', '先别让她看见', '布拉姆', ['Bram']).output.bubble).toBeNull();
    expect(check('怕死牧师先给自己上祝福').output.bubble).toBeNull();
    expect(check('贪财盗贼先听水下动静').output.bubble).toBeNull();
    expect(check('他觉得这把刀应该先归自己').output.bubble).toBeNull();
    expect(check('薇克丝，别装了').output.bubble).toBeNull();
    expect(check('Vex 想先拿到刀').output.bubble).toBeNull();
  });

  it('超长 / 无原文依据 / 空 都不合格', () => {
    expect(check('这一句话非常非常长'.repeat(4)).output.bubble).toBeNull();
    expect(check('我其实想的是完全另外一件事', '原文里没有这句话').output.bubble).toBeNull();
    expect(check('').output.bubble).toBeNull();
    expect(check(null).output.bubble).toBeNull();
  });

  it('“别让她看见”里的她指队友，不是自己，仍然合格', () => {
    const r = check('别让她看见，我先藏起来。', '先别让她看见');
    expect(r.output.bubble).toBe('别让她看见，我先藏起来。');
  });
});
