(async () => {
  const req = typeof require === 'function' ? require : globalThis.require;
  const remote = req('electron').remote;
  const fs = req('node:fs');
  const windows = remote.BrowserWindow.getAllWindows();
  const win = windows.find((w) => /Player view/.test(String(w.getTitle?.() ?? '')));
  if (!win) return { error: 'no player window' };
  const before = { bounds: win.getBounds(), content: win.getContentSize(), onTop: win.isAlwaysOnTop() };
  win.showInactive();
  win.moveTop();
  win.setAlwaysOnTop(true);
  win.setContentSize(1920, 1080);
  await new Promise((r) => setTimeout(r, 1200));
  const img = await win.webContents.capturePage().catch((e) => ({ error: String(e) }));
  if (img?.toPNG) {
    const png = img.toPNG();
    fs.writeFileSync('probe-1920.png', png);
  }
  const size = img?.getSize ? img.getSize() : null;
  const after = { bounds: win.getBounds(), content: win.getContentSize() };
  win.setAlwaysOnTop(before.onTop);
  win.setContentSize(before.content[0], before.content[1]);
  win.setBounds(before.bounds);
  return { before, after, size, bytes: img?.toPNG ? img.toPNG().length : null, err: img?.error ?? null };
})()
