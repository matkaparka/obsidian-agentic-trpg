// Call one Atlas MCP tool from the command line (dev/test helper).
// Usage: node scripts/atlas-call.mjs <tool> [argsJsonFileOrInline]
// Reads the bearer token from campaign-vault's plugin data.json; never prints it.
import { readFileSync, existsSync } from 'node:fs';

const [tool, rawArgs] = process.argv.slice(2);
if (!tool) {
  console.error('usage: node scripts/atlas-call.mjs <tool> [argsJson|@file]');
  process.exit(2);
}
const dataPath = new URL('../../campaign-vault/.obsidian/plugins/atlas-agent-link/data.json', import.meta.url);
const token = JSON.parse(readFileSync(dataPath, 'utf8')).token;
let args = {};
if (rawArgs) {
  args = rawArgs.startsWith('@') ? JSON.parse(readFileSync(rawArgs.slice(1), 'utf8')) : JSON.parse(rawArgs);
}
const res = await fetch('http://127.0.0.1:27125/mcp', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
});
const body = await res.json();
const content = body?.result?.content ?? body?.error ?? body;
if (Array.isArray(content)) {
  for (const c of content) {
    if (c.type === 'text') {
      try {
        console.log(JSON.stringify(JSON.parse(c.text), null, 2));
      } catch {
        console.log(c.text);
      }
    } else if (c.type === 'image') {
      console.log(`[image ${c.mimeType} ${Math.round((c.data?.length ?? 0) * 0.75)} bytes]`);
    }
  }
} else {
  console.log(JSON.stringify(content, null, 2));
}
process.exitCode = res.ok ? 0 : 1;
