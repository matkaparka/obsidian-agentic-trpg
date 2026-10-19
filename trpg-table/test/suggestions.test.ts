import { describe, expect, it } from 'vitest';
import { SuggestionQueue } from '../src/table/suggestions.js';
import type { TableConfig } from '../src/config.js';

function cfg(over: Partial<TableConfig> = {}): TableConfig {
  return {
    campaignVault: 'x',
    adventure: 'y',
    pacing: { tThought: 0, tDecision: 0, tBetween: 0, tReact: 0, tScene: 0, tResolve: 0 },
    limits: { gmMaxToolCalls: 8, playerRecentEvents: 12, playerRecentTurns: 6, playerParseRetries: 1, historyTurns: 40, stepTimeoutMs: 1000, playerTimeoutMs: 1000, sceneNudgeRounds: 12, sceneNudgeEvery: 4 },
    helixusSuggestions: true,
    helixusMaxSuggestions: 2,
    helixusSuggestionTtlSec: 60,
    helixusKnowsSecrets: true,
    startPaused: true,
    fallbackToDryRun: true,
    ...over,
  };
}

describe('Helixus 建议队列', () => {
  it('最长 300 字', () => {
    const q = new SuggestionQueue(cfg());
    const r = q.add('字'.repeat(301));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('too_long');
  });

  it('同一条 60 秒内不重复', () => {
    const q = new SuggestionQueue(cfg());
    expect(q.add('让地精从侧门冲出来').ok).toBe(true);
    const dup = q.add('让地精从侧门冲出来');
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe('duplicate');
  });

  it('最多 2 条待处理，旧的作废', () => {
    const q = new SuggestionQueue(cfg());
    q.add('建议一');
    q.add('建议二');
    const third = q.add('建议三');
    expect(third.ok).toBe(true);
    if (third.ok) expect(third.expired).toHaveLength(1);
    expect(q.pending().map((s) => s.text)).toEqual(['建议二', '建议三']);
  });

  it('关闭时拒绝，采纳/不采纳都记录理由', () => {
    const q = new SuggestionQueue(cfg({ helixusSuggestions: false }));
    const r = q.add('x');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('disabled');

    const q2 = new SuggestionQueue(cfg());
    const add = q2.add('让宝箱是个拟形怪');
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    const marked = q2.mark(add.suggestion.id, false, '这个反转留到下一场');
    expect(marked?.status).toBe('rejected');
    expect(marked?.reason).toContain('下一场');
    expect(q2.pending()).toHaveLength(0);
  });
});
