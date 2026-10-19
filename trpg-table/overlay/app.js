// overlay 页面：只做显示。没有写操作、没有按钮、没有外部依赖。
// 画面四块：左上地图 / 左下滚动剧情 / 右上主播区（留空）/ 右下两个主角的面板；
// 角色说的话、心里想的是挂在地图棋子上的两种漫画气泡。
// 数据：/overlay/events（SSE）、/overlay/config、/overlay/sprites、父窗口 postMessage 的棋子屏幕矩形。

const SEATS = ['player_a', 'player_b'];
const $ = (sel, root = document) => root.querySelector(sel);
const stage = $('#stage');
const body = document.body;
const params = new URLSearchParams(location.search);
const DEMO = params.get('demo') === '1';
// 预览用：?demo=1&hold=1 时气泡不会到点消失，方便截图看样式
const HOLD = DEMO && params.get('hold') === '1';
body.classList.toggle('solid', params.get('bg') === 'solid');
body.classList.toggle('transparent', params.get('bg') !== 'solid');

const state = {
  config: null,
  players: {},
  tokens: [],
  tokenById: new Map(),
  activeSeat: null,
  thinkingSeat: null,
  initiative: [],
  round: 1,
  combat: false,
  scene: '',
  adventure: '',
  narration: '',
  narrationLines: 0,
  sprites: { player_a: {}, player_b: {} },
  lastSeq: 0,
  demo: DEMO,
  bubbles: { player_a: {}, player_b: {} },
  eventCounts: {},
};

const els = {
  streamer: $('#streamer'),
  subtitle: $('#subtitle'),
  scroll: $('#subtitle .scroll'),
  log: $('#subtitle .log'),
  chapter: $('#subtitle .chapter'),
  where: $('#subtitle .where'),
  party: $('#party'),
  phase: $('#party .phase'),
  initiative: $('#initiative'),
  mapVeil: $('#map-veil'),
  vupFrame: $('#vup-frame'),
  bubbleLayer: $('#bubble-layer'),
  tailLayer: $('#tail-layer'),
  diceLayer: $('#dice-layer'),
  demoBadge: $('#demo-badge'),
};

const cards = {};
for (const seat of SEATS) {
  const card = $(`.card[data-seat="${seat}"]`);
  cards[seat] = {
    card,
    sprite: $('.sprite', card),
    name: $('.name', card),
    role: $('.role', card),
    fill: $('.fill', card),
    num: $('.num', card),
    ac: $('.ac', card),
    gold: $('.gold', card),
    conds: $('.conds', card),
  };
}

// ---------------------------------------------------------------- 配置
function box(el, b) {
  el.style.left = `${b.x}px`;
  el.style.top = `${b.y}px`;
  el.style.width = `${b.w}px`;
  el.style.height = `${b.h}px`;
}

async function applyConfig() {
  const cfg = await fetch('/overlay/config').then((r) => r.json());
  state.config = cfg;
  const root = document.documentElement.style;
  const c = cfg.colors || {};
  for (const [key, value] of Object.entries({
    '--panel': c.panel,
    '--panel-hi': c.panel_hi,
    '--edge': c.panel_edge,
    '--edge-dim': c.panel_edge_dim,
    '--text': c.text,
    '--muted': c.muted,
    '--dim': c.dim,
    '--gold': c.gold,
    '--accent-a': c.accent_a,
    '--accent-b': c.accent_b,
    '--hp-ok': c.hp_ok,
    '--hp-mid': c.hp_mid,
    '--hp-low': c.hp_low,
    '--hp-track': c.hp_track,
    '--streamer-bg': c.streamer_bg,
    '--bubble-thought': c.bubble_thought,
    '--bubble-speech': c.bubble_speech,
    '--bubble-text': c.bubble_text,
    '--bubble-muted': c.bubble_muted,
    '--font': cfg.fonts?.family,
    '--font-narration': cfg.fonts?.narrationFamily,
    '--font-num': cfg.fonts?.numericFamily,
  })) {
    if (value) root.setProperty(key, value);
  }
  for (const [key, value] of Object.entries({
    '--subtitle-px': cfg.fonts?.subtitlePx,
    '--bubble-px': cfg.fonts?.bubblePx,
    '--initiative-px': cfg.fonts?.initiativePx,
    '--dice-px': cfg.fonts?.dicePx,
    '--name-px': cfg.fonts?.namePx,
    '--hp-px': cfg.fonts?.hpPx,
  })) {
    if (value) root.setProperty(key, `${value}px`);
  }
  const L = cfg.layout;
  box(els.streamer, L.streamer);
  box(els.vupFrame, L.streamer);
  box(els.mapVeil, L.map);
  box(els.subtitle, L.subtitle);
  box(els.party, L.characters);
  els.demoBadge.style.left = `${L.map.x + 18}px`;
  els.demoBadge.style.top = `${L.map.y + 18}px`;
  els.demoBadge.style.right = 'auto';
  // 地图区域：气泡和骰子永远不能越界
  state.map = L.map;
  renderParty();
  relayoutAll();
  postReport();
}

function fit() {
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  postReport();
}

