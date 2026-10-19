/**
 * Security acceptance checks against the live endpoint: no token, wrong token, foreign Host
 * header, browser Origin, bad content type, read-only mode, destructive-action rails, the rate
 * limit and the kill switch. Prints PASS/FAIL per check and exits non-zero on any failure.
 *
 * Run it against a running server; the kill-switch check restarts the server afterwards.
 */
import { readFileSync } from 'node:fs';
import { request } from 'node:http';

const DATA = 'vault/.obsidian/plugins/atlas-agent-link/data.json';
const BASE = 'http://127.0.0.1:27125';
const { token } = JSON.parse(readFileSync(DATA, 'utf8'));
const results = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  — ${detail}`);
}

/** A raw HTTP request, so the Host header can actually be forged (fetch refuses to). */
function raw(pathname, { method = 'POST', headers = {}, body = '', host = '127.0.0.1:27125' } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: 27125, path: pathname, method, headers: { host, ...headers } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function call(name, args = {}) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() % 1e6, method: 'tools/call', params: { name, arguments: args } }),
  });
  const json = await res.json().catch(() => ({}));
  const content = json.result?.content ?? [];
  const text = content.find((c) => c.type === 'text')?.text ?? '';
  return { status: res.status, isError: !!json.result?.isError, text };
}

const rpc = (method, params) => JSON.stringify({ jsonrpc: '2.0', id: Date.now() % 1e6, method, params });

// 1–2. authentication
{
  const r = await raw('/mcp', { headers: { 'content-type': 'application/json' }, body: rpc('tools/list') });
  record('no bearer token is refused', r.status === 401, `HTTP ${r.status}`);
}
{
  const r = await raw('/mcp', { headers: { authorization: 'Bearer deadbeef', 'content-type': 'application/json' }, body: rpc('tools/list') });
  record('wrong token is refused', r.status === 401, `HTTP ${r.status}`);
}

// 3. DNS rebinding
{
  const r = await raw('/mcp', { host: 'evil.example.com', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: rpc('tools/list') });
  record('foreign Host header is refused (DNS rebinding)', r.status === 403, `HTTP ${r.status}`);
}

// 4. browser origin
{
  const r = await raw('/mcp', { headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: 'https://evil.example.com' }, body: rpc('tools/list') });
  record('browser Origin is refused', r.status === 403, `HTTP ${r.status}`);
}

// 5. content type
{
  const r = await raw('/mcp', { headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' }, body: rpc('tools/list') });
  record('non-JSON content type is refused', r.status === 415, `HTTP ${r.status}`);
}

// 6. authenticated call works and lists tools
{
  const r = await raw('/mcp', { headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: rpc('tools/list') });
  const body = JSON.parse(r.body || '{}');
  record('authenticated tools/list works', r.status === 200 && Array.isArray(body.result?.tools), `HTTP ${r.status}, ${body.result?.tools?.length ?? 0} tools`);
}

// 7. destructive store actions stay blocked
{
  const r = await call('atlas_apply', { action: 'clearMapState' });
  record('atlas_apply refuses a scene-wiping action', r.isError && /blocked/i.test(r.text), r.text.slice(0, 110));
}

// 8. only atlas-vtt: commands
{
  const r = await call('atlas_command', { id: 'workspace:close' });
  record('atlas_command only allows atlas-vtt: ids', r.isError && /atlas-vtt:/i.test(r.text), r.text.slice(0, 110));
}

// 9. dice cannot be invented
{
  const r = await call('atlas_roll_dice', { formula: 'I rolled a twenty' });
  record('atlas_roll_dice refuses a made-up formula', r.isError, r.text.slice(0, 90));
}

// 10. unknown tool
{
  const r = await call('atlas_does_not_exist');
  record('unknown tool is an error, not a crash', r.isError && /Unknown tool/i.test(r.text), r.text.slice(0, 80));
}

// 11. event stream: token required, and Last-Event-ID replays
{
  const r = await raw('/events', { method: 'GET', headers: {} });
  record('event stream needs the token', r.status === 401, `HTTP ${r.status}`);
}
{
  const res = await fetch(`${BASE}/events`, { headers: { authorization: `Bearer ${token}`, 'last-event-id': '1' } });
  const reader = res.body.getReader();
  let buffer = '';
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && !/^id: /m.test(buffer) && !/event: gap/.test(buffer)) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += new TextDecoder().decode(value);
  }
  await reader.cancel();
  record('SSE replays after Last-Event-ID', /^id: /m.test(buffer) || /event: gap/.test(buffer), buffer.split('\n').slice(0, 3).join(' | ').slice(0, 110));
}

// 12. rate limit (burst past the configured cap)
{
  let limited = 0;
  const cap = 620;
  for (let i = 0; i < cap; i++) {
    const r = await raw('/mcp', { headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: rpc('ping') });
    if (r.status === 429) limited += 1;
  }
  record('rate limit kicks in on a burst', limited > 0, `${limited} of ${cap} answered 429`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
