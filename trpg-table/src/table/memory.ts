import { clip } from '../util.js';

/**
 * 战役记忆：跨幕的“前情”和 GM 登记的世界事实。
 * GM 原来只看得到总览前 700 字 + 当前这一幕 + 最近几十条记录，两幕之前的事两边都不知道。
 * 这里把每幕的结局和跨幕的事实存下来（进存档），再按「谁能知道」分别生成给 GM 和给玩家的文字。
 * 纯逻辑，不碰 LLM 和引擎，可以单独测。
 */

/** 一幕结束时留下的前情。 */
export interface SceneRecap {
  sceneId: string;
  title: string;
  /** GM 写的结局，可以含玩家不知道的事（只给 GM 看） */
  summary: string;
  /** 玩家知道的版本（GM 写的 public_recap；没写就用桌面客观记下的几条） */
  publicRecap: string;
  /** 桌面客观记下的：打倒了谁、得到了什么、升级了谁。玩家也知道 */
  facts: string[];
  /** 这一幕走了多少轮 */
  rounds: number;
  at: number;
}

/** GM 登记的跨幕事实：谁欠谁、哪个 NPC 知道什么、哪条路被堵了。 */
export interface Fact {
  /** 同一个 key 再写就是更新；没写 key 的各自独立 */
  key: string;
  text: string;
  /** true = 玩家也知道（会进玩家视角）；false = 只有 GM 知道 */
  public: boolean;
  /** 登记时在第几幕（序号，从 1 起） */
  scene: number;
  at: number;
}

export interface CampaignMemorySnapshot {
  recaps: SceneRecap[];
  facts: Fact[];
  nextFactId: number;
}

const MAX_RECAPS = 12;
const MAX_FACTS = 30;
/** 最近这几幕给全文，更早的压成一句 */
const FULL_RECAPS = 3;

export class CampaignMemory {
  recaps: SceneRecap[] = [];
  facts: Fact[] = [];
  private nextFactId = 1;

  /** 一幕结束。同一个场景再结束一次（重放、读档）就覆盖，不重复记。 */
  addRecap(r: Omit<SceneRecap, 'at'> & { at?: number }): SceneRecap {
    const recap: SceneRecap = {
      sceneId: r.sceneId,
      title: r.title,
      summary: clip(r.summary.trim(), 400),
      publicRecap: clip(r.publicRecap.trim(), 200),
      facts: r.facts.map((f) => clip(f, 80)).slice(0, 12),
      rounds: r.rounds,
      at: r.at ?? Date.now(),
    };
    this.recaps = this.recaps.filter((x) => x.sceneId !== recap.sceneId);
    this.recaps.push(recap);
    if (this.recaps.length > MAX_RECAPS) this.recaps.splice(0, this.recaps.length - MAX_RECAPS);
    return recap;
  }

  /** 登记 / 更新一条事实。返回 { fact, replaced }；满了就淘汰最旧的一条。 */
  setFact(opts: { text: string; key?: string; public?: boolean; scene: number }): { fact: Fact; replaced: boolean; evicted?: Fact } {
    const text = clip(opts.text.trim(), 160);
    const key = opts.key?.trim() ? clip(opts.key.trim(), 30) : `f${this.nextFactId++}`;
    const existing = this.facts.findIndex((f) => f.key === key);
    const fact: Fact = { key, text, public: !!opts.public, scene: opts.scene, at: Date.now() };
    if (existing >= 0) {
      this.facts[existing] = fact;
      return { fact, replaced: true };
    }
    this.facts.push(fact);
    let evicted: Fact | undefined;
    if (this.facts.length > MAX_FACTS) evicted = this.facts.shift();
    return { fact, replaced: false, evicted };
  }

  /** 按 key 删（局势变了，这条不再成立）。 */
  dropFact(ref: string): Fact | null {
    const want = ref.trim();
    const i = this.facts.findIndex((f) => f.key === want || f.text === want);
    return i < 0 ? null : this.facts.splice(i, 1)[0];
  }

  /** 给 GM 的：【前情】+【已记下的事实】，什么都没有就是空串。 */
  gmBlock(): string {
    const lines: string[] = [];
    if (this.recaps.length) {
      lines.push('【前情（已经过去的幕）】');
      const fullFrom = this.recaps.length - FULL_RECAPS;
      this.recaps.forEach((r, i) => {
        const full = i >= fullFrom;
        const facts = r.facts.length ? `（${r.facts.join('；')}）` : '';
        lines.push(`- 「${r.title}」（${r.rounds} 轮）：${full ? r.summary : clip(r.summary, 100)}${facts}`);
      });
    }
    if (this.facts.length) {
      lines.push('【已记下的世界事实（note_fact 登记的；局势变了用 drop_fact 删掉）】');
      for (const f of this.facts) lines.push(`- [${f.key}] ${f.text}${f.public ? '' : '（只有你知道）'}`);
    }
    return lines.join('\n');
  }

  /** 给玩家的：只含玩家知道的。GM 的 summary 和非公开事实一概不进来。 */
  playerBlock(): string {
    const lines: string[] = [];
    const shown = this.recaps.slice(-4);
    for (const r of shown) {
      const text = r.publicRecap || (r.facts.length ? r.facts.join('；') : '');
      if (text) lines.push(`- 「${r.title}」：${text}`);
    }
    const facts = this.facts.filter((f) => f.public).slice(-10);
    for (const f of facts) lines.push(`- ${f.text}`);
    return lines.join('\n');
  }

  snapshot(): CampaignMemorySnapshot {
    return { recaps: this.recaps.map((r) => ({ ...r, facts: [...r.facts] })), facts: this.facts.map((f) => ({ ...f })), nextFactId: this.nextFactId };
  }

  load(snap: Partial<CampaignMemorySnapshot> | undefined | null): void {
    if (!snap) return;
    this.recaps = (snap.recaps ?? []).map((r) => ({ ...r, facts: [...(r.facts ?? [])], publicRecap: r.publicRecap ?? '' }));
    this.facts = (snap.facts ?? []).map((f) => ({ ...f }));
    this.nextFactId = snap.nextFactId ?? this.facts.length + 1;
  }
}