// ---------------------------------------------------------------- 文本工具
const isOver = (el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;

function clipAtSentence(text, maxChars) {
  const chars = [...String(text ?? '').trim()];
  if (chars.length <= maxChars) return chars.join('');
  const head = chars.slice(0, maxChars);
  for (let i = head.length - 1; i >= Math.max(3, Math.floor(maxChars * 0.55)); i--) {
    if (/[。！？；，、,.!?;：:]/.test(head[i])) return `${head.slice(0, i + 1).join('').replace(/[。！？；，、,.!?;：:]+$/u, '')}…`;
  }
  return `${head.join('')}…`;
}

/** 字号不能低于 30，所以只在句子边界截断，保证不露出半行字。 */
function fitBubbleText(el, text, maxChars, maxLines) {
  const full = clipAtSentence(text, maxChars);
  el.textContent = full;
  el.dataset.full = full;
  const cs = getComputedStyle(el);
  const line = parseFloat(cs.lineHeight) || 40;
  // box-sizing 是 border-box：max-height 要把上下 padding 和边框一起算进去，否则最后一行会被判成「裁字」
  const chrome =
    (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) +
    (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
  el.style.maxHeight = `${Math.ceil(line * maxLines + chrome + 2)}px`;
  let current = full;
  let guard = 40;
  while (isOver(el) && guard-- > 0) {
    const chars = [...current.replace(/…$/, '')];
    if (chars.length <= 6) break;
    const cut = Math.max(6, Math.floor(chars.length * 0.82));
    let out = chars.slice(0, cut).join('');
    for (let i = out.length - 1; i >= Math.max(3, Math.floor(cut * 0.5)); i--) {
      if (/[。！？；，、,.!?;：:]/.test(out[i])) {
        out = out.slice(0, i + 1);
        break;
      }
    }
    out = out.replace(/[\s。！？；，、,.!?;：:]+$/u, '');
    if (!out || out === current.replace(/…$/, '')) break;
    current = `${out}…`;
    el.textContent = current;
  }
  return current;
}

// ---------------------------------------------------------------- 棋子矩形
function seatOfToken(token) {
  for (const seat of SEATS) {
    if (state.players[seat]?.name && state.players[seat].name === token.name) return seat;
  }
  return null;
}

function tokenRectForSeat(seat) {
  const name = state.players[seat]?.name;
  const token = state.tokens.find((t) => (name && t.name === name) || t.seat === seat);
  if (!token) return null;
  return token;
}

function tokenRectByRef(ref) {
  if (!ref) return null;
  return state.tokens.find((t) => t.id === ref || t.name === ref) ?? null;
}

let lastTokenSignature = '';
function receiveTokenPositions(payload) {
  if (!payload || !Array.isArray(payload.tokens)) return;
  // 插件每 100ms 发一次；位置、地图矩形都没变就不重排
  const signature = JSON.stringify([payload.map, payload.tokens.map((t) => [t.id, t.x, t.y, t.w, t.h, t.imagePath])]);
  if (signature === lastTokenSignature && state.tokens.length) return;
  lastTokenSignature = signature;
  state.tokens = payload.tokens;
  state.tokenById = new Map(payload.tokens.map((t) => [t.id, t]));
  if (payload.map) state.map = { ...state.map, ...payload.map };
  relayoutAll();
  postReport();
}

// ---------------------------------------------------------------- 气泡
function accentFor(seat) {
  return seat === 'player_b' ? 'var(--accent-b)' : 'var(--accent-a)';
}

function clearTail(seat, kind) {
  const selector = kind ? `[data-seat="${seat}"][data-kind="${kind}"]` : `[data-seat="${seat}"]`;
  for (const child of [...els.tailLayer.querySelectorAll(selector)]) child.remove();
}

function removeBubble(seat, kind, instant = false) {
  const slot = state.bubbles[seat]?.[kind];
  if (!slot) return;
  if (slot.timer) clearTimeout(slot.timer);
  if (slot.removeTimer) clearTimeout(slot.removeTimer);
  delete state.bubbles[seat][kind];
  if (instant) {
    slot.el.remove();
    clearTail(seat, kind);
    return;
  }
  slot.el.classList.add('shrink');
  slot.el.style.pointerEvents = 'none';
  for (const g of els.tailLayer.querySelectorAll(`[data-seat="${seat}"][data-kind="${kind}"]`)) g.classList.add('shrink');
  slot.removeTimer = setTimeout(() => {
    slot.el.remove();
    clearTail(seat, kind);
    postReport();
  }, 240);
  postReport();
}

function createBubble(seat, kind, text, opts = {}) {
  removeBubble(seat, kind, true);
  const el = document.createElement('div');
  el.className = `bubble ${kind === 'thought' ? 'cloud' : 'speech'}${opts.thinking ? ' thinking' : ''}`;
  el.style.setProperty('--accent', accentFor(seat));
  el.dataset.seat = seat;
  el.dataset.kind = kind;
  // 先挂进页面再量：脱离文档的元素 getComputedStyle 是空的，max-height 会算小，把最后一行切掉
  els.bubbleLayer.append(el);
  if (opts.thinking) {
    for (let i = 0; i < 3; i++) el.append(document.createElement('i'));
  } else {
    fitBubbleText(el, text, opts.maxChars ?? 40, kind === 'thought' ? 2 : 3);
  }
  const slot = {
    seat,
    kind,
    el,
    text: opts.thinking ? '…' : el.textContent,
    fullText: text,
    valid: opts.valid !== false,
    thinking: !!opts.thinking,
    placement: 'above',
    rect: null,
    tailTip: null,
    timer: null,
  };
  state.bubbles[seat][kind] = slot;
  placeBubble(slot);
  return slot;
}

const TAIL_LEN = 18;
const SHIFTS = [0, -0.25, 0.25, -0.42, 0.42];
const SIDE_COST = { above: 0, below: 4, right: 8, left: 10 };

/** 四个方位 × 沿垂直方向滑几个位置。每一个候选的气泡边缘到棋子都只隔 gap + 尾巴长度，所以尾巴永远够得着。 */
function candidatePositions(rect, token, gap) {
  const cx = token.x + token.w / 2;
  const cy = token.y + token.h / 2;
  const away = gap + TAIL_LEN;
  const out = [];
  for (const shift of SHIFTS) {
    out.push({ placement: 'above', shift, x: cx - rect.w / 2 + shift * rect.w, y: token.y - rect.h - away });
    out.push({ placement: 'below', shift, x: cx - rect.w / 2 + shift * rect.w, y: token.y + token.h + away });
    out.push({ placement: 'right', shift, x: token.x + token.w + away, y: cy - rect.h / 2 + shift * rect.h });
    out.push({ placement: 'left', shift, x: token.x - rect.w - away, y: cy - rect.h / 2 + shift * rect.h });
  }
  return out;
}

function clampToMap(candidate, rect) {
  const map = state.map;
  const minX = map.x + 8;
  const maxX = map.x + map.w - rect.w - 8;
  const minY = map.y + 8;
  const maxY = map.y + map.h - rect.h - 8;
  return {
    ...candidate,
    x: Math.max(minX, Math.min(candidate.x, maxX)),
    y: Math.max(minY, Math.min(candidate.y, maxY)),
  };
}

function intersects(a, b, margin = 0) {
  return a.x < b.x + b.w + margin && a.x + a.w + margin > b.x && a.y < b.y + b.h + margin && a.y + a.h + margin > b.y;
}

function otherBubbleRects(seat, kind) {
  const out = [];
  for (const s of SEATS) {
    for (const k of ['thought', 'speech']) {
      if (s === seat && k === kind) continue;
      const slot = state.bubbles[s]?.[k];
      if (slot?.rect && !slot.el.classList.contains('shrink')) out.push({ ...slot.rect, seat: s, kind: k });
    }
  }
  return out;
}

function placeBubble(slot) {
  const token = tokenRectForSeat(slot.seat);
  if (!token || !state.config) {
    slot.el.classList.add('hidden');
    slot.rect = null;
    slot.tailTip = null;
    return;
  }
  slot.el.classList.remove('hidden');
  const rect = { x: 0, y: 0, w: slot.el.offsetWidth, h: slot.el.offsetHeight };
  if (!rect.w || !rect.h) return;
  const gap = state.config.bubbles.gapPx ?? 10;
  const others = otherBubbleRects(slot.seat, slot.kind);
  const overlapArea = (r, o) => (Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x)) * (Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y));
  let pick = null;
  let best = Infinity;
  for (const raw of candidatePositions(rect, token, gap)) {
    const cand = clampToMap(raw, rect);
    const r = { x: cand.x, y: cand.y, w: rect.w, h: rect.h };
    const overlap = others.reduce((sum, o) => sum + (intersects(r, o, gap) ? overlapArea(r, o) : 0), 0);
    // 不能盖住自己的棋子（贴边被夹回来时会发生），也尽量不盖另一个棋子
    const ownPenalty = intersects(r, token, 4) ? 1e6 : 0;
    const tokenPenalty = state.tokens.some((t) => t.id !== token.id && intersects(r, t, 0)) ? 3e4 : 0;
    // 被地图边缘夹走得越远，说明这个位置越勉强
    const clamped = Math.abs(cand.x - raw.x) + Math.abs(cand.y - raw.y);
    // 离尾巴位置越偏，越不像「头上的气泡」
    const score = overlap * 10 + ownPenalty + tokenPenalty + SIDE_COST[cand.placement] + Math.abs(cand.shift) * 14 + clamped * 1.5;
    if (score < best) {
      best = score;
      pick = cand;
    }
  }
  slot.el.style.left = `${Math.round(pick.x)}px`;
  slot.el.style.top = `${Math.round(pick.y)}px`;
  slot.placement = pick.placement;
  slot.rect = { x: Math.round(pick.x), y: Math.round(pick.y), w: rect.w, h: rect.h };
  slot.tailTip = tailTipFor(slot, token);
  drawTail(slot, token);
}

