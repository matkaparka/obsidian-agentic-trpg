(async () => {
  const req = typeof require === 'function' ? require : globalThis.require;
  const remote = req('electron').remote;
  const cur = remote.getCurrentWindow();
  const wins = remote.BrowserWindow.getAllWindows().map((w) => ({ id: w.id, title: w.getTitle(), bounds: w.getBounds(), content: w.getContentSize() }));
  return {
    screen: remote.screen.getPrimaryDisplay().workAreaSize,
    scaleFactor: remote.screen.getPrimaryDisplay().scaleFactor,
    current: { id: cur.id, content: cur.getContentSize(), bounds: cur.getBounds() },
    windows: wins,
  };
})()
