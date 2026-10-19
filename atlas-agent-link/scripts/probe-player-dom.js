(async () => {
  const leaf = app.workspace.getLeavesOfType('atlas-vtt-local-player')[0];
  const doc = leaf?.view?.containerEl?.ownerDocument;
  const win = doc?.defaultView;
  const content = doc?.querySelector('.atlas-local-player-content');
  const describe = (el, depth = 0) => {
    const rect = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      cls: typeof el.className === 'string' ? el.className : '',
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      pos: win.getComputedStyle(el).position,
      z: win.getComputedStyle(el).zIndex,
      display: win.getComputedStyle(el).display,
      children: depth < 2 ? Array.from(el.children).slice(0, 8).map((c) => describe(c, depth + 1)) : undefined,
    };
  };
  return {
    body: describe(doc.body),
    content: describe(content),
    initiative: describe(doc.querySelector('.atlas-player-initiative-container')),
    dice: describe(doc.querySelector('.atlas-player-dice-rolls')),
    contentHTML: content?.innerHTML.slice(0, 1200),
  };
})()