/** 尾巴尖永远落在棋子的边缘上（沿边缘取离气泡中心最近的一点）；尾巴根在气泡边上，离角至少 24px。 */
function tailTipFor(slot, token) {
  const r = slot.rect;
  const m = 8;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  const rcx = r ? r.x + r.w / 2 : token.x + token.w / 2;
  const rcy = r ? r.y + r.h / 2 : token.y + token.h / 2;
  if (slot.placement === 'above') return { x: clamp(rcx, token.x + m, token.x + token.w - m), y: token.y };
  if (slot.placement === 'below') return { x: clamp(rcx, token.x + m, token.x + token.w - m), y: token.y + token.h };
  if (slot.placement === 'right') return { x: token.x + token.w, y: clamp(rcy, token.y + m, token.y + token.h - m) };
  return { x: token.x, y: clamp(rcy, token.y + m, token.y + token.h - m) };
}

function bubbleEdgePoint(slot) {
  const r = slot.rect;
  const t = slot.tailTip;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  if (slot.placement === 'above') return { x: clamp(t.x, r.x + 24, r.x + r.w - 24), y: r.y + r.h };
  if (slot.placement === 'below') return { x: clamp(t.x, r.x + 24, r.x + r.w - 24), y: r.y };
  if (slot.placement === 'right') return { x: r.x, y: clamp(t.y, r.y + 24, r.y + r.h - 24) };
  return { x: r.x + r.w, y: clamp(t.y, r.y + 24, r.y + r.h - 24) };
}

/**
 * 云朵的轮廓：沿矩形（比元素框内缩 inset）的四条边依次画向外鼓的圆弧，一笔画成带凸边的云。
 * 文字区是矩形，不会像椭圆那样把边角的字切掉。弧最多鼓出 inset 左右，刚好碰到元素框的边。
 */
const CLOUD_INSET = 14;
function cloudPath(rect, inset) {
  const x0 = rect.x + inset;
  const y0 = rect.y + inset;
  const x1 = rect.x + rect.w - inset;
  const y1 = rect.y + rect.h - inset;
  const w = x1 - x0;
  const h = y1 - y0;
  const nx = Math.max(2, Math.round(w / 56));
  const ny = Math.max(1, Math.round(h / 50));
  const edges = [
    { n: nx, from: [x0, y0], to: [x1, y0] },
    { n: ny, from: [x1, y0], to: [x1, y1] },
    { n: nx, from: [x1, y1], to: [x0, y1] },
    { n: ny, from: [x0, y1], to: [x0, y0] },
  ];
  let d = `M ${x0.toFixed(1)} ${y0.toFixed(1)}`;
  for (const e of edges) {
    const dx = (e.to[0] - e.from[0]) / e.n;
    const dy = (e.to[1] - e.from[1]) / e.n;
    const seg = Math.hypot(dx, dy);
    const r = (seg * 0.62).toFixed(1);
    for (let i = 1; i <= e.n; i++) {
      d += ` A ${r} ${r} 0 0 1 ${(e.from[0] + dx * i).toFixed(1)} ${(e.from[1] + dy * i).toFixed(1)}`;
    }
  }
  return `${d} Z`;
}

function drawTail(slot, token) {
  clearTail(slot.seat, slot.kind);
  if (!slot.rect || !slot.tailTip) return;
  const edge = bubbleEdgePoint(slot);
  const ns = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('data-seat', slot.seat);
  g.setAttribute('data-kind', slot.kind);
  // SVG 不在气泡元素里，--accent 要自己带上，否则 B 的尾巴会用 A 的描边色
  g.style.setProperty('--accent', accentFor(slot.seat));
  if (slot.kind === 'thought') {
    const body = document.createElementNS(ns, 'path');
    body.setAttribute('class', 'cloud-body');
    body.setAttribute('d', cloudPath(slot.rect, slot.thinking ? 10 : CLOUD_INSET));
    g.append(body);
    const dots = [
      { t: 0.22, r: 15 },
      { t: 0.55, r: 10 },
      { t: 0.84, r: 5 },
    ];
    for (const d of dots) {
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('class', 'tail-cloud');
      c.setAttribute('cx', String(edge.x + (slot.tailTip.x - edge.x) * d.t));
      c.setAttribute('cy', String(edge.y + (slot.tailTip.y - edge.y) * d.t));
      c.setAttribute('r', String(d.r));
      g.append(c);
    }
  } else {
    const dx = slot.tailTip.x - edge.x;
    const dy = slot.tailTip.y - edge.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const p = document.createElementNS(ns, 'polygon');
    p.setAttribute('class', 'tail-speech');
    p.setAttribute('points', [
      `${edge.x + nx * 11},${edge.y + ny * 11}`,
      `${edge.x - nx * 11},${edge.y - ny * 11}`,
      `${slot.tailTip.x},${slot.tailTip.y}`,
    ].join(' '));
    g.append(p);
  }
  els.tailLayer.append(g);
}

function relayoutAll() {
  for (const seat of SEATS) {
    for (const kind of ['thought', 'speech']) {
      const slot = state.bubbles[seat]?.[kind];
      if (slot) placeBubble(slot);
    }
  }
  refitAllTags();
}

function showThinking(seat) {
  if (!SEATS.includes(seat)) return;
  // 同一个角色最多两个气泡；旧的思考云先清掉
  removeBubble(seat, 'thought', true);
  const slot = createBubble(seat, 'thought', '…', { thinking: true, maxChars: 22 });
  slot.kind = 'thought';
  slot.thinking = true;
  slot.timer = HOLD ? null : setTimeout(() => removeBubble(seat, 'thought'), 12000);
  state.activeSeat = seat;
  applyActive();
}

function showThought(data) {
  const seat = data.seat;
  if (!SEATS.includes(seat)) return;
  const bubble = String(data.bubble ?? '').trim();
  if (!bubble) {
    removeBubble(seat, 'thought');
    return;
  }
  removeBubble(seat, 'thought', true);
  const slot = createBubble(seat, 'thought', bubble, { maxChars: state.config?.bubbles.maxThoughtChars ?? 22, valid: data.bubbleValid !== false });
  slot.thinking = false;
  const ttl = state.config?.bubbles.thoughtTtlMs ?? 6000;
  slot.timer = HOLD ? null : setTimeout(() => removeBubble(seat, 'thought'), ttl);
  state.activeSeat = seat;
  applyActive();
}

