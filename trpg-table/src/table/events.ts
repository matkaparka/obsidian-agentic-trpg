export type LinkEventKind =
  | 'scene'
  | 'gm_narration'
  | 'thought_beat'
  | 'decision'
  | 'contrast'
  | 'roll'
  | 'combat_start'
  | 'combat_end'
  | 'suggestion_result'
  | 'system'
  | 'gm_hint'
  | 'gm_decision';

export type OverlayEventKind =
  | LinkEventKind
  | 'thinking'
  | 'state'
  | 'turn'
  | 'scene_end'
  | 'thought_start'
  | 'pause'
  | 'thought'
  | 'move'
  | 'xp'
  | 'level_up'
  | 'tts'
  | 'round'
  | 'world'
  | 'loot';

export type Urgency = 'immediate' | 'soon' | 'later';

export interface TableEvent {
  seq: number;
  at: number;
  kind: OverlayEventKind;
  text: string;
  urgency: Urgency;
  data?: Record<string, unknown>;
}

const RING = 500;

/** 桌面事件总线：状态机发事件，helixus-link 轮询、overlay 走 SSE，看到的顺序一致。 */
export class EventBus {
  private seq: number;
  private readonly ring: TableEvent[] = [];
  private readonly subs = new Set<(e: TableEvent) => void>();

  constructor(startSeq = 0) {
    this.seq = startSeq;
  }

  get latest(): number {
    return this.seq;
  }

  publish(kind: OverlayEventKind, text: string, urgency: Urgency = 'later', data?: Record<string, unknown>): TableEvent {
    this.seq += 1;
    const event: TableEvent = { seq: this.seq, at: Date.now(), kind, text, urgency, data };
    this.ring.push(event);
    if (this.ring.length > RING) this.ring.splice(0, this.ring.length - RING);
    for (const fn of this.subs) {
      try {
        fn(event);
      } catch {
        /* 一个订阅者出错不能影响桌面 */
      }
    }
    return event;
  }

  after(seq: number, limit = 50): { events: TableEvent[]; latest: number } {
    return { events: this.ring.filter((e) => e.seq > seq).slice(0, limit), latest: this.seq };
  }

  recent(n = 12): TableEvent[] {
    return this.ring.slice(-n);
  }

  subscribe(fn: (e: TableEvent) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  resetTo(seq: number): void {
    this.seq = seq;
  }
}
