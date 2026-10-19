// 规则层 ↔ Atlas 对账：HP、格子位置、先攻顺序、怪物可见性。
// 用法：node scripts/check-atlas-full.mjs [stateFile] [atlasPort]
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const stateFile = opt('--state', 'state/table.json');
const atlasPort = Number(opt('--port', '27125'));
const outPath = opt('--out', '');
const dataPath = new URL('../../campaign-vault/.obsidian/plugins/atlas-agent-link/data.json', import.meta.url);
const token = JSON.parse(readFileSync(dataPath, 'utf8')).token;
const snap = JSON.parse(readFileSync(stateFile, 'utf8'));
const rules = snap.rules ?? {};
const actors = rules.actors ?? [];

const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
const rpc = await fetch(`http://127.0.0.1:${atlasPort}/mcp`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ jsonrpc: '2.0', id: 'check', method: 'tools/call', params: { name: 'atlas_scene_summary', arguments: {} } }),
}).then((r) => r.json());
const scene = JSON.parse(rpc.result.content.find((c) => c.type === 'text').text);
const byName = new Map((scene.tokens ?? []).map((t) => [t.name, t]));
const cellOf = (t) => {
  const c = t?.cell;
  if (!c) return null;
  const col = c.col ?? c.q;
  const row = c.row ?? c.r;
  return typeof col === 'number' && typeof row === 'number' ? { col, row } : null;
};

const rows = [];
let bad = 0;
for (const a of actors) {
  const t = byName.get(a.name);
  if (!t) {
    rows.push({ actor: a.name, ok: false, error: 'Atlas 里没有同名 token' });
    bad += 1;
    continue;
  }
  const hp = t.resources?.hp;
  const hpOk = !hp || (hp.current === Math.max(0, a.hp) && hp.max === a.maxHp);
  const cell = cellOf(t);
  const posOk = !a.position || (cell && cell.col === a.position.col && cell.row === a.position.row);
  const visible = (snap.visibleActorIds ?? []).includes(a.id);
  const hiddenOk = a.kind !== 'monster' || !!t.hidden === !visible;
  const ok = hpOk && posOk && hiddenOk;
  if (!ok) bad += 1;
  rows.push({
    actor: a.name,
    kind: a.kind,
    ok,
    hp: { table: `${a.hp}/${a.maxHp}`, atlas: hp ? `${hp.current}/${hp.max}` : null, ok: hpOk },
    pos: { table: a.position ?? null, atlas: cell, ok: posOk },
    hidden: { table: !visible, atlas: !!t.hidden, ok: hiddenOk },
  });
}

// 先攻顺序：规则层 combat.order vs Atlas initiative.entries（按值排序后比）
let initiative = { ok: true, table: null, atlas: null };
let current = { ok: true, table: null, atlas: null };
if (rules.combat?.active) {
  const table = (rules.combat.order ?? [])
    .map((o) => `${actors.find((a) => a.id === o.actorId)?.name}:${o.initiative}`)
    .sort();
  const atlasEntries = scene.initiative?.entries ?? [];
  const atlas = atlasEntries.map((e) => `${e.name}:${e.initiative}`).sort();
  initiative = { ok: JSON.stringify(table) === JSON.stringify(atlas), table, atlas };
  if (!initiative.ok) bad += 1;

  // Atlas' currentIndex used to lag one actor behind the table after a GM next_turn.
  const tableIndex = rules.combat.index ?? -1;
  const tableActorId = rules.combat.order?.[tableIndex]?.actorId;
  const tableName = actors.find((a) => a.id === tableActorId)?.name ?? null;
  const atlasIndex = scene.initiative?.currentIndex ?? -1;
  const atlasName = atlasEntries[atlasIndex]?.name ?? null;
  const tableRound = rules.combat.round ?? 0;
  const atlasRound = scene.initiative?.round ?? 0;
  const currentOk = atlasIndex === tableIndex && atlasName === tableName && atlasRound === tableRound;
  current = {
    ok: currentOk,
    table: { index: tableIndex, name: tableName, round: tableRound },
    atlas: { index: atlasIndex, name: atlasName, round: atlasRound },
  };
  if (!currentOk) bad += 1;
}

const result = {
  ok: bad === 0,
  scene: { table: snap.sceneId, atlas: scene.mapPath },
  initiative,
  current,
  actors: rows,
  mismatches: bad,
  at: new Date().toISOString(),
};
console.log(JSON.stringify(result, null, 2));
if (outPath) writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
process.exitCode = bad ? 1 : 0;