function speechDuration(text) {
  const b = state.config?.bubbles ?? {};
  const min = b.speechMinMs ?? 4000;
  const per = b.speechPerCharMs ?? 250;
  const max = b.speechMaxMs ?? 10000;
  return Math.max(min, Math.min(max, min + per * [...String(text)].length));
}

function showSpeech(seat, say) {
  if (!SEATS.includes(seat)) return;
  // 模型常把整句话包在引号里；说话气泡本身就是「说出口」，引号多余（还会露出一个单独的半角引号）
  const text = String(say ?? '').trim().replace(/^[“"「『]+\s*/u, '').replace(/\s*[”"」』]+$/u, '').trim();
  if (!text) return;
  // 说话气泡要等思考云让位（缩一下再出）
  if (state.bubbles[seat]?.thought && !HOLD) removeBubble(seat, 'thought');
  removeBubble(seat, 'speech', true);
  const slot = createBubble(seat, 'speech', text, { maxChars: state.config?.bubbles.maxSayChars ?? 40 });
  slot.timer = HOLD ? null : setTimeout(() => removeBubble(seat, 'speech'), speechDuration(text));
  state.activeSeat = seat;
  applyActive();
}

// ---------------------------------------------------------------- 配音（旁白 + 两个角色）
// 服务端合成好一段就发一个 tts 事件（wav 地址、倍速、估计时长）；这里排队，一段播完再播下一段。
// 角色的台词在播的时候，说话气泡跟着多留一会儿。?audio=0 关声音（同一个页面开了几个窗口时，只让一个出声）；
// demo 页不连事件，所以没有声音。
const AUDIO_ON = !DEMO && params.get('audio') !== '0';
const AUDIO_MAX_AGE_MS = 120000; // 重连后服务端会把最近的事件再发一遍：太旧的不播
const audioQueue = [];
let audioPlaying = null;
let audioBlocked = false;

function setAudioHint(show) {
  let el = document.getElementById('audio-hint');
  if (!show) {
    el?.remove();
    return;
  }
  if (el) return;
  el = document.createElement('div');
  el.id = 'audio-hint';
  el.textContent = '点一下页面开启声音';
  document.body.append(el);
}

function enqueueTts(ev) {
  if (!AUDIO_ON) return;
  const d = ev.data ?? {};
  if (!d.url) return;
  const at = ev.at ?? Date.now();
  if (Date.now() - at > AUDIO_MAX_AGE_MS) return;
  const volume = Number(d.volume);
  audioQueue.push({
    url: d.url,
    rate: Number(d.rate) || 1,
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1,
    seat: d.seat ?? null,
    kind: d.kind,
    durationMs: Number(d.durationMs) || 0,
  });
  while (audioQueue.length > 12) audioQueue.shift();
  pumpAudio();
}

function pumpAudio() {
  if (audioPlaying || audioBlocked) return;
  const clip = audioQueue.shift();
  if (!clip) return;
  const a = new Audio(clip.url);
  a.preload = 'auto';
  a.playbackRate = clip.rate;
  a.preservesPitch = true;
  a.volume = clip.volume;
  audioPlaying = a;
  let watchdog = null;
  const finish = () => {
    clearTimeout(watchdog);
    if (audioPlaying !== a) return;
    audioPlaying = null;
    pumpAudio();
  };
  a.addEventListener('ended', finish);
  a.addEventListener('error', finish);
  // 万一既不 ended 也不 error（页面在后台被挂起等），按估计时长再留 3 秒后放弃这一段，别把队列堵死
  watchdog = setTimeout(() => {
    a.pause();
    finish();
  }, (clip.durationMs || 20000) * 1.5 + 3000);
  a.play()
    .then(() => {
      setAudioHint(false);
      if (clip.kind === 'speech' && clip.seat) holdSpeech(clip.seat, clip.durationMs + 900);
      else if (clip.kind === 'thought' && clip.seat) holdThought(clip.seat, clip.durationMs + 900);
    })
    .catch((e) => {
      clearTimeout(watchdog);
      audioPlaying = null;
      if (e && e.name === 'NotAllowedError') {
        // 浏览器不让自动出声（OBS / Electron 里通常不会）：等第一次点击再继续
        audioBlocked = true;
        audioQueue.unshift(clip);
        setAudioHint(true);
      } else {
        pumpAudio();
      }
    });
}

for (const evt of ['pointerdown', 'keydown']) {
  window.addEventListener(
    evt,
    () => {
      if (!audioBlocked) return;
      audioBlocked = false;
      pumpAudio();
    },
    { passive: true }
  );
}

// 自检 / 手动试听用（和 __overlayReport 一样挂在 window 上）：__overlayAudio.enqueue({ at, data: { url, rate, volume, seat, kind, durationMs } })
window.__overlayAudio = {
  enqueue: enqueueTts,
  status: () => ({
    on: AUDIO_ON,
    blocked: audioBlocked,
    queued: audioQueue.length,
    playing: audioPlaying
      ? { file: audioPlaying.src.split('/').pop(), rate: audioPlaying.playbackRate, pitchKept: audioPlaying.preservesPitch, t: audioPlaying.currentTime, duration: audioPlaying.duration }
      : null,
  }),
};

/** 这个角色的心里话正在播：思考云至少留到播完（原来固定 thoughtTtlMs） */
function holdThought(seat, ms) {
  const slot = state.bubbles[seat]?.thought;
  if (!slot || HOLD) return;
  clearTimeout(slot.timer);
  slot.timer = setTimeout(() => removeBubble(seat, 'thought'), Math.max(state.config?.bubbles.thoughtTtlMs ?? 6000, ms));
}

/** 这个角色的台词正在播：说话气泡至少留到播完 */
function holdSpeech(seat, ms) {
  const slot = state.bubbles[seat]?.speech;
  if (!slot || HOLD) return;
  clearTimeout(slot.timer);
  slot.timer = setTimeout(() => removeBubble(seat, 'speech'), Math.max(speechDuration(slot.el?.textContent ?? ''), ms));
}

// ---------------------------------------------------------------- 角色面板 / 滚动剧情 / 骰子
/** 「盗贼（Rogue / Thief）3」→「盗贼 3级」 */
function shortRole(role) {
  const r = String(role ?? '').replace(/（[^）]*）/g, '').replace(/\s+/g, ' ').trim();
  return r.replace(/(\D)\s*(\d+)$/u, '$1 $2级');
}

function hpColor(ratio) {
  return ratio >= 0.6 ? 'var(--hp-ok)' : ratio >= 0.3 ? 'var(--hp-mid)' : 'var(--hp-low)';
}

function setSprite(seat, expression) {
  const c = cards[seat];
  const manifest = state.sprites[seat] || {};
  const exp = manifest[expression] ? expression : manifest.neutral ? 'neutral' : null;
  if (!exp) {
    c.sprite.classList.remove('ready');
    c.sprite.removeAttribute('src');
    c.sprite.dataset.url = '';
    return;
  }
  const url = `/sprites/${seat}/${exp}.png?v=${manifest[exp]}`;
  if (c.sprite.dataset.url === url) return;
  c.sprite.dataset.url = url;
  c.sprite.onload = () => c.sprite.classList.add('ready');
  c.sprite.onerror = () => c.sprite.classList.remove('ready');
  c.sprite.src = url;
}

