// Downloads the Atlas VTT 0.8.0 release plugin files and its source tarball.
// Uses Node's fetch (OpenSSL) because schannel-backed curl/git cannot get TLS
// credentials inside this sandbox.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'downloads');
const TAG = '0.8.0';
const RELEASE_DIR = path.join(OUT, `atlas-${TAG}`);
const ASSETS = [
  { name: 'main.js', url: `https://github.com/atlas-vtt/atlas-vtt/releases/download/${TAG}/main.js`, sha256: '1faabb788df8e240b5538f48a2fce1b20a19ed44b664dccb0773b2c4522d37ee' },
  { name: 'manifest.json', url: `https://github.com/atlas-vtt/atlas-vtt/releases/download/${TAG}/manifest.json`, sha256: '5e52740d7d77bba165da05eda7c0f8f370298e9a6f70ce778e270cd7b20ee5fa' },
  { name: 'styles.css', url: `https://github.com/atlas-vtt/atlas-vtt/releases/download/${TAG}/styles.css`, sha256: 'baa02a0dc3433b71645451d3a3d5f7a8439348f0959600c528a586aec5d81801' },
];

async function get(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

await mkdir(RELEASE_DIR, { recursive: true });

for (const a of ASSETS) {
  const buf = await get(a.url);
  const sha = createHash('sha256').update(buf).digest('hex');
  const ok = sha === a.sha256;
  await writeFile(path.join(RELEASE_DIR, a.name), buf);
  console.log(`asset ${a.name} bytes=${buf.length} sha256=${sha} ${ok ? 'MATCH' : 'MISMATCH expected ' + a.sha256}`);
}

const srcUrl = `https://codeload.github.com/atlas-vtt/atlas-vtt/tar.gz/refs/tags/${TAG}`;
try {
  const tar = await get(srcUrl);
  const tarPath = path.join(OUT, `atlas-vtt-${TAG}-src.tar.gz`);
  await writeFile(tarPath, tar);
  console.log(`source tar.gz bytes=${tar.length} -> ${tarPath}`);
} catch (e) {
  console.log(`source download FAILED: ${e.message}`);
}

console.log('DONE');
