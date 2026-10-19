(async () => {
  const log = [];
  const step = async (name, fn) => {
    try { log.push({ step: name, ok: true, value: await fn() }); }
    catch (e) { log.push({ step: name, ok: false, error: String(e?.message ?? e).slice(0, 300) }); }
  };

  await step('loadManifests', () => app.plugins.loadManifests());
  await step('setEnable(true)', () => app.plugins.setEnable(true));
  await step('enable atlas-vtt', () => app.plugins.enablePluginAndSave('atlas-vtt'));
  await step('enable atlas-agent-link', () => app.plugins.enablePluginAndSave('atlas-agent-link'));

  return {
    log,
    loaded: Object.keys(app.plugins.plugins ?? {}),
    enabledSet: app.plugins.enabledPlugins ? [...app.plugins.enabledPlugins] : null,
  };
})()