function renderPartyFlags() {
  for (const seat of SEATS) {
    const p = state.players[seat];
    const card = cards[seat].card;
    card.classList.toggle('active', state.activeSeat === seat);
    card.classList.toggle('thinking', state.thinkingSeat === seat);
    card.classList.toggle('downed', !!p && p.hp <= 0);
  }
  // 回合条上谁高亮、谁打勾由桌面算好随 state 送来（见 renderInitiative），这里不再按 activeSeat 覆盖：
  // 探索里 A 行动完 activeSeat 还停在 A，会和“下一位是 B”同时亮
}

// ---------------------------------------------------------------- 状态标签
// 增益（青）/ 负面（红）/ 濒死（暗红）三种颜色；3 级以后一个人身上可能挂七八个，一行放不下时
// 整条自动来回滚动（两头各停一下），下面一条细滑轨指示现在滚到哪。直播里没人能拨滚动条，所以不靠手动。
const TAG_SPEED = 38; // 滚动速度，像素 / 秒
const TAG_HOLD = 1800; // 两头各停多久，毫秒
const tagSig = {};
const tagAnims = {};

function normalizeTags(p) {
  if (Array.isArray(p.tags)) return p.tags.filter((t) => t && t.text);
  // 旧格式：只有文字。没有分类就当中性标签
  return (Array.isArray(p.conditions) ? p.conditions : []).map((text) => ({ text: String(text), kind: 'neutral' }));
}

function stopTagAnim(seat) {
  for (const a of tagAnims[seat] ?? []) a.cancel();
  tagAnims[seat] = [];
}

function renderTags(seat, p) {
  const tags = normalizeTags(p);
  const sig = JSON.stringify(tags);
  if (tagSig[seat] === sig) return; // 没变就别动：重建会让滚动从头开始
  tagSig[seat] = sig;
  stopTagAnim(seat);
  const view = document.createElement('div');
  view.className = 'conds-view';
  const run = document.createElement('div');
  run.className = 'conds-run';
  for (const t of tags) {
    const span = document.createElement('span');
    span.className = `t t-${['buff', 'debuff', 'down'].includes(t.kind) ? t.kind : 'neutral'}${t.conc ? ' conc' : ''}`;
    span.textContent = String(t.text);
    run.append(span);
  }
  view.append(run);
  const rail = document.createElement('div');
  rail.className = 'conds-rail';
  const thumb = document.createElement('i');
  rail.append(thumb);
  cards[seat].conds.replaceChildren(view, rail);
  // 量宽度要等字体就绪：先量一次（强制布局，页面在后台、rAF 不走时也能量），字体到了再量一次
  fitTags(seat);
  if (document.fonts?.ready) document.fonts.ready.then(() => tagSig[seat] === sig && fitTags(seat));
}

function fitTags(seat) {
  const box = cards[seat].conds;
  const view = box.querySelector('.conds-view');
  const run = box.querySelector('.conds-run');
  const rail = box.querySelector('.conds-rail');
  const thumb = rail?.querySelector('i');
  if (!view || !run || !rail || !thumb) return;
  stopTagAnim(seat);
  const viewW = view.clientWidth;
  const dist = Math.ceil(run.scrollWidth - viewW);
  const overflow = viewW > 0 && dist > 2;
  box.classList.toggle('scrolling', overflow);
  if (!overflow) return;
  const railW = rail.clientWidth;
  const thumbW = Math.max(16, Math.round((viewW / run.scrollWidth) * railW));
  thumb.style.width = `${thumbW}px`;
  const room = Math.max(0, railW - thumbW);
  const move = Math.max(1200, (dist / TAG_SPEED) * 1000);
  const total = TAG_HOLD * 2 + move * 2;
  const a = TAG_HOLD / total;
  const b = (TAG_HOLD + move) / total;
  const c = (TAG_HOLD * 2 + move) / total;
  const frames = (to) => [
    { transform: 'translateX(0)', offset: 0 },
    { transform: 'translateX(0)', offset: a, easing: 'ease-in-out' },
    { transform: `translateX(${to}px)`, offset: b },
    { transform: `translateX(${to}px)`, offset: c, easing: 'ease-in-out' },
    { transform: 'translateX(0)', offset: 1 },
  ];
  const opts = { duration: total, iterations: Infinity };
  tagAnims[seat] = [run.animate(frames(-dist), opts), thumb.animate(frames(room), opts)];
}

function refitAllTags() {
  for (const seat of SEATS) fitTags(seat);
}

function renderParty() {
  for (const seat of SEATS) {
    const p = state.players[seat];
    const c = cards[seat];
    if (!p) continue;
    c.name.textContent = p.name ?? '';
    c.role.textContent = shortRole(p.role);
    const max = Math.max(1, Number(p.maxHp) || 1);
    const hp = Math.max(0, Math.min(max, Number(p.hp) || 0));
    const ratio = hp / max;
    c.fill.style.width = `${Math.round(ratio * 100)}%`;
    c.fill.style.setProperty('--hpc', hpColor(ratio));
    c.num.textContent = `${hp}/${max}`;
    c.card.classList.toggle('hp-low', ratio < 0.3 && hp > 0);
    c.ac.textContent = p.ac != null ? `AC ${p.ac}` : '';
    c.ac.classList.toggle('hidden', p.ac == null);
    c.gold.textContent = p.gold ? p.gold : '';
    c.gold.classList.toggle('hidden', !p.gold);
    renderTags(seat, p);
    setSprite(seat, p.expression ?? 'neutral');
  }
  // 回合计：探索和战斗共用一条“第 N 轮”
  const beats = state.beats && state.beats.total > 0 ? ` · 进度 ${state.beats.done}/${state.beats.total}` : '';
  els.phase.textContent = `第 ${state.round} 轮 · ${state.combat ? '战斗' : '探索'}${beats}`;
  els.chapter.textContent = state.adventure ? `《${state.adventure}》` : '';
  els.where.textContent = state.scene ?? '';
  renderInitiative();
  renderPartyFlags();
}

// 回合条：这一轮每个会动的位子（PC / 场上的生物 / 到点的环境），行动过的打勾，下一位高亮
function renderInitiative() {
  els.initiative.replaceChildren();
  if (!state.initiative.length) return;
  for (const entry of state.initiative) {
    const div = document.createElement('div');
    div.className = 'ini';
    if (entry.seat) div.classList.add('pc');
    else if (entry.kind === 'env') div.classList.add('env');
    if (entry.seat === 'player_a') div.style.setProperty('--ini-accent', 'var(--accent-a)');
    if (entry.seat === 'player_b') div.style.setProperty('--ini-accent', 'var(--accent-b)');
    div.dataset.seat = entry.seat ?? '';
    div.textContent = String(entry.name ?? '?').slice(0, 1);
    div.title = `${entry.name ?? ''} ${entry.initiative ?? ''}`;
    if (entry.done) div.classList.add('done');
    if (entry.current) div.classList.add('current');
    els.initiative.append(div);
  }
}

