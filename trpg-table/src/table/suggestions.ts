import type { TableConfig } from '../config.js';
import { countChars, uuid } from '../util.js';

export interface Suggestion {
  id: string;
  text: string;
  at: number;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  reason?: string;
}

export type SuggestionAdd =
  | { ok: true; suggestion: Suggestion; expired: Suggestion[] }
  | { ok: false; code: 'disabled' | 'empty' | 'too_long' | 'duplicate' | 'full'; message: string };

/**
 * Helixus 的旁白建议。它是**不可信文本**：GM 自己决定采不采纳。
 * 防刷：最长 300 字；同一条 60 秒内不重复；同时最多 2 条，旧的作废。
 */
export class SuggestionQueue {
  private items: Suggestion[] = [];

  constructor(private readonly config: TableConfig) {}

  get enabled(): boolean {
    return this.config.helixusSuggestions;
  }

  add(raw: string): SuggestionAdd {
    if (!this.config.helixusSuggestions) return { ok: false, code: 'disabled', message: '建议功能已关闭' };
    const text = raw.trim();
    if (!text) return { ok: false, code: 'empty', message: '建议是空的' };
    if (countChars(text) > 300) return { ok: false, code: 'too_long', message: '建议最长 300 字' };
    const now = Date.now();
    const ttl = this.config.helixusSuggestionTtlSec * 1000;
    if (this.items.some((s) => s.text === text && now - s.at < ttl)) {
      return { ok: false, code: 'duplicate', message: '同一条建议 60 秒内不重复' };
    }
    const expired: Suggestion[] = [];
    const pending = this.items.filter((s) => s.status === 'pending');
    while (pending.length >= this.config.helixusMaxSuggestions) {
      const oldest = pending.shift();
      if (oldest) {
        oldest.status = 'expired';
        expired.push(oldest);
      }
    }
    const suggestion: Suggestion = { id: uuid(), text, at: now, status: 'pending' };
    this.items.push(suggestion);
    if (this.items.length > 20) this.items = this.items.slice(-20);
    return { ok: true, suggestion, expired };
  }

  pending(): Suggestion[] {
    return this.items.filter((s) => s.status === 'pending');
  }

  byId(id: string): Suggestion | undefined {
    return this.items.find((s) => s.id === id);
  }

  mark(id: string, accepted: boolean, reason: string): Suggestion | null {
    const s = this.byId(id);
    if (!s || s.status !== 'pending') return null;
    s.status = accepted ? 'accepted' : 'rejected';
    s.reason = reason;
    return s;
  }

  /** 换场景/重开时清空 */
  clear(): void {
    this.items = [];
  }

  all(): Suggestion[] {
    return [...this.items];
  }
}
