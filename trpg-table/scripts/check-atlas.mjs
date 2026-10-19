// 对账：规则层（trpg-table /status）的玩家 HP vs Atlas 场景里同名 token 的 resources.hp。
// 用法：node scripts/check-atlas.mjs [linkPort] [atlasPort]
import { readFileSync } from 'node:fs';

const linkPort = Number(process.argv[2] ?? 8098);
const atlasPort = Number(process.argv[3] ?? 27125);
const dataPath = new URL('../../campaign-vault/.obsidian/plugins/atlas-agent-link/data.json', import.meta.url);
const token = JSON.parse(readFileSync(dataPath, 'utf8')).token;

const status = await fetch(`http://127.0.0.1:${linkPort}/status`).then((r) => r.json());
const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
const rpc = await fetch(`http://127.0.0.1:${atlasPort}/mcp`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ jsonrpc: '2.0', id: 'check', method: 'tools/call', params: { name: 'atlas_scene_summary', arguments: {} } }),
}).then((r) => r.json());
const scene = JSON.parse(rpc.result.content.find((c) => c.type === 'text').text);

let bad = 0;
for (const p of status.table.players) {
  const t = scene.tokens?.find((x) => x.name === p.name);
  const hp = t?.resources?.hp;
  const ok = hp && hp.current === p.hp && hp.max === p.maxHp;
  if (!ok) bad += 1;
  console.log(`${ok ? 'OK  ' : 'BAD '} ${p.name}: table ${p.hp}/${p.maxHp} | atlas ${hp ? `${hp.current}/${hp.max}` : '无 token/HP'}`);
}
console.log(`scene=${scene.mapPath} tokens=${scene.tokenCount} initiative=${scene.initiative?.isActive ? `round ${scene.initiative.round}` : 'off'} mismatches=${bad}`);
process.exitCode = bad ? 1 : 0;