// 新的一轮开始：标题上的“第 N 轮”闪一下
function pulseRound() {
  els.phase.classList.remove('pulse');
  void els.phase.offsetWidth;
  els.phase.classList.add('pulse');
}

function applyActive() {
  renderPartyFlags();
}

async function loadSprites() {
  try {
    const m = await fetch('/overlay/sprites', { cache: 'no-store' }).then((r) => r.json());
    if (JSON.stringify(m) === JSON.stringify(state.sprites)) return;
    state.sprites = m;
    for (const seat of SEATS) setSprite(seat, state.players[seat]?.expression ?? 'neutral');
  } catch {
    /* 没有立绘就用剪影 */
  }
}

// 滚动剧情：新的一段淡入，顶到窗口最上面，旧的往上滚走（渐隐）；超过三行的段落自己慢慢往下读
const LOG_KEEP = 10;
let scrollY = 0;
let readTimer = null;

function setScroll(y, ms = 700, linear = false) {
  scrollY = y;
  els.log.style.transitionDuration = `${ms}ms`;
  els.log.style.transitionTimingFunction = linear ? 'linear' : '';
  els.log.style.transform = `translateY(${-y}px)`;
}

function pruneLog() {
  let dropped = 0;
  while (els.log.children.length > LOG_KEEP) {
    const first = els.log.firstElementChild;
    dropped += first.offsetHeight + 16;
    first.remove();
  }
  if (dropped) {
    // 被删掉的段落都在窗口上面：把滚动位置同步减掉，画面不跳
    els.log.style.transition = 'none';
    setScroll(Math.max(0, scrollY - dropped), 0);
    void els.log.offsetHeight;
    els.log.style.transition = '';
  }
}

function setNarration(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t || t === state.narration) return;
  state.narration = t;
  if (readTimer) clearTimeout(readTimer);
  readTimer = null;
  for (const old of els.log.querySelectorAll('p.cur')) old.classList.remove('cur');
  const p = document.createElement('p');
  p.className = 'cur';
  p.textContent = t;
  els.log.append(p);
  pruneLog();
  const view = els.scroll.clientHeight;
  const line = parseFloat(getComputedStyle(p).lineHeight) || 40;
  state.narrationLines = Math.round(p.offsetHeight / line);
  setScroll(p.offsetTop, 700);
  // 超过窗口高度的部分：先停 3.5 秒读开头，再每多一行花 2.8 秒慢慢往下滚
  const over = p.offsetHeight - view + 4;
  if (over > 0) {
    readTimer = setTimeout(() => {
      const ms = Math.max(1800, Math.min(9000, (over / line) * 2800));
      setScroll(p.offsetTop + over, ms, true);
    }, 3500);
  }
}

function showDice(roll, seat, targetRef) {
  if (!roll) return;
  const target = tokenRectByRef(targetRef) ?? tokenRectForSeat(seat) ?? state.tokens[0];
  if (!target) return;
  const el = document.createElement('div');
  el.className = 'dice-float';
  const num = document.createElement('div');
  num.className = 'n';
  const tag = document.createElement('div');
  tag.className = 'tag';
  if (roll.kind === 'attack') {
    num.textContent = String(roll.natural ?? roll.total ?? '?');
    tag.textContent = roll.success ? (roll.crit ? '暴击' : '命中') : '未中';
    el.classList.add(roll.success ? (roll.crit ? 'crit' : '') : 'miss');
  } else if (roll.kind === 'damage' || roll.kind === 'heal') {
    num.textContent = String(roll.total ?? '?');
    tag.textContent = roll.kind === 'heal' ? '治疗' : '伤害';
    if (roll.crit) el.classList.add('crit');
  } else {
    num.textContent = String(roll.total ?? roll.natural ?? '?');
    tag.textContent = roll.success === true ? '成功' : roll.success === false ? '失败' : '';
    if (roll.success === false) el.classList.add('miss');
  }
  el.append(num, tag);
  const pos = placeDice(target, { w: 110, h: 72 });
  el.style.left = `${Math.round(pos.x + 55)}px`;
  el.style.top = `${Math.round(pos.y)}px`;
  els.diceLayer.append(el);
  const ttl = state.config?.dice.ttlMs ?? 1500;
  const entry = { rect: { x: pos.x, y: pos.y, w: 110, h: 72 }, until: Date.now() + ttl + 200 };
  activeDice.push(entry);
  setTimeout(() => {
    el.remove();
    const i = activeDice.indexOf(entry);
    if (i >= 0) activeDice.splice(i, 1);
  }, ttl);
}

// 骰子数字不能盖在气泡的字上：在目标棋子的下 / 右 / 左 / 上四个位置里挑一个不压气泡、不压别的骰子的
const activeDice = [];
function placeDice(target, size) {
  const map = state.map;
  const gap = 10;
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  const raw = [
    { x: cx - size.w / 2, y: target.y + target.h + gap },
    { x: target.x + target.w + gap, y: cy - size.h / 2 },
    { x: target.x - size.w - gap, y: cy - size.h / 2 },
    { x: cx - size.w / 2, y: target.y - size.h - gap },
  ].map((c) => ({
    x: Math.max(map.x + 8, Math.min(c.x, map.x + map.w - size.w - 8)),
    y: Math.max(map.y + 8, Math.min(c.y, map.y + map.h - size.h - 8)),
  }));
  const obstacles = [];
  for (const seat of SEATS) {
    for (const kind of ['thought', 'speech']) {
      const slot = state.bubbles[seat]?.[kind];
      if (slot?.rect) obstacles.push(slot.rect);
    }
  }
  const now = Date.now();
  for (const d of activeDice) if (d.until > now) obstacles.push(d.rect);
  let best = raw[0];
  let bestScore = Infinity;
  for (const c of raw) {
    const r = { x: c.x, y: c.y, w: size.w, h: size.h };
    const score = obstacles.reduce((sum, o) => {
      if (!intersects(r, o, 4)) return sum;
      return sum + (Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x)) * (Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y)) + 1;
    }, 0);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------- 事件
function handleState(data) {
  if (!data) return;
  if (Array.isArray(data.players)) {
    state.players = {};
    for (const p of data.players) state.players[p.seat] = p;
  }
  if (Array.isArray(data.initiative)) state.initiative = data.initiative;
  if (typeof data.round === 'number') state.round = data.round;
  if (data.beats && typeof data.beats.total === 'number') state.beats = data.beats;
  if (typeof data.combat === 'boolean') state.combat = data.combat;
  if (typeof data.scene === 'string') state.scene = data.scene;
  if (typeof data.adventure === 'string' && data.adventure) state.adventure = data.adventure;
  if (typeof data.activeSeat === 'string') state.activeSeat = data.activeSeat;
  else if (data.activeSeat === null && state.combat) state.activeSeat = null;
  if (typeof data.narration === 'string') setNarration(data.narration);
  if (DEMO) {
    // 演示只用于压力测试，不接收真实桌面状态
    return;
  }
  renderParty();
  relayoutAll();
  postReport();
}

