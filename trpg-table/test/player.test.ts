import { describe, expect, it } from 'vitest';
import { extractJsonObject, normalizeDecision } from '../src/table/player.js';

describe('玩家输出解析', () => {
  it('从 markdown 代码块和前后废话里抠出 JSON', () => {
    const raw =
      '好的，这是决定：\n```json\n{"say":"走这边。","action":{"type":"move","detail":"往舱门走"},"expression":"thinking"}\n```\n';
    const parsed = extractJsonObject(raw) as Record<string, unknown>;
    expect(parsed.say).toBe('走这边。');
  });

  it('字段不合法就返回 null（交给重试/默认行动）', () => {
    expect(normalizeDecision({ say: 'x', action: { type: 'fly' }, expression: 'neutral' })).toBeNull();
    expect(normalizeDecision({ say: 'x', action: { type: 'talk' }, expression: 'smug' })).not.toBeNull();
    expect(normalizeDecision({ say: 'x', action: { type: 'talk' }, expression: 'dancing' })).toBeNull();
  });

  it('say 超过 60 字会裁剪并记一条错误', () => {
    const long = '啊'.repeat(80);
    const r = normalizeDecision({ say: long, action: { type: 'talk' }, expression: 'neutral' });
    expect(r).not.toBeNull();
    expect([...(r?.decision.say ?? '')].length).toBeLessThanOrEqual(61);
    expect(r?.errors[0]).toContain('60');
  });
});
