(async () => {
  const id = 'atlas-agent-link';
  const out = {};
  try { await app.plugins.loadManifests(); } catch (e) { out.loadManifests = String(e?.message ?? e); }
  await app.plugins.disablePluginAndSave(id);
  await app.plugins.enablePluginAndSave(id);
  await new Promise((r) => setTimeout(r, 1200));
  const p = app.plugins.plugins[id];
  out.manifestVersion = p?.manifest?.version;
  out.allowWriteBefore = p?.settings?.allowWrite;
  // Same effect as the settings toggle / "Toggle AI write access" command.
  p.settings.allowWrite = true;
  await p.saveSettings();
  out.allowWriteAfter = p.settings.allowWrite;
  out.serverRunning = !!p.server;
  out.toolCount = (() => { try { return p.server ? undefined : undefined; } catch { return null; } })();
  return out;
})()