function handleEvent(ev) {
  if (!ev || !ev.kind) return;
  state.lastSeq = Math.max(state.lastSeq, ev.seq ?? 0);
  const data = ev.data ?? {};
  state.eventCounts[ev.kind] = (state.eventCounts[ev.kind] ?? 0) + 1;
  switch (ev.kind) {
    case 'state':
      handleState(data);
      break;
    case 'round':
      if (typeof data.round === 'number') state.round = data.round;
      if (Array.isArray(data.roster)) state.initiative = data.roster;
      if (!DEMO) {
        renderParty();
        pulseRound();
      }
      break;
    case 'gm_narration':
      setNarration(data.text ?? ev.text);
      break;
    case 'thinking':
      if (data.seat) {
        state.thinkingSeat = data.seat;
        showThinking(data.seat);
      }
      break;
    case 'thought':
      if (state.thinkingSeat === data.seat) state.thinkingSeat = null;
      showThought(data);
      break;
    case 'decision':
      if (state.thinkingSeat === data.seat) state.thinkingSeat = null;
      if (data.seat) showSpeech(data.seat, data.say);
      break;
    case 'roll':
      showDice(data.roll, data.seat, data.roll?.targetId ?? data.roll?.targetName ?? data.targetId ?? data.targetName);
      break;
    case 'turn':
      if (data.seat) {
        state.activeSeat = data.seat;
        applyActive();
      }
      break;
    case 'scene':
      if (data.title) {
        state.scene = data.title;
        renderParty();
      }
      break;
    case 'xp':
      for (const g of Array.isArray(data.gains) ? data.gains : []) {
        if (g && g.gained > 0) showToast(g.seat, `+${g.gained} 经验`, 'xp');
      }
      break;
    case 'level_up':
      showToast(data.seat, `升级！Lv ${data.level}`, 'level');
      break;
    case 'loot':
      // 拿到东西 / 钱才弹；付出、用掉的只在桌面记录里（面板上的金币数会跟着变）
      if (data.kind === 'item') showToast(data.seat, `获得 ${data.name}${data.qty > 1 ? ` ×${data.qty}` : ''}`, 'loot');
      if (data.kind === 'gold') for (const g of Array.isArray(data.gains) ? data.gains : []) showToast(g.seat, `+${g.label}`, 'loot');
      break;
    case 'tts':
      enqueueTts(ev);
      break;
    case 'combat_start':
    case 'combat_end':
    case 'move':
    case 'contrast':
    case 'thought_beat':
      // 画面不显示细节；位置/先攻由 token-positions 与 state 事件更新
      break;
    default:
      break;
  }
  postReport();
}

// 角色卡上浮出来的小提示（分到经验 / 升级）。几秒后自己消失；同一张卡上的叠在一起，新的在上面
const TOAST_MS = 6000;
function showToast(seat, text, kind) {
  const c = cards[seat];
  if (!c) return;
  const portrait = c.card.querySelector('.portrait');
  if (!portrait) return;
  let box = portrait.querySelector('.toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts';
    portrait.append(box);
  }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  box.append(el);
  if (HOLD) {
    el.classList.add('hold'); // 预览时一直留着
    return;
  }
  const gone = () => el.remove();
  el.addEventListener('animationend', gone);
  setTimeout(gone, TOAST_MS + 500); // 页面在后台、动画不走时也要清掉
}

function connect() {
  const es = new EventSource('/overlay/events');
  const kinds = [
    'state', 'thinking', 'thought', 'thought_beat', 'decision', 'contrast', 'roll', 'move',
    'turn', 'gm_narration', 'scene', 'combat_start', 'combat_end', 'system', 'scene_end', 'pause', 'xp', 'level_up', 'loot', 'tts',
  ];
  for (const kind of kinds) {
    es.addEventListener(kind, (e) => {
      try {
        handleEvent(JSON.parse(e.data));
      } catch {
        /* ignore bad frame */
      }
    });
  }
  es.onerror = () => {
    /* 浏览器自动重连 */
  };
}

// ---------------------------------------------------------------- 演示数据（只做压力测试）
async function loadDemo() {
  els.demoBadge.classList.remove('hidden');
  try {
    const demo = await fetch('/overlay/demo', { cache: 'no-store' }).then((r) => r.json());
    if (demo?.narration) setNarration(params.get('narr') || demo.narration);
    state.adventure = demo?.adventure || state.adventure;
    state.scene = demo?.scene || state.scene;
    state.combat = !!demo?.combat;
    state.round = demo?.round || 1;
    state.initiative = demo?.initiative || [];
    // 预览用：?combat=1 假装在战斗并放一条 6 人先攻条，看标题行右边的先攻条会不会被立绘盖住
    if (params.get('combat') === '1') {
      state.combat = true;
      state.round = 2;
      state.initiative = [
        { name: '维斯坡伊', seat: 'player_a', initiative: 17, current: true },
        { name: '鱼人', seat: null, initiative: 14 },
        { name: '萨珀特菲', seat: 'player_b', initiative: 12 },
        { name: '鱼人', seat: null, initiative: 9 },
        { name: '哥布林', seat: null, initiative: 8 },
        { name: '狼', seat: null, initiative: 5 },
      ];
    }
    // 预览用：?roster=explore 假装在探索第 3 轮：A 已行动、下一位是 B、狼和暮色（环境）还在后面；?roster=world 世界回合进行中
    if (params.get('beats')) {
      const [d, t] = String(params.get('beats')).split('/').map(Number);
      state.beats = { done: d || 0, total: t || 0 };
    }
    if (params.get('roster')) {
      const world = params.get('roster') === 'world';
      state.combat = false;
      state.round = 3;
      state.initiative = [
        { name: '维斯坡伊', seat: 'player_a', kind: 'pc', done: true, current: false },
        { name: '萨珀特菲', seat: 'player_b', kind: 'pc', done: world, current: !world },
        { name: '饿狼', seat: null, kind: 'monster', done: false, current: false },
        { name: '暮色', seat: null, kind: 'env', done: world, current: false },
      ];
    }
    state.activeSeat = params.get('active') || demo?.activeSeat || null;
    state.thinkingSeat = params.get('thinking') || null;
    for (const seat of SEATS) {
      const t = demo?.[seat];
      if (!t) continue;
      state.players[seat] = {
        seat,
        name: t.name,
        role: t.role ?? '',
        hp: t.hp ?? 1,
        maxHp: t.maxHp ?? 1,
        ac: t.ac ?? null,
        gold: t.gold ?? '',
        conditions: t.conditions ?? [],
        tags: t.tags,
        expression: t.expression ?? 'neutral',
      };
      // 预览用：?hp_a=9 / ?hp_b=0 / ?cond_a=祝福术,中毒 直接改面板上的数字，不用等真实对局
      const short = seat === 'player_a' ? 'a' : 'b';
      if (params.has(`hp_${short}`)) state.players[seat].hp = Number(params.get(`hp_${short}`));
      // ?gold_a=9 gp 3 sp 直接改面板上的金币标签
      if (params.has(`gold_${short}`)) state.players[seat].gold = String(params.get(`gold_${short}`));
      // 标签前面写 + 是增益、- 是负面、不写是中性；前面加 * 表示专注：?cond_a=+*祝福术,+狂暴,-中毒
      if (params.has(`cond_${short}`)) {
        state.players[seat].tags = String(params.get(`cond_${short}`))
          .split(',')
          .filter(Boolean)
          .map((raw) => {
            const kind = raw.startsWith('+') ? 'buff' : raw.startsWith('-') ? 'debuff' : 'neutral';
            const rest = /^[+-]/.test(raw) ? raw.slice(1) : raw;
            return { text: rest.replace(/^\*/, ''), kind, ...(rest.startsWith('*') ? { conc: true } : {}) };
          });
      }
      if (t.bubble) showThought({ seat, bubble: t.bubble, bubbleValid: true });
      if (t.say) showSpeech(seat, t.say);
    }
    if (params.get('active')) state.activeSeat = params.get('active');
    renderParty();
    // 预览用：?toast=1 立刻在两张卡上各弹一次「+经验」和「升级」提示（hold=1 时一直留着方便截图）
    if (params.get('toast')) {
      for (const seat of SEATS) showToast(seat, '+75 经验', 'xp');
      showToast('player_a', '升级！Lv 4', 'level');
      showToast('player_b', '获得 矮人银衣扣', 'loot');
      showToast('player_a', '+4 gp 5 sp', 'loot');
    }
  } catch {
    /* 没有日志时保持空白 */
  }
}

