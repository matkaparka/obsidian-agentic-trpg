/**
 * 一幕的进度管理（确定性的那一层，不用模型）。
 *
 * 问题：剧本的出口条件只是一段文字，谁来判断“满足了没有”全靠 GM 自觉。真跑里第二幕的出口（找到东北小径、往溪水声去）
 * 第 2 轮就满足了，GM 却在这一幕里续写了 20 轮，还把第三幕洞口的内容提前演了。
 *
 * 场景 md 里两段，都是可选的：
 *   ## 节拍        一行一个：`- id｜描述`。这一幕该走完的几件事，GM 用 mark_beat 打勾，导演也会打勾，画面上显示「进度 2/4」。
 *   ## 自动出口    一行一条规则：`- 条件｜说明`，条件之间用「且」连接，多行之间是「或」。满足了桌面就让 GM 收尾，GM 不收桌面替它收。
 *                  条件：`任一到达 <地标>` / `全员到达 <地标>`（地标写 id 或名字；离地标 1 格以内算到达）、
 *                       `第 N 轮起`（这一幕走到第 N 轮；单独写就是强制收尾的上限）、`节拍 <id> 完成`。
 *                  读不懂的规则整条忽略，不会半条生效。
 * 纯逻辑，不碰引擎和 LLM，可以单独测。
 */

export interface Beat {
  id: string;
  text: string;
}

export type ExitCond =
  | { kind: 'any_at'; ref: string }
  | { kind: 'all_at'; ref: string }
  | { kind: 'round_from'; n: number }
  | { kind: 'beat'; id: string };

export interface ExitRule {
  /** 原文条件（给日志和 GM 看） */
  raw: string;
  /** 说明（`｜` 后面那段） */
  note: string;
  conds: ExitCond[];
}

/** 已经满足、正在等 GM 收尾（或等桌面替它收）的出口。 */
export interface PendingExit {
  rule: string;
  note: string;
  /** 满足时是这一幕的第几轮 */
  sinceRound: number;
  /** 满足之后 GM 已经走过几步还没收尾 */
  gmSteps: number;
  /** 来自导演的判断（不是自动规则）：导演给的收尾文字 */
  summary?: string;
  publicRecap?: string;
}

export interface SceneProgressSnapshot {
  done: string[];
  exit: PendingExit | null;
}

export interface ExitContext {
  /** 这一幕的第几轮（桌面轮号） */
  round: number;
  /** 地标上有没有人：any = 任一 PC 到了，all = 所有能动的 PC 都到了 */
  at(ref: string): { any: boolean; all: boolean };
}

export function parseBeats(raw: string): Beat[] {
  const out: Beat[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*[-*]\s*(.+)$/.exec(line);
    if (!m) continue;
    const parts = m[1].split(/[|｜]/).map((s) => s.trim());
    if (parts.length < 2 || !parts[0] || !parts[1] || seen.has(parts[0])) continue;
    seen.add(parts[0]);
    out.push({ id: parts[0], text: parts.slice(1).join('｜') });
  }
  return out;
}

function parseCond(text: string): ExitCond | null {
  const t = text.trim();
  let m = /^任一(?:人|个)?到达\s*(.+)$/.exec(t);
  if (m) return { kind: 'any_at', ref: m[1].trim() };
  m = /^全员到达\s*(.+)$/.exec(t);
  if (m) return { kind: 'all_at', ref: m[1].trim() };
  m = /^第\s*(\d+)\s*轮起$/.exec(t);
  if (m && Number(m[1]) >= 1) return { kind: 'round_from', n: Number(m[1]) };
  m = /^节拍\s*(\S+?)\s*完成$/.exec(t);
  if (m) return { kind: 'beat', id: m[1] };
  return null;
}

