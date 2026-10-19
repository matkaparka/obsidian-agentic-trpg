// Minimal MCP client for the Atlas Agent Link HTTP endpoint.
// Usage: node scripts/mcp-client.mjs <method> [paramsJson] [--token <t>] [--url <url>]
//   node scripts/mcp-client.mjs initialize
//   node scripts/mcp-client.mjs tools/call '{"name":"atlas_probe","arguments":{}}'
// Reads the bearer token from the vault plugin's data.json unless --token is given.
import { readFileSync } from 'node:fs';

const DEFAULT_DATA = 'vault/.obsidian/plugins/atlas-agent-link/data.json';
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  if (i < 0) return dflt;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const url = opt('--url', 'http://127.0.0.1:27125/mcp');
const token = opt('--token', '') || JSON.parse(readFileSync(DEFAULT_DATA, 'utf8')).token;
const method = args[0];
const params = args[1] ? JSON.parse(args[1]) : undefined;
if (!method) {
  console.error('usage: node scripts/mcp-client.mjs <method> [paramsJson]');
  process.exit(2);
}

const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now() % 100000, method, params });
const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body,
});
const text = await res.text();
let parsed;
try { parsed = JSON.parse(text); } catch { parsed = text; }
console.log(`HTTP ${res.status}`);
console.log(typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2));

// tools/call results carry their payload as JSON text inside content[0].text; print it decoded too.
const inner = parsed?.result?.content?.[0]?.text;
if (typeof inner === 'string') {
  try { console.log('--- decoded ---'); console.log(JSON.stringify(JSON.parse(inner), null, 2)); } catch { console.log('--- raw ---'); console.log(inner); }
}