// ---------------------------------------------------------------- 自检报告
let reportTimer = null;
function postReport() {
  if (reportTimer) return;
  reportTimer = setTimeout(() => {
    reportTimer = null;
    postReportNow();
  }, 160);
}

function bubbleRect(slot) {
  return slot.rect ? { ...slot.rect } : null;
}

function checkBubble(slot, token) {
  const problems = [];
  if (!slot.rect) {
    problems.push('no-rect');
    return problems;
  }
  if (!token) problems.push('no-token');
  const map = state.map;
  const streamer = state.config?.layout.streamer;
  const subtitle = state.config?.layout.subtitle;
  const r = slot.rect;
  if (r.x < map.x - 2 || r.y < map.y - 2 || r.x + r.w > map.x + map.w + 2 || r.y + r.h > map.y + map.h + 2) problems.push('outside-map');
  if (streamer && r.x + r.w > streamer.x + 1) problems.push('into-streamer');
  if (subtitle && r.y + r.h > subtitle.y - 2) problems.push('over-subtitle');
  if (isOver(slot.el)) problems.push('clipped');
  if (slot.kind === 'thought' && slot.valid === false) problems.push('not-first-person');
  if (token && slot.tailTip) {
    const d = Math.max(
      token.x - slot.tailTip.x,
      slot.tailTip.x - (token.x + token.w),
      token.y - slot.tailTip.y,
      slot.tailTip.y - (token.y + token.h),
      0
    );
    if (d > 24) problems.push(`tail-${Math.round(d)}px`);
  }
  return problems;
}

/** 两个面板里有没有东西溢出 / 被裁（卡片横向溢出、名字被挤掉等） */
function panelReport() {
  const out = { party: {}, story: {} };
  for (const seat of SEATS) {
    const c = cards[seat];
    out.party[seat] = {
      overflow: isOver(c.card) || isOver(c.card.querySelector('.vitals')),
      name: c.name.textContent,
      hp: c.num.textContent,
      sprite: c.sprite.classList.contains('ready'),
      active: c.card.classList.contains('active'),
    };
  }
  out.story = {
    chapter: els.chapter.textContent,
    where: els.where.textContent,
    paragraphs: els.log.children.length,
    lines: state.narrationLines ?? 0,
    headOverflow: isOver(els.subtitle.querySelector('.panel-head')),
  };
  return out;
}

function postReportNow() {
  if (!state.config) return;
  const bubbles = [];
  const problems = [];
  for (const seat of SEATS) {
    for (const kind of ['thought', 'speech']) {
      const slot = state.bubbles[seat]?.[kind];
      if (!slot || !slot.rect) continue;
      const token = tokenRectForSeat(seat);
      const local = checkBubble(slot, token);
      if (local.length) problems.push({ seat, kind, problems: local });
      bubbles.push({
        seat,
        kind,
        text: slot.el.textContent,
        fullText: slot.fullText,
        rect: bubbleRect(slot),
        tailTip: slot.tailTip,
        placement: slot.placement,
        token: token ? { id: token.id, x: token.x, y: token.y, w: token.w, h: token.h } : null,
        valid: slot.valid !== false,
        overflow: isOver(slot.el),
      });
    }
  }
  // 气泡两两不重叠
  for (let i = 0; i < bubbles.length; i++) {
    for (let j = i + 1; j < bubbles.length; j++) {
      if (intersects(bubbles[i].rect, bubbles[j].rect, 0)) {
        problems.push({ seat: bubbles[i].seat, kind: bubbles[i].kind, overlap: `${bubbles[j].seat}/${bubbles[j].kind}` });
      }
    }
  }
  const report = {
    type: 'trpg-overlay-report',
    at: Date.now(),
    url: location.href,
    layout: 'v2',
    seq: state.lastSeq,
    demo: DEMO,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    stage: (() => {
      const r = stage.getBoundingClientRect();
      return { x: r.x / (r.width / 1920), y: r.y / (r.height / 1080), scale: r.width / 1920 };
    })(),
    map: state.map ?? state.config.layout.map,
    streamer: state.config.layout.streamer,
    dice: [...els.diceLayer.children].map((d) => {
      const r = d.getBoundingClientRect();
      const scale = stage.getBoundingClientRect().width / 1920 || 1;
      const s0 = stage.getBoundingClientRect();
      return { text: d.textContent, x: Math.round((r.x - s0.x) / scale), y: Math.round((r.y - s0.y) / scale), w: Math.round(r.width / scale), h: Math.round(r.height / scale) };
    }),
    narrationLines: state.narrationLines ?? 0,
    panels: panelReport(),
    streamerText: els.streamer.innerText.trim(),
    streamerChildren: els.streamer.childElementCount,
    subtitle: state.config.layout.subtitle,
    characters: state.config.layout.characters,
    tokens: state.tokens,
    bubbles,
    checks: { problems },
    ok: problems.length === 0,
  };
  try {
    parent.postMessage(report, '*');
  } catch {
    /* standalone */
  }
  window.__overlayReport = report;
}

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || typeof d !== 'object') return;
  if (d.type === 'trpg-token-positions') receiveTokenPositions(d);
  if (d.type === 'trpg-overlay-report-request') postReport();
});

// ---------------------------------------------------------------- 启动
(async () => {
  await applyConfig();
  await loadSprites();
  setInterval(loadSprites, 5000);
  if (DEMO) {
    await loadDemo();
  } else {
    connect();
  }
  fit();
  window.addEventListener('resize', fit);
  setInterval(postReport, 1500);
  postReport();
  try {
    parent.postMessage({ type: 'trpg-overlay-ready' }, '*');
  } catch {
    /* standalone */
  }
})();