export function parseExitRules(raw: string): ExitRule[] {
  const out: ExitRule[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*[-*]\s*(.+)$/.exec(line);
    if (!m) continue;
    const parts = m[1].split(/[|｜]/).map((s) => s.trim());
    const condText = parts[0];
    if (!condText) continue;
    const conds: ExitCond[] = [];
    let ok = true;
    for (const piece of condText.split(/\s*且\s*/)) {
      const c = parseCond(piece);
      if (!c) {
        ok = false;
        break;
      }
      conds.push(c);
    }
    if (!ok || !conds.length) continue;
    out.push({ raw: condText, note: parts.slice(1).join('｜'), conds });
  }
  return out;
}

export function describeCond(c: ExitCond): string {
  switch (c.kind) {
    case 'any_at':
      return `任一 PC 到达「${c.ref}」`;
    case 'all_at':
      return `全员到达「${c.ref}」`;
    case 'round_from':
      return `这一幕走到第 ${c.n} 轮`;
    case 'beat':
      return `节拍「${c.id}」完成`;
  }
}

export class SceneProgress {
  beats: Beat[] = [];
  done = new Set<string>();
  rules: ExitRule[] = [];
  exit: PendingExit | null = null;

  /** 换场景：节拍和规则换成新这一幕的，进度清零。 */
  loadScene(beats: readonly Beat[] = [], rules: readonly ExitRule[] = []): void {
    this.beats = beats.map((b) => ({ ...b }));
    this.rules = rules.map((r) => ({ ...r, conds: r.conds.map((c) => ({ ...c })) }));
    this.done.clear();
    this.exit = null;
  }

  /** 打勾。按 id 精确认，再按描述里包含认；已经勾过的返回 null。 */
  markBeat(ref: string): Beat | null {
    const want = ref.trim();
    if (!want) return null;
    const beat = this.beats.find((b) => b.id === want) ?? this.beats.find((b) => want.includes(b.id) || b.text.includes(want));
    if (!beat || this.done.has(beat.id)) return null;
    this.done.add(beat.id);
    return beat;
  }

  get total(): number {
    return this.beats.length;
  }

  /** 满足的第一条规则；没有就 null。 */
  evaluate(ctx: ExitContext): ExitRule | null {
    for (const rule of this.rules) {
      const hit = rule.conds.every((c) => {
        switch (c.kind) {
          case 'any_at':
            return ctx.at(c.ref).any;
          case 'all_at':
            return ctx.at(c.ref).all;
          case 'round_from':
            return ctx.round >= c.n;
          case 'beat':
            return this.done.has(c.id);
        }
      });
      if (hit) return rule;
    }
    return null;
  }

  /** 给 GM 的【本幕进度】：节拍打勾情况 + 自动出口规则。没有节拍也没有规则就是空串。 */
  gmBlock(round: number): string {
    if (!this.beats.length && !this.rules.length) return '';
    const lines: string[] = [`【本幕进度】这一幕已经走到桌面第 ${round} 轮。`];
    if (this.beats.length) {
      lines.push(`节拍（${this.done.size}/${this.beats.length}）：做完一件就用 mark_beat 打勾——`);
      for (const b of this.beats) lines.push(`- [${this.done.has(b.id) ? '✓' : ' '}] ${b.id}：${b.text}`);
    }
    if (this.rules.length) {
      lines.push('自动出口（满足任意一条，桌面就会让你收尾；你不收，桌面替你收）：');
      for (const r of this.rules) lines.push(`- ${r.conds.map(describeCond).join(' 且 ')}${r.note ? `：${r.note}` : ''}`);
    }
    return lines.join('\n');
  }

  snapshot(): SceneProgressSnapshot {
    return { done: [...this.done], exit: this.exit ? { ...this.exit } : null };
  }

  load(snap: Partial<SceneProgressSnapshot> | undefined | null): void {
    if (!snap) return;
    const known = new Set(this.beats.map((b) => b.id));
    this.done = new Set((snap.done ?? []).filter((id) => known.has(id)));
    this.exit = snap.exit ? { ...snap.exit } : null;
  }
}
