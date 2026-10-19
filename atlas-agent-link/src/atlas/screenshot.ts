/**
 * Screenshots for vision models and the streamer overlay.
 *
 * Atlas renders into a PIXI/WebGL canvas that is not readable frame by frame (PIXI v8 keeps no
 * drawing buffer), so the shot is taken one level up, through Electron: `webContents.capturePage()`
 * captures what is actually on screen, including fog, lighting and UI. Verified in Obsidian
 * 1.14.4 with Atlas 0.8.0 (docs/E2E.md).
 */
import type { App } from 'obsidian';

export interface ScreenshotOptions {
  /** `window` = whole Obsidian window, `map` = the Atlas canvas area, `player` = the player window. */
  target?: 'window' | 'map' | 'player';
  /** Downscale so the longest side is at most this many pixels (default 1280). */
  maxWidth?: number;
  /** Vault path to save the PNG at (a folder is created if needed). */
  savePath?: string;
}

export interface ScreenshotResult {
  target: string;
  mimeType: 'image/png';
  width: number;
  height: number;
  bytes: number;
  savedTo?: string;
  /** Base64 PNG, no data-url prefix. */
  base64: string;
}

interface ElectronRemote {
  getCurrentWindow(): any;
  BrowserWindow: { getAllWindows(): any[] };
}

function electron(): any {
  // Obsidian runs with node integration; `remote` is still exposed in 1.14.x.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const req = typeof require === 'function' ? require : (globalThis as any).require;
  if (!req) throw new Error('No CommonJS require() in this window: cannot reach Electron for a screenshot.');
  const mod = req('electron');
  if (!mod?.remote) throw new Error('Electron remote module unavailable: screenshots need Obsidian 1.14 with node integration (desktop only).');
  return mod.remote as ElectronRemote & any;
}

/**
 * The Atlas canvas' on-screen rect, in DIP. Obsidian keeps several canvases around (hidden
 * panels, the grid overlay), so this takes the largest visible one inside the Atlas view and
 * falls back to the view's own content box.
 */
function canvasRect(app: App): { x: number; y: number; width: number; height: number } {
  const leaf = app.workspace.getLeavesOfType('atlas-vtt')[0];
  const view = leaf?.view as any;
  const containers: HTMLElement[] = [view?.containerEl, view?.contentEl].filter(Boolean);
  let best: { area: number; rect: DOMRect } | null = null;
  for (const container of containers) {
    for (const canvas of Array.from(container.querySelectorAll('canvas'))) {
      const rect = canvas.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > 4 && (!best || area > best.area)) best = { area, rect };
    }
  }
  if (best) {
    const r = best.rect;
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  }
  const host = view?.contentEl as HTMLElement | undefined;
  if (!host) throw new Error('Atlas view not found; is a scene open?');
  const r = host.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) {
    throw new Error('The Atlas view has no size on screen (minimised window or the scene is in a background tab). Target "window" always works.');
  }
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
}

/**
 * Chromium does not composite a window that is fully covered, and `capturePage` on such a window
 * returns a blank frame. The player window sits exactly on top of the GM window by default, so it
 * is raised for a moment and put back afterwards. Returns a restore function.
 */
async function raiseWindow(win: any): Promise<() => void> {
  const wasOnTop = !!win.isAlwaysOnTop?.();
  try {
    win.setAlwaysOnTop?.(true);
    win.showInactive?.();
    win.moveTop?.();
    win.webContents?.setBackgroundThrottling?.(false);
    // A window that was covered has not painted for a while: give it a few display frames.
    await new Promise((r) => setTimeout(r, 650));
  } catch { /* best effort: capture anyway */ }
  return () => {
    try {
      win.webContents?.setBackgroundThrottling?.(true);
      if (!wasOnTop) win.setAlwaysOnTop?.(false);
    } catch { /* window may be gone */ }
  };
}

export async function captureScreenshot(app: App, options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
  const remote = electron();
  const target = options.target ?? 'window';
  const current = remote.getCurrentWindow();
  let contents: any = current?.webContents;
  let rect: { x: number; y: number; width: number; height: number } | undefined;
  let restore: (() => void) | null = null;

  if (target === 'map') {
    rect = canvasRect(app);
  } else if (target === 'player') {
    const windows: any[] = remote.BrowserWindow.getAllWindows();
    const others = windows.filter((w) => w.id !== current?.id);
    // The popout's own document title names its window (locale independent, unlike the UI text).
    const leaf = app.workspace.getLeavesOfType('atlas-vtt-local-player')[0];
    const wantTitle = (leaf?.view as any)?.containerEl?.ownerDocument?.title as string | undefined;
    const player = (wantTitle ? others.find((w) => String(w.getTitle?.() ?? '') === wantTitle) : undefined)
      ?? others.find((w) => /player|投影|玩家/i.test(String(w.getTitle?.() ?? '')))
      ?? others[others.length - 1];
    if (!player) {
      throw new Error('No player window is open. Run atlas_command with id "atlas-vtt:show-map-in-player-window" (or "atlas-vtt:open-player-window"), wait ~2s, then retry.');
    }
    contents = player.webContents;
    if (!contents || contents.isDestroyed?.()) throw new Error('The player window has no live webContents (it may be closing).');
    restore = await raiseWindow(player);
  }

  try {
    if (!contents?.capturePage) throw new Error('capturePage() is unavailable on this Electron build.');
    // A window that was just raised paints its first frame late; that throwaway capture makes the
    // next one the settled picture instead of a stale or half-drawn one.
    if (restore) {
      await contents.capturePage(rect).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 220));
    }
    const image = await contents.capturePage(rect);
    if (!image || image.isEmpty?.()) throw new Error('Electron returned an empty image (the window may be minimised).');

    let final = image;
    const size = image.getSize();
    const maxWidth = Math.max(160, Math.min(4000, options.maxWidth ?? 1280));
    const longest = Math.max(size.width, size.height);
    if (longest > maxWidth) {
      const k = maxWidth / longest;
      final = image.resize({ width: Math.round(size.width * k), height: Math.round(size.height * k), quality: 'good' });
    }
    const buffer: Buffer = final.toPNG();
    if (!buffer?.length) throw new Error('Electron produced no PNG bytes for this window.');
    const finalSize = final.getSize();

    let savedTo: string | undefined;
    if (options.savePath) {
      savedTo = await savePng(app, options.savePath, buffer);
    }
    return {
      target,
      mimeType: 'image/png',
      width: finalSize.width,
      height: finalSize.height,
      bytes: buffer.length,
      savedTo,
      base64: buffer.toString('base64'),
    };
  } finally {
    restore?.();
  }
}

async function savePng(app: App, path: string, buffer: Buffer): Promise<string> {
  const dir = path.split('/').slice(0, -1).join('/');
  if (dir && !app.vault.getAbstractFileByPath(dir)) {
    await app.vault.createFolder(dir).catch(() => undefined);
  }
  const adapter = app.vault.adapter as any;
  if (adapter?.writeBinary) {
    await adapter.writeBinary(path, new Uint8Array(buffer));
    return path;
  }
  await app.vault.createBinary(path, new Uint8Array(buffer).buffer);
  return path;
}
