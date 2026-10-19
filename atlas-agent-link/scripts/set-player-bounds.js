(async () => {
  const req = typeof require === 'function' ? require : globalThis.require;
  const remote = req('electron').remote;
  const win = remote.BrowserWindow.getAllWindows().find((w) => /Player view|Atlas player view/i.test(String(w.getTitle?.() ?? '')));
  if (!win) return { error: 'no player window' };
  const before = { bounds: win.getBounds(), content: win.getContentSize() };
  win.setBounds({ x: 341, y: 109, width: 1024, height: 802 });
  await new Promise((r) => setTimeout(r, 500));
  return { before, after: { bounds: win.getBounds(), content: win.getContentSize() } };
})()
