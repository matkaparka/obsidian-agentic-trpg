/**
 * Dumps the live Atlas store state as a test fixture (functions stripped, cycles broken).
 * Output is JSON on stdout: `node cdp.mjs --file scripts/dump-state.js > test/fixtures/scene-snapshot.json`.
 */
(async () => {
  const view = app.workspace.getLeavesOfType('atlas-vtt').find((l) => {
    const s = l.view.getStore().getState();
    return s.mapPath === 'scenes/e2e.atlasmap';
  }) ?? app.workspace.getLeavesOfType('atlas-vtt')[0];
  const state = view.view.getStore().getState();
  const seen = new WeakSet();
  const walk = (v, d) => {
    if (typeof v === 'function' || typeof v === 'symbol' || v === undefined) return undefined;
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return '[circular]';
    if (d > 6) return '[deep]';
    seen.add(v);
    if (Array.isArray(v)) return v.map((x) => walk(x, d + 1));
    const out = {};
    for (const key of Object.keys(v)) {
      if (key === 'plugin' || key === 'viewId' || key === 'eventBus') continue;
      const w = walk(v[key], d + 1);
      if (w !== undefined) out[key] = w;
    }
    return out;
  };
  return JSON.stringify({
    fixture: 'atlas-vtt 0.8.0 live store state, captured through AtlasView.getStore().getState()',
    capturedAt: new Date().toISOString(),
    atlasVersion: app.plugins.plugins['atlas-vtt']?.manifest?.version ?? null,
    obsidianVersion: app.manifest?.version ?? null,
    state: walk(state, 0),
  }, null, 1);
})()
