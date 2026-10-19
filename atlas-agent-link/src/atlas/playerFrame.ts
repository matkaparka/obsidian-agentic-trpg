/**
 * The "player frame": turns Atlas' player popout window into the single 1920x1080 picture that
 * the stream captures. The map stays Atlas' own canvas in the middle; a transparent overlay
 * iframe (trpg-table's :8099 page) sits on top and draws the two character columns and the
 * bottom bar. This is a DOM layer on top of Atlas' player view, so every Atlas selector used
 * here is deliberate and local to this file (plus adapter.ts).
 *
 * Verified against Atlas 0.8.0 / Obsidian 1.14.4: the player view is a popout document in the
 * same renderer; `.atlas-local-player-content` is the absolute host of the PIXI canvas, and
 * narrowing it makes Atlas reflow the canvas. The camera needs a separate refit because Atlas
 * does not re-fit the scene when the viewport changes.
 */
import type { App } from 'obsidian';
import { PLAYER_VIEW_TYPE, type AtlasAdapter } from './adapter';

export interface FrameInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PlayerFrameOptions {
  enabled: boolean;
  /** Overlay page, loopback only. */
  url?: string;
  insets?: Partial<FrameInsets>;
  hideAtlasInitiative?: boolean;
  /** Attach Atlas' own dice toast container inside the map; v2 manages dice itself, so hide it. */
  hideAtlasDice?: boolean;
  /** Design size of the whole frame (default 1920x1080). */
  size?: { w: number; h: number };
  /**
   * When the OS work area is smaller than `size`, shrink the window proportionally instead of
   * running partly off-screen. The overlay iframe scales with it, so map and panels shrink
   * together (never one without the other).
   */
  screenFit?: boolean;
  /** Recompute the camera so the whole background fits the map area. */
  refitCamera?: boolean;
  /** Reload the iframe even if the URL is unchanged (overlay server just came up). */
  reload?: boolean;
}

export interface PlayerFrameStatus {
  applied: boolean;
  url?: string;
  contentSize?: { w: number; h: number };
  designScale?: number;
  insets?: FrameInsets;
  camera?: unknown;
  iframeReady?: boolean;
  overlayReport?: unknown;
  windowTitle?: string;
  /** True while the player window is being kept in sync by the main renderer tick. */
  mainBackgroundThrottling?: boolean | null;
  keepAlive?: boolean;
  mainHidden?: boolean;
  error?: string;
}

/** A pixel-level proof that a move actually reached the mirrored player picture. */
export interface FrameCheck {
  checked: boolean;
  updated?: boolean;
  latencyMs?: number;
  diffPixels?: number;
  bbox?: { x: number; y: number; w: number; h: number } | null;
  from?: { col: number; row: number };
  to?: { col: number; row: number };
  expected?: { x: number; y: number; w: number; h: number } | null;
  reason?: string;
}

interface FrameCheckStart {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  w: number;
  h: number;
  baseline: Uint8ClampedArray;
  startedAt: number;
  from: { col: number; row: number };
  to: { col: number; row: number };
  expected: { x: number; y: number; w: number; h: number } | null;
}

const DEFAULT_INSETS: FrameInsets = { left: 0, right: 540, top: 0, bottom: 0 };
const DEFAULT_SIZE = { w: 1920, h: 1080 };
/** Whitelist: only http://127.0.0.1:<port>/... — never an arbitrary page. */
const LOOPBACK_URL = /^http:\/\/127\.0\.0\.1:(\d{1,5})\/.*$/i;

/**
 * Validate the overlay URL. The tool must not be able to load an arbitrary web page into a
 * popout that gets captured live, so this is a strict allowlist rather than a deny list.
 */
