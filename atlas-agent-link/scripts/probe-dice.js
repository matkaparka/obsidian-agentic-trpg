(async () => {
  const leaf = app.workspace.getLeavesOfType('atlas-vtt-local-player')[0];
  const doc = leaf?.view?.containerEl?.ownerDocument;
  const win = doc?.defaultView;
  const dice = doc?.querySelector('.atlas-player-dice-rolls');
  const describe = (el, depth = 0) => {
    const rect = el.getBoundingClientRect();
    const cs = win.getComputedStyle(el);
    return {
      tag: el.tagName,
      cls: typeof el.className === 'string' ? el.className : '',
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      pos: cs.position,
      z: cs.zIndex,
      display: cs.display,
      text: (el.textContent || '').slice(0, 80),
      children: depth < 3 ? Array.from(el.children).map((c) => describe(c, depth + 1)) : undefined,
    };
  };
  return { dice: describe(dice), html: dice?.innerHTML.slice(0, 1500) };
})()
