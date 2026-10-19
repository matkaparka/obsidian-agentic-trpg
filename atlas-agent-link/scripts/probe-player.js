(async () => {
  const leaves = app.workspace.getLeavesOfType('atlas-vtt-local-player');
  const leaf = leaves[0];
  const view = leaf?.view;
  const doc = view?.containerEl?.ownerDocument;
  const win = doc?.defaultView;
  const content = doc?.querySelector('.atlas-local-player-content');
  const initiative = doc?.querySelector('.atlas-player-initiative-container');
  const dice = doc?.querySelector('.atlas-player-dice-rolls');
  const atlasView = app.workspace.getLeavesOfType('atlas-vtt')[0]?.view;
  const state = atlasView?.getStore()?.getState();
  let bg = null;
  if (state?.background) {
    const url = app.vault.adapter.getResourcePath(state.background);
    bg = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ path: state.background, url, w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ path: state.background, url, error: 'load failed' });
      img.src = url;
    });
  }
  const rect = (el) => (el ? (({ x, y, width, height }) => ({ x, y, width, height }))(el.getBoundingClientRect()) : null);
  const chain = [];
  for (let el = content; el && chain.length < 6; el = el.parentElement) {
    chain.push({ tag: el.tagName, cls: el.className, ...rect(el), cssText: el.getAttribute('style') });
  }
  return {
    leaves: leaves.length,
    title: doc?.title,
    bodyClass: doc?.body?.className,
    inner: win ? { w: win.innerWidth, h: win.innerHeight, outerW: win.outerWidth, outerH: win.outerHeight, dpr: win.devicePixelRatio } : null,
    content: rect(content),
    contentStyle: content?.getAttribute('style') ?? null,
    canvas: (() => { const c = content?.querySelector('canvas'); return c ? { ...rect(c), w: c.width, h: c.height } : null; })(),
    initiative: { el: !!initiative, ...rect(initiative), display: initiative ? win.getComputedStyle(initiative).display : null },
    dice: { el: !!dice, ...rect(dice), display: dice ? win.getComputedStyle(dice).display : null },
    chain,
    map: { background: state?.background ?? null, bg, camera: state?.camera ?? null, grid: state?.grid ?? null, mapPath: state?.mapPath ?? null },
    presented: app.plugins.plugins['atlas-vtt']?.presentedScene?.scene ?? null,
  };
})()
