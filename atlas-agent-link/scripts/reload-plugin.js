(async () => {
  const id = 'atlas-agent-link';
  const log = [];
  const step = async (name, fn) => {
    try { log.push({ step: name, ok: true, value: await fn() }); }
    catch (e) { log.push({ step: name, ok: false, error: String(e?.message ?? e).slice(0, 300) }); }
  };
  await step('disable', () => app.plugins.disablePluginAndSave(id));
  await step('enable', () => app.plugins.enablePluginAndSave(id));
  await new Promise((r) => setTimeout(r, 1500));
  await step('settings', () => {
    const p = app.plugins.plugins[id];
    return { version: p?.manifest?.version, allowWrite: p?.settings?.allowWrite, port: p?.settings?.port, server: !!p?.server };
  });
  await step('scenes', () => ({
    atlasLeaves: app.workspace.getLeavesOfType('atlas-vtt').length,
    loaded: app.workspace.getLeavesOfType('atlas-vtt').map((l) => { const s = l.view.getStore().getState(); return { mapPath: s.mapPath, mapLoaded: s.mapLoaded }; }),
  }));
  return log;
})()