export function normalizeOverlayUrl(raw: string): string {
  const value = String(raw ?? '').trim();
  const m = LOOPBACK_URL.exec(value);
  if (!m) throw new Error(`url must be loopback http://127.0.0.1:<port>/… (got ${value.slice(0, 120)})`);
  const port = Number(m[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`url port is out of range: ${m[1]}`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('url is not a valid URL');
  }
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error('url must be http://127.0.0.1:<port>/');
  if (parsed.username || parsed.password) throw new Error('url must not carry credentials');
  if (!parsed.pathname.startsWith('/')) throw new Error('url must point at a path');
  // One canonical form: no fragment (the iframe never uses it), keep query for ?bg=transparent.
  parsed.hash = '';
  return parsed.toString();
}

/** Window content size: exact design size when it fits, else a uniform proportional shrink. */
export function fitContentSize(
  size: { w: number; h: number },
  workArea: { width: number; height: number } | null,
  screenFit: boolean
): { w: number; h: number; scale: number } {
  const design = { w: Math.max(320, Math.round(size.w)), h: Math.max(180, Math.round(size.h)) };
  if (!screenFit || !workArea || !workArea.width || !workArea.height) {
    return { ...design, scale: 1 };
  }
  const k = Math.min(1, workArea.width / design.w, workArea.height / design.h);
  if (k >= 1) return { ...design, scale: 1 };
  const w = Math.max(320, Math.round(design.w * k));
  const h = Math.max(180, Math.round((w * design.h) / design.w));
  return { w, h, scale: w / design.w };
}

function electronRemote(): any {
  const req = typeof require === 'function' ? require : (globalThis as any).require;
  if (!req) throw new Error('No CommonJS require() in this window: cannot reach Electron.');
  const mod = req('electron');
  if (!mod?.remote) throw new Error('Electron remote module unavailable (desktop only).');
  return mod.remote;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface ActiveFrame {
  doc: Document;
  win: any;
  browserWindow: any;
  content: HTMLElement;
  contentStyle: string | null;
  initiative: HTMLElement | null;
  initiativeStyle: string | null;
  dice: HTMLElement | null;
  diceStyle: string | null;
  root: HTMLElement;
  iframe: HTMLIFrameElement;
  url: string;
  contentSize: { w: number; h: number };
  designScale: number;
  insets: FrameInsets;
  originalContentSize: [number, number];
  /** Full window bounds: restoring only the content size fails when the window sits near the
   *  screen edge (Windows clamps the width so the window fits). */
  originalBounds: { x: number; y: number; width: number; height: number };
  originalBackgroundThrottling: boolean | null;
  originalCamera: unknown;
  /** Main Obsidian window: Atlas mirrors the player canvas from its renderer, so it must
   *  keep rendering while the GM covers or minimises it. */
  mainWindow: any;
  originalMainBackgroundThrottling: boolean | null;
  keepAliveId: number | null;
  lastKickAt: number;
  lastKickError: string | null;
  /** 1920-design width of the map region, used to convert canvas pixels for the iframe. */
  mapDesignWidth: number;
  mapDesignHeight: number;
  lastTokenPostAt: number;
  lastSeen: number;
  iframeReady: boolean;
  report: unknown;
  refitTimer: any;
  detachDoc: (() => void) | null;
}

/**
 * Owns the injected frame. One instance per plugin; `apply()` is idempotent and `ensure()`
 * re-applies after the player window is closed/reopened or the overlay server restarts.
 */
export class PlayerFrameController {
  private active: ActiveFrame | null = null;
  private lastOptions: (PlayerFrameOptions & { url: string; insets: FrameInsets }) | null = null;
  private ensureTimer: any = null;
  private layoutOff: (() => void) | null = null;

  constructor(
    private readonly app: App,
    private readonly atlas: AtlasAdapter
  ) {}

  install(): void {
    if (this.ensureTimer) return;
    // A popout that is closed and reopened creates a new document; re-inject on workspace churn.
    const onLayout = () => {
      void this.ensure().catch(() => undefined);
    };
    this.app.workspace.on('layout-change', onLayout);
    this.app.workspace.on('active-leaf-change', onLayout);
    this.layoutOff = () => {
      try {
        this.app.workspace.off('layout-change', onLayout as any);
        this.app.workspace.off('active-leaf-change', onLayout as any);
      } catch {
        /* plugin unloading */
      }
    };
    this.ensureTimer = setInterval(() => void this.ensure().catch(() => undefined), 4000);
    this.ensureTimer?.unref?.();
  }

  dispose(): void {
    if (this.ensureTimer) clearInterval(this.ensureTimer);
    this.ensureTimer = null;
    this.layoutOff?.();
    this.layoutOff = null;
    void this.clear().catch(() => undefined);
  }

  /** Re-apply the last frame if it is supposed to be on and the popout lost our DOM. */
  async ensure(): Promise<void> {
    if (!this.active || !this.lastOptions) return;
    const st = this.active;
    if (!st.doc.body?.isConnected || !st.content.isConnected) {
      this.active = null;
      await this.apply(this.lastOptions).catch(() => undefined);
      return;
    }
    if (!st.root.isConnected) {
      st.doc.body.appendChild(st.root);
    }
    // Obsidian restores a popout's saved bounds after we set them; re-assert the fixed frame size.
    try {
      const [w, h] = st.browserWindow.getContentSize() as [number, number];
      if (w !== st.contentSize.w || h !== st.contentSize.h) {
        const opts = this.lastOptions;
        if (opts) await this.restyle(st, opts.url, opts.insets, opts.size ?? DEFAULT_SIZE, opts);
      }
    } catch {
      /* window may be closing */
    }
    // Overlay page died / server restarted: the message watchdog reloads it.
    if (Date.now() - st.lastSeen > 15_000) {
      st.lastSeen = Date.now();
      this.reloadIframe(st);
    }
  }

  status(): PlayerFrameStatus {
    const st = this.active;
    if (!st) return { applied: false };
    return {
      applied: true,
      url: st.url,
      contentSize: st.contentSize,
      designScale: st.designScale,
      insets: st.insets,
      camera: (() => {
        try {
          return this.atlas.state().camera;
        } catch {
          return undefined;
        }
      })(),
      iframeReady: st.iframeReady,
      overlayReport: st.report ?? undefined,
      windowTitle: st.doc.title,
      mainBackgroundThrottling: (() => {
        try {
          return st.mainWindow?.webContents?.getBackgroundThrottling?.() ?? null;
        } catch {
          return null;
        }
      })(),
      keepAlive: st.keepAliveId !== null,
      mainHidden: document.visibilityState === 'hidden' || !!st.mainWindow?.isMinimized?.(),
    };
  }

  async apply(options: PlayerFrameOptions): Promise<PlayerFrameStatus> {
    if (!options.enabled) return this.clear();
    const url = normalizeOverlayUrl(options.url ?? 'http://127.0.0.1:8099/overlay?bg=transparent');
    const insets: FrameInsets = { ...DEFAULT_INSETS, ...(options.insets ?? {}) };
    for (const [key, value] of Object.entries(insets)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`insets.${key} must be a non-negative number`);
    }
    const size = options.size ?? DEFAULT_SIZE;
    if (!(size.w >= 320 && size.h >= 180)) throw new Error('size must be at least 320x180');

    this.lastOptions = { ...options, url, insets };
    const currentDoc = this.findPlayerDoc();
    if (this.active && currentDoc && this.active.doc === currentDoc && this.active.content.isConnected) {
      // Same popout: update in place (scene change / resize / URL change).
      await this.restyle(this.active, url, insets, size, options);
      if (options.reload) this.reloadIframe(this.active);
      this.startKeepAlive(this.active);
      return this.status();
    }
    if (this.active) await this.clear();
    const frame = await this.build(url, insets, size, options);
    this.active = frame;
    await this.restyle(frame, url, insets, size, options);
    this.startKeepAlive(frame);
    return this.status();
  }

  private findPlayerDoc(): Document | null {
    const leaf = this.app.workspace.getLeavesOfType(PLAYER_VIEW_TYPE)[0];
    const view = leaf?.view as any;
    const content: HTMLElement | null = view?.containerEl?.querySelector?.('.atlas-local-player-content') ?? null;
    const doc = (content ?? view?.containerEl)?.ownerDocument as Document | undefined;
    return doc && doc.body ? doc : null;
  }

  /** Opens the player popout if Atlas has none, then waits for its DOM. */
  private async waitForPlayerDoc(timeoutMs = 6000): Promise<Document> {
    let doc = this.findPlayerDoc();
    if (doc) return doc;
    try {
      this.atlas.runCommand('atlas-vtt:show-map-in-player-window');
    } catch {
      /* the command may need an active Atlas view; retry below */
    }
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await sleep(300);
      doc = this.findPlayerDoc();
      if (doc) return doc;
      if (Date.now() - t0 > 2000) {
        try {
          this.atlas.runCommand('atlas-vtt:open-player-window');
        } catch {
          /* tested next loop */
        }
      }
    }
    throw new Error(
      'No Atlas player window. Run atlas_command "atlas-vtt:show-map-in-player-window" (a scene must be presented), then retry.'
    );
  }

  private findBrowserWindow(doc: Document): any {
    const remote = electronRemote();
    const windows: any[] = remote.BrowserWindow.getAllWindows();
    const title = String(doc.title ?? '');
    return (
      windows.find((w) => String(w.getTitle?.() ?? '') === title) ??
      windows.find((w) => /player|投影|玩家/i.test(String(w.getTitle?.() ?? ''))) ??
      null
    );
  }

  private async build(url: string, insets: FrameInsets, size: { w: number; h: number }, options: PlayerFrameOptions): Promise<ActiveFrame> {
    const doc = await this.waitForPlayerDoc();
    const win: any = doc.defaultView;
    const content = doc.querySelector('.atlas-local-player-content') as HTMLElement | null;
    if (!content) throw new Error('The player window has no .atlas-local-player-content (Atlas changed its DOM; run atlas_probe).');
    const browserWindow = this.findBrowserWindow(doc);
    if (!browserWindow) throw new Error('Could not find the player BrowserWindow through Electron remote.');

    const remote = electronRemote();
    let workArea: { width: number; height: number } | null = null;
    try {
      workArea = remote.screen.getPrimaryDisplay().workAreaSize;
    } catch {
      workArea = null;
    }
    const fitted = fitContentSize(size, workArea, options.screenFit !== false);

    const originalContentSize: [number, number] = browserWindow.getContentSize() as [number, number];
    let originalBounds: { x: number; y: number; width: number; height: number };
    try {
      originalBounds = browserWindow.getBounds();
    } catch {
      originalBounds = { x: 0, y: 0, width: originalContentSize[0], height: originalContentSize[1] };
    }
    let originalBackgroundThrottling: boolean | null = null;
    try {
      originalBackgroundThrottling = browserWindow.webContents.getBackgroundThrottling();
    } catch {
      originalBackgroundThrottling = null;
    }
    // Atlas copies the main renderer's frame into the player canvas from its own
    // beforeRender hook. Chromium stops that hook when the main window is occluded,
    // so the stream picture freezes. Disable throttling on the main window while the
    // stream frame is on; clear() restores the user's original value.
    let mainWindow: any = null;
    let originalMainBackgroundThrottling: boolean | null = null;
    try {
      mainWindow = remote.getCurrentWindow();
      originalMainBackgroundThrottling = mainWindow?.webContents?.getBackgroundThrottling?.() ?? null;
      mainWindow?.webContents?.setBackgroundThrottling?.(false);
    } catch {
      mainWindow = null;
    }
    let originalCamera: unknown = null;
    try {
      originalCamera = this.atlas.state().camera;
    } catch {
      originalCamera = null;
    }

    browserWindow.setContentSize(fitted.w, fitted.h);
    try {
      browserWindow.webContents.setBackgroundThrottling(false);
    } catch {
      /* older Electron */
    }

    const root = doc.createElement('div');
    root.id = 'trpg-player-frame';
    root.style.cssText =
      'position:fixed;inset:0;z-index:2147483000;pointer-events:none;background:transparent;overflow:hidden;';
    const iframe = doc.createElement('iframe');
    iframe.id = 'trpg-player-frame-iframe';
    iframe.title = 'trpg-table player frame';
    iframe.setAttribute('allowtransparency', 'true');
    iframe.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;pointer-events:none;display:block;';
    iframe.src = this.withTransparent(url);
    root.appendChild(iframe);
    doc.body.appendChild(root);

    const st: ActiveFrame = {
      doc,
      win,
      browserWindow,
      content,
      contentStyle: content.getAttribute('style'),
      initiative: doc.querySelector('.atlas-player-initiative-container') as HTMLElement | null,
      initiativeStyle: (doc.querySelector('.atlas-player-initiative-container') as HTMLElement | null)?.getAttribute('style') ?? null,
      dice: doc.querySelector('.atlas-player-dice-rolls') as HTMLElement | null,
      diceStyle: (doc.querySelector('.atlas-player-dice-rolls') as HTMLElement | null)?.getAttribute('style') ?? null,
      root,
      iframe,
      url,
      contentSize: { w: fitted.w, h: fitted.h },
      designScale: fitted.scale,
      insets,
      originalContentSize,
      originalBounds,
      originalBackgroundThrottling,
      originalCamera,
      mainWindow,
      originalMainBackgroundThrottling,
      keepAliveId: null,
      lastKickAt: 0,
      lastKickError: null,
      mapDesignWidth: 0,
      mapDesignHeight: 0,
      lastTokenPostAt: 0,
      lastSeen: Date.now(),
      iframeReady: false,
      report: null,
      refitTimer: null,
      detachDoc: null,
    };
    this.attachMessages(st);
    iframe.addEventListener('load', () => {
      st.lastSeen = Date.now();
      st.iframeReady = true;
    });
    return st;
  }

  private withTransparent(url: string): string {
    try {
      const u = new URL(url);
      if (!u.searchParams.has('bg')) u.searchParams.set('bg', 'transparent');
      return u.toString();
    } catch {
      return url;
    }
  }

  private async restyle(st: ActiveFrame, url: string, insets: FrameInsets, size: { w: number; h: number }, options: PlayerFrameOptions): Promise<void> {
    const contentSize = st.contentSize;
    const remote = (() => {
      try {
        return electronRemote();
      } catch {
        return null;
      }
    })();
    let workArea: { width: number; height: number } | null = null;
    try {
      workArea = remote?.screen?.getPrimaryDisplay?.().workAreaSize ?? null;
    } catch {
      workArea = null;
    }
    const fitted = fitContentSize(size, workArea, options.screenFit !== false);
    if (fitted.w !== contentSize.w || fitted.h !== contentSize.h) {
      st.browserWindow.setContentSize(fitted.w, fitted.h);
      st.contentSize = { w: fitted.w, h: fitted.h };
      st.designScale = fitted.scale;
    }
    // Keep the whole stream picture on screen. The popout may sit near the right edge when it
    // was opened; after growing to 1707x960 it would otherwise hang off-screen (OBS window
    // capture would show black). clear() restores originalBounds.
    try {
      const wa = remote?.screen?.getPrimaryDisplay?.().workArea ?? null;
      if (wa) {
        const b = st.browserWindow.getBounds();
        const maxX = wa.x + wa.width - b.width;
        const maxY = wa.y + wa.height - b.height;
        const x = Math.max(wa.x, Math.min(b.x, maxX));
        const y = Math.max(wa.y, Math.min(b.y, maxY));
        if (x !== b.x || y !== b.y) st.browserWindow.setPosition(x, y);
      }
    } catch {
      /* ignore */
    }
    const sx = st.contentSize.w / Math.max(1, size.w);
    const sy = st.contentSize.h / Math.max(1, size.h);
    const left = Math.round(insets.left * sx);
    const right = Math.round(insets.right * sx);
    const top = Math.round(insets.top * sy);
    const bottom = Math.round(insets.bottom * sy);
    st.insets = {
      left: Math.round(insets.left * st.designScale),
      right: Math.round(insets.right * st.designScale),
      top: Math.round(insets.top * st.designScale),
      bottom: Math.round(insets.bottom * st.designScale),
    };
    st.mapDesignWidth = Math.max(1, size.w - insets.left - insets.right);
    st.mapDesignHeight = Math.max(1, size.h - insets.top - insets.bottom);

    // The map region: shrink the Atlas canvas host itself. padding does not work (the canvas is
    // absolutely positioned and ignores it) — width/height/left/top do.
    st.content.style.cssText = [
      `position:absolute`,
      `left:${left}px`,
      `top:${top}px`,
      `width:${Math.max(1, st.contentSize.w - left - right)}px`,
      `height:${Math.max(1, st.contentSize.h - top - bottom)}px`,
      `margin:0`,
      `right:auto`,
      `bottom:auto`,
      `overflow:hidden`,
    ].join(';');

    // Atlas' own initiative rail is replaced by our bottom-bar strip while the frame is on.
    if (st.initiative) {
      if (options.hideAtlasInitiative === false) st.initiative.style.cssText = st.initiativeStyle ?? '';
      else st.initiative.style.cssText = 'display:none !important;';
    }

    // v2 draws its own dice numbers next to the target token; Atlas' toast container must not
    // appear behind/over it.
    if (st.dice) {
      if (options.hideAtlasDice === false) {
        st.dice.style.cssText = st.diceStyle ?? '';
      } else {
        st.dice.style.cssText = 'display:none !important;';
      }
    }

    if (st.url !== url) {
      st.url = url;
      st.iframe.src = this.withTransparent(url);
      st.lastSeen = Date.now();
      st.iframeReady = false;
    }

    // Atlas listens for resize on its own window; both documents are dispatched so the canvas
    // reflows even though the popout is not focused.
    try {
      st.win.dispatchEvent(new st.win.Event('resize'));
    } catch {
      /* ignore */
    }
    try {
      window.dispatchEvent(new Event('resize'));
    } catch {
      /* ignore */
    }
    this.app.workspace.trigger('resize');
    st.lastSeen = Date.now();

    if (options.refitCamera !== false) this.scheduleCameraFit(st);
  }
  private scheduleCameraFit(st: ActiveFrame): void {
    if (st.refitTimer) clearTimeout(st.refitTimer);
    st.refitTimer = setTimeout(() => {
      st.refitTimer = null;
      void this.fitCamera(st).catch(() => undefined);
    }, 450);
    st.refitTimer?.unref?.();
  }

  /** Scale the camera so the whole background sits inside the (possibly shrunk) map area. */
  private async fitCamera(st: ActiveFrame): Promise<void> {
    let background: string | null = null;
    try {
      background = this.atlas.readyStore().state.background ?? null;
    } catch {
      try {
        background = this.atlas.state().background ?? null;
      } catch {
        return;
      }
    }
    if (!background) return;
    let src: string;
    try {
      src = this.app.vault.adapter.getResourcePath(background);
    } catch {
      return;
    }
    const dims = await this.imageSize(st.doc, src);
    if (!dims || dims.w < 8 || dims.h < 8) return;
    const rect = st.content.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    const scale = Math.min(rect.width / dims.w, rect.height / dims.h) * 0.985;
    try {
      this.atlas.actOn('setCamera', { x: dims.w / 2, y: dims.h / 2, scale });
    } catch {
      /* scene may be loading; the next ensure/apply retries */
    }
  }

  private imageSize(doc: Document, src: string): Promise<{ w: number; h: number } | null> {
    return new Promise((resolve) => {
      const img = doc.createElement('img');
      const done = (value: { w: number; h: number } | null) => {
        img.onload = null;
        img.onerror = null;
        resolve(value);
      };
      img.onload = () => done({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => done(null);
      const timer: any = setTimeout(() => done(null), 4000);
      timer?.unref?.();
      img.src = src;
    });
  }

  private attachMessages(st: ActiveFrame): void {
    const target = st.doc.defaultView as any;
    if (!target) return;
    const onMessage = (event: any) => {
      const data = event?.data;
      if (!data || typeof data !== 'object') return;
      if (event.source !== st.iframe.contentWindow) return;
      if (data.type === 'trpg-overlay-ready') {
        st.iframeReady = true;
        st.lastSeen = Date.now();
        this.postTokenPositions(st);
        return;
      }
      if (data.type === 'trpg-overlay-report') {
        st.report = data;
        st.lastSeen = Date.now();
        st.iframeReady = true;
        target.__trpgOverlayReport = data;
        target.__trpgOverlayReportAt = Date.now();
      }
    };
    target.addEventListener('message', onMessage);
    st.detachDoc = () => target.removeEventListener('message', onMessage);
    target.__trpgFrameController = this;
  }

  private reloadIframe(st: ActiveFrame): void {
    try {
      const u = new URL(st.url);
      u.searchParams.set('t', String(Date.now()));
      st.iframe.src = u.toString();
      st.iframeReady = false;
      st.lastSeen = Date.now();
    } catch {
      /* ignore */
    }
  }

  /**
   * Heartbeat on the player window (always visible on stream): while the main window is
   * hidden/minimised its PIXI ticker stops and Atlas' player mirror never gets a new frame.
   * From the player's rAF we advance the main ticker and mark the mirror stale, so the
   * picture keeps updating even when Windows has suspended the main window.
   *
   * This is the fallback for the minimised case; the background-throttling change above is
   * enough when the main window is merely covered by another window.
   */
  private startKeepAlive(st: ActiveFrame): void {
    if (st.keepAliveId !== null) return;
    const tick = () => {
      st.keepAliveId = null;
      if (!st.doc.body?.isConnected || !st.root.isConnected) return;
      try {
        if (Date.now() - st.lastTokenPostAt >= 100) {
          st.lastTokenPostAt = Date.now();
          this.postTokenPositions(st);
        }
      } catch (e) {
        st.lastKickError = (e as Error)?.message ?? String(e);
      }
      try {
        const hidden = document.visibilityState === 'hidden' || !!st.mainWindow?.isMinimized?.();
        if (hidden && Date.now() - st.lastKickAt >= 120) {
          st.lastKickAt = Date.now();
          this.kickMainRenderer(st);
        }
      } catch (e) {
        st.lastKickError = (e as Error)?.message ?? String(e);
      }
      try {
        st.keepAliveId = st.win.requestAnimationFrame(tick);
      } catch {
        st.keepAliveId = null;
      }
    };
    try {
      st.keepAliveId = st.win.requestAnimationFrame(tick);
    } catch {
      st.keepAliveId = null;
    }
  }

  /**
   * Send token screen rectangles to the overlay iframe (≤10 Hz). The overlay anchors comic
   * bubbles to these rectangles, so they must be in the same 1920×1080 design space as the
   * iframe, not in canvas pixels.
   */
  private postTokenPositions(st: ActiveFrame): void {
    const iframeWin: any = st.iframe.contentWindow;
    if (!iframeWin) return;
    const canvas = st.doc.getElementById('atlas-player-canvas') as HTMLCanvasElement | null;
    if (!canvas || !canvas.width || !st.mapDesignWidth) return;
    let state: any = null;
    try {
      state = this.atlas.state();
    } catch {
      return;
    }
    const grid = state?.grid;
    const tokens = state?.objects?.tokens ?? {};
    if (!grid || typeof grid.size !== 'number') return;
    const pview: any = this.app.workspace.getLeavesOfType('atlas-vtt-local-player')[0]?.view;
    const session = pview?.getState?.() ?? null;
    const camera = session?.camera ?? state.camera;
    const view: any = this.atlas.views()[0];
    const viewport = (view as any)?._serviceManager?.getRendererService?.()?.getViewport?.();
    const camWidth =
      typeof camera?.width === 'number' && camera.width > 0
        ? camera.width
        : viewport?.screenWidth && camera?.scale
          ? viewport.screenWidth / camera.scale
          : null;
    if (!camera || !camWidth) return;
    const canvasScale = canvas.width / camWidth;
    const designScale = canvas.width / st.mapDesignWidth;
    const leftDesign = st.designScale ? st.insets.left / st.designScale : 0;
    const topDesign = st.designScale ? st.insets.top / st.designScale : 0;
    const out: Record<string, unknown>[] = [];
    for (const token of Object.values(tokens) as any[]) {
      if (!token || token.isHidden) continue;
      const size = grid.size * (typeof token.size === 'number' && token.size > 0 ? token.size : 1);
      const cx = (token.x - camera.centerX) * canvasScale + canvas.width / 2;
      const cy = (token.y - camera.centerY) * canvasScale + canvas.height / 2;
      const half = (size * canvasScale) / 2;
      out.push({
        id: token.id,
        name: token.name ?? null,
        imagePath: token.imagePath ?? null,
        x: Math.round((cx - half) / designScale + leftDesign),
        y: Math.round((cy - half) / designScale + topDesign),
        w: Math.round((half * 2) / designScale),
        h: Math.round((half * 2) / designScale),
      });
    }
    try {
      iframeWin.postMessage(
        {
          type: 'trpg-token-positions',
          at: Date.now(),
          map: {
            x: Math.round(leftDesign),
            y: Math.round(topDesign),
            w: st.mapDesignWidth,
            h: st.mapDesignHeight,
          },
          tokens: out,
        },
        '*'
      );
    } catch {
      /* iframe may be navigating */
    }
  }

  /** Advance Atlas' main ticker once and wake its player mirror. */
  private kickMainRenderer(st: ActiveFrame): void {    let view: any = null;
    try {
      const loaded = this.atlas.loadedViews();
      view = loaded[0] ?? this.atlas.views()[0] ?? null;
    } catch {
      view = null;
    }
    if (!view) return;
    try {
      const service = (view as any).renderer ?? (view as any)._serviceManager?.getRendererService?.();
      const app = service?.getAppInstance?.();
      if (typeof app?.ticker?.update === 'function') app.ticker.update(performance.now());
    } catch (e) {
      st.lastKickError = (e as Error)?.message ?? String(e);
    }
    try {
      // Atlas' PlayerWindowService subscribes to this workspace event and calls
      // mirror.markStale(), which makes the visible player window force a frame even
      // when the main window's rAF is suspended.
      this.app.workspace.trigger('atlas-vtt:collection-settings-changed');
    } catch (e) {
      st.lastKickError = (e as Error)?.message ?? String(e);
    }
  }

  // ---------------------------------------------------------------- 像素检查
  /** Canvas geometry for a token cell in the player picture (same fit Atlas' mirror uses). */
  private cellRect(st: ActiveFrame, cell: { col: number; row: number }, radiusCells = 2): { x: number; y: number; w: number; h: number } | null {
    try {
      const state = this.atlas.state();
      const grid = state.grid;
      if (!grid || typeof grid.size !== 'number') return null;
      const canvas = st.doc.getElementById('atlas-player-canvas') as HTMLCanvasElement | null;
      if (!canvas) return null;
      // The popout's own session camera is what the mirror actually used. It can differ from
      // the main view camera after the frame resized the map host (observed 0.8762 vs 0.5959).
      const playerView: any = this.app.workspace.getLeavesOfType('atlas-vtt-local-player')[0]?.view;
      const session = playerView?.getState?.() ?? null;
      const camera = session?.camera ?? state.camera;
      const view: any = this.atlas.views()[0];
      const viewport = (view as any)?._serviceManager?.getRendererService?.()?.getViewport?.();
      const camWidth =
        typeof camera?.width === 'number' && camera.width > 0
          ? camera.width
          : viewport?.screenWidth && camera?.scale
            ? viewport.screenWidth / camera.scale
            : null;
      if (!camera || !camWidth || !Number.isFinite(camWidth)) return null;
      // The mirror fits by width (the map host is portrait here), so this ratio is the
      // world-pixel -> canvas-pixel scale for both axes.
      const scale = canvas.width / camWidth;
      const gridSize = grid.size;
      const worldX = (cell.col + 0.5) * gridSize + (grid.offsetX ?? 0);
      const worldY = (cell.row + 0.5) * gridSize + (grid.offsetY ?? 0);
      const x = (worldX - camera.centerX) * scale + canvas.width / 2;
      const y = (worldY - camera.centerY) * scale + canvas.height / 2;
      const half = gridSize * scale * radiusCells;
      return { x: Math.round(x - half), y: Math.round(y - half), w: Math.round(half * 2), h: Math.round(half * 2) };
    } catch {
      return null;
    }
  }

  /** Snapshot the player canvas right before a move; finishMoveCheck compares after it. */
  beginMoveCheck(from: { col: number; row: number }, to: { col: number; row: number }): FrameCheckStart | null {
    const st = this.active;
    if (!st) return null;
    const canvas = st.doc.getElementById('atlas-player-canvas') as HTMLCanvasElement | null;
    if (!canvas) return null;
    try {
      const r1 = this.cellRect(st, from);
      const r2 = this.cellRect(st, to);
      const expected =
        r1 && r2
          ? {
              x: Math.min(r1.x, r2.x),
              y: Math.min(r1.y, r2.y),
              w: Math.max(r1.x + r1.w, r2.x + r2.w) - Math.min(r1.x, r2.x),
              h: Math.max(r1.y + r1.h, r2.y + r2.h) - Math.min(r1.y, r2.y),
            }
          : null;
      const x = Math.max(0, expected?.x ?? 0);
      const y = Math.max(0, expected?.y ?? 0);
      const w = Math.min(canvas.width - x, expected?.w ?? canvas.width);
      const h = Math.min(canvas.height - y, expected?.h ?? canvas.height);
      if (w < 4 || h < 4) return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const baseline = ctx.getImageData(x, y, w, h).data;
      return { canvas, ctx, x, y, w, h, baseline, startedAt: Date.now(), from, to, expected };
    } catch {
      return null;
    }
  }

  /**
   * Compare the token region for up to 1 s. The rAF loop runs on the player window, which
   * stays visible on stream even when the main window is hidden — so a frozen main window
   * cannot hide the failure. No capturePage: reading the canvas never forces a frame.
   */
  async finishMoveCheck(check: FrameCheckStart | null): Promise<FrameCheck> {
    if (!check) return { checked: false, reason: 'player frame is not active or canvas not found' };
    const st = this.active;
    if (!st) return { checked: false, reason: 'player frame closed during the move' };
    return await new Promise<FrameCheck>((resolve) => {
      let settled = false;
      const finish = (result: FrameCheck) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const threshold = 40;
      const deadline = check.startedAt + 1000;
      let frames = 0;
      let lastCompare = 0;
      const step = () => {
        if (settled) return;
        frames += 1;
        const now = Date.now();
        if (now - lastCompare >= 60) {
          lastCompare = now;
          try {
            const img = check.ctx.getImageData(check.x, check.y, check.w, check.h).data;
            let diff = 0;
            let minX = check.w;
            let minY = check.h;
            let maxX = -1;
            let maxY = -1;
            for (let yy = 0; yy < check.h; yy++) {
              for (let xx = 0; xx < check.w; xx++) {
                const i = (yy * check.w + xx) * 4;
                if (
                  Math.abs(img[i] - check.baseline[i]) +
                    Math.abs(img[i + 1] - check.baseline[i + 1]) +
                    Math.abs(img[i + 2] - check.baseline[i + 2]) >
                  12
                ) {
                  diff += 1;
                  if (xx < minX) minX = xx;
                  if (xx > maxX) maxX = xx;
                  if (yy < minY) minY = yy;
                  if (yy > maxY) maxY = yy;
                }
              }
            }
            if (diff >= threshold) {
              return finish({
                checked: true,
                updated: true,
                latencyMs: now - check.startedAt,
                diffPixels: diff,
                bbox: { x: check.x + minX, y: check.y + minY, w: maxX - minX + 1, h: maxY - minY + 1 },
                from: check.from,
                to: check.to,
                expected: check.expected,
              });
            }
          } catch (e) {
            return finish({ checked: true, updated: false, reason: (e as Error)?.message ?? String(e), from: check.from, to: check.to });
          }
        }
        if (now >= deadline) {
          return finish({
            checked: true,
            updated: false,
            latencyMs: now - check.startedAt,
            diffPixels: 0,
            bbox: null,
            from: check.from,
            to: check.to,
            expected: check.expected,
            reason: `no pixel change in ${frames} frames / ${now - check.startedAt}ms`,
          });
        }
        try {
          st.win.requestAnimationFrame(step);
        } catch {
          finish({ checked: true, updated: false, reason: 'player window rAF unavailable', from: check.from, to: check.to });
        }
      };
      try {
        st.win.requestAnimationFrame(step);
      } catch {
        finish({ checked: true, updated: false, reason: 'player window rAF unavailable', from: check.from, to: check.to });
      }
    });
  }

  /** Undo everything: DOM, styles, window size, camera. */
  async clear(): Promise<PlayerFrameStatus> {
    const st = this.active;
    this.active = null;
    this.lastOptions = null;
    if (!st) return { applied: false };
    if (st.refitTimer) clearTimeout(st.refitTimer);
    if (st.keepAliveId !== null) {
      try {
        st.win.cancelAnimationFrame(st.keepAliveId);
      } catch {
        /* window may be gone */
      }
      st.keepAliveId = null;
    }
    try {
      st.detachDoc?.();
    } catch {
      /* ignore */
    }
    try {
      st.root.remove();
    } catch {
      /* ignore */
    }
    try {
      if (st.contentStyle === null) st.content.removeAttribute('style');
      else st.content.setAttribute('style', st.contentStyle);
    } catch {
      /* ignore */
    }
    try {
      if (st.initiative) {
        if (st.initiativeStyle === null) st.initiative.removeAttribute('style');
        else st.initiative.setAttribute('style', st.initiativeStyle);
      }
    } catch {
      /* ignore */
    }
    try {
      if (st.dice) {
        if (st.diceStyle === null) st.dice.removeAttribute('style');
        else st.dice.setAttribute('style', st.diceStyle);
      }
    } catch {
      /* ignore */
    }
    try {
      // setBounds (not setContentSize): if the window was pushed to the screen edge, Windows
      // clamps a width-only resize and the window comes back as a narrow strip.
      st.browserWindow.setBounds(st.originalBounds);
      // Once it is back inside the screen, restore the exact content box (frame chrome differs by a few px).
      st.browserWindow.setContentSize(st.originalContentSize[0], st.originalContentSize[1]);
    } catch {
      /* window may be gone */
    }
    try {
      if (st.originalBackgroundThrottling !== null) {
        st.browserWindow.webContents.setBackgroundThrottling(st.originalBackgroundThrottling);
      }
    } catch {
      /* ignore */
    }
    try {
      if (st.originalMainBackgroundThrottling !== null) {
        st.mainWindow?.webContents?.setBackgroundThrottling?.(st.originalMainBackgroundThrottling);
      }
    } catch {
      /* ignore */
    }
    if (st.originalCamera) {
      try {
        this.atlas.actOn('setCamera', st.originalCamera as any);
      } catch {
        /* scene changed/closed */
      }
    }
    try {
      st.win.dispatchEvent(new st.win.Event('resize'));
    } catch {
      /* ignore */
    }
    return { applied: false };
  }
}
