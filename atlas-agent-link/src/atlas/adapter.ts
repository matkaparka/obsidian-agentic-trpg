/**
 * Everything that touches Atlas internals lives here — the only module that knows Atlas'
 * private shapes. Atlas VTT 0.8.0 has no published extension API, so this adapter reads and
 * writes its zustand view store (`AtlasView.getStore()`), which is exactly what the UI does:
 * every AI write is one undo step and persists through Atlas' own debounced save.
 *
 * Verified against live Atlas VTT 0.8.0 in Obsidian 1.14.4 — see docs/PROBE.md.
 */
import { TFile, normalizePath } from 'obsidian';
import type { App, WorkspaceLeaf } from 'obsidian';
import { RetryableSceneError } from '../errors';
import type { GridState } from './grid';
import type { CameraState, MapFileEnvelope } from './shapes';

export const ATLAS_VIEW_TYPE = 'atlas-vtt';
export const PLAYER_VIEW_TYPE = 'atlas-vtt-local-player';

/** Versions this adapter was verified against. Anything else is flagged, never assumed. */
export const TESTED_VERSIONS = ['0.8.0'] as const;
export const PREFERRED_VERSION = '0.8.0';

/**
 * Actions this plugin calls by name. A missing one makes the matching tool fail loudly with a
 * version warning instead of writing something half-right.
 */
export const REQUIRED_ACTIONS = [
  'setCamera', 'setGrid', 'setBackground', 'setGridVisible', 'setSnapToGrid', 'setGridUnits',
  'addToken', 'addTokens', 'moveToken', 'moveTokensBulk', 'updateToken', 'deleteToken', 'deleteTokens',
  'setTokenRing', 'setTokensCondition', 'changeTokensConditionValue', 'clearTokenConditions',
  'addFogOperation', 'deleteFogOperation', 'deleteFogOperations', 'clearFog',
  'addWall', 'updateWall', 'deleteWall', 'deleteWalls', 'toggleDoor', 'setDoorLocked',
  'addLight', 'updateLight', 'deleteLight', 'addLightZone', 'updateLightZone', 'deleteLightZone',
  'setSceneLighting', 'setSelection', 'clearSelection', 'setExploredMask',
  'addText', 'updateText', 'deleteText', 'addNotePin', 'updateNotePin', 'deleteNotePin',
  'addToInitiative', 'removeFromInitiative', 'updateInitiativeEntry', 'rollAllInitiative',
  'rollEntryInitiative', 'nextTurn', 'previousTurn', 'reorderInitiative', 'moveToFront', 'moveToBack',
  'startCombat', 'endCombat', 'resetInitiative', 'setInitiativeConfig', 'setInitiativeSitsOut',
  'setInitiativeTrackerOpen', 'addDiceLogEntry', 'clearDiceLog',
] as const;

/**
 * Actions that exist but are never callable through `atlas_apply`: they wipe or rewire a scene
 * in one call (some of them bypassing undo), which a narration agent must not do by accident.
 * The dedicated tools cover every legitimate use of them.
 */
export const BLOCKED_ACTIONS = new Set([
  'clearMapState', 'setTokens', 'setTexts', 'setDrawings', 'setFogOperations', 'setMapPath',
  'setPersistenceEnabled', 'setMapLoaded', 'setMapLoading', 'deleteSelected',
  'killTokens', 'resetTokens', 'retargetRenamedFile', 'addWidget', 'removeWidget', 'setWidgetSettings',
  'updateWidget', 'setTimerState', 'reorderWidgets', 'setWidgetValue', 'setWidgetOn',
  'savePinnedNotePreview', 'removePinnedNotePreview', 'updateLootRoller', 'showLootRoll',
  'markAudioDirty', 'consumeAudioDirty', 'alignGrid', 'duplicateMapObjects',
]);

export interface AtlasStore {
  getState(): any;
  getInitialState?(): any;
  setState?(partial: unknown): void;
  subscribe(listener: (state: any, previous: any) => void): () => void;
  temporal?: { getState(): any };
  persist?: { flush?: () => Promise<void> };
  flushStorage?: () => Promise<void>;
  rehydrateFromFile?: (isSuperseded?: () => boolean) => Promise<void>;
}

export interface AtlasView {
  getStore(): AtlasStore;
  saveMap(): Promise<void>;
  reloadActiveScene?(rewrite?: boolean): Promise<void>;
  contentEl: HTMLElement;
  containerEl: HTMLElement;
  file?: TFile | null;
  getViewType(): string;
  leaf?: WorkspaceLeaf;
}

export interface AtlasPluginLike {
  manifest: { version: string };
  /** Atlas' presented-scene store: `scene` holds `{ tabId, filePath }` while something is presented. */
  presentedScene?: { scene?: { tabId: string; filePath: string } | null } | null;
}

export class AtlasAdapter {
  constructor(private app: App) {}

  plugin(): AtlasPluginLike | null {
    return ((this.app as any)?.plugins?.plugins?.['atlas-vtt'] as AtlasPluginLike) ?? null;
  }

  installed(): boolean {
    return !!this.plugin();
  }

  version(): string | null {
    return this.plugin()?.manifest?.version ?? null;
  }

  tested(): boolean {
    const v = this.version();
    return !!v && (TESTED_VERSIONS as readonly string[]).includes(v);
  }

  views(): AtlasView[] {
    return (this.app.workspace.getLeavesOfType(ATLAS_VIEW_TYPE) as WorkspaceLeaf[])
      .map((l) => l.view as unknown as AtlasView)
      .filter(Boolean);
  }

  /** The active Atlas view if there is one, else the first open scene. */
  view(): AtlasView {
    const views = this.views();
    if (!views.length) {
      throw new Error('No Atlas scene is open. Call atlas_open_scene with a .atlasmap path (atlas_list_scenes lists them).');
    }
    const active = this.app.workspace.getActiveViewOfType(Object as any) as unknown as AtlasView | null;
    return active && views.includes(active) ? active : views[0];
  }

  /** Views that currently hold a loaded scene (persistence + undo are safe). */
  loadedViews(): AtlasView[] {
    return this.views().filter((v) => {
      try {
        const s = v.getStore().getState();
        return !!s && s.mapLoaded === true && !s.isMapLoading && typeof s.mapPath === 'string' && s.mapPath.length > 0;
      } catch { return false; }
    });
  }

  store(view?: AtlasView): AtlasStore {
    const v = view ?? this.view();
    const store = typeof v.getStore === 'function' ? v.getStore() : null;
    if (!store) throw new Error('Atlas view has no getStore(); Atlas internals changed in this version. Run atlas_probe.');
    return store;
  }

  state(view?: AtlasView): any {
    return this.store(view).getState();
  }

  /** The loaded scene store, so a write never lands on a view that is still loading. */
  readyStore(): { view: AtlasView; store: AtlasStore; state: any } {
    const loaded = this.loadedViews();
    if (!loaded.length) {
      const anyView = this.views().length;
      throw new RetryableSceneError(anyView
        ? 'The Atlas scene is not loaded yet (still loading, or the file is missing). Retrying shortly.'
        : 'No Atlas scene is open. Call atlas_open_scene with a .atlasmap path (atlas_list_scenes lists them).');
    }
    const active = this.app.workspace.getActiveViewOfType(Object as any) as unknown as AtlasView | null;
    const view = active && loaded.includes(active) ? active : loaded[0];
    const store = this.store(view);
    return { view, store, state: store.getState() };
  }

  actionNames(): string[] {
    const state = this.state();
    return Object.keys(state).filter((k) => typeof state[k] === 'function').sort();
  }

  has(name: string): boolean {
    try { return typeof this.state()[name] === 'function'; } catch { return false; }
  }

  /** Calls a store action by name. Throws — never silently no-ops — when Atlas lacks it. */
  act<T = unknown>(name: string, ...args: unknown[]): T {
    const state = this.state();
    const fn = state[name];
    if (typeof fn !== 'function') {
      throw new Error(`Atlas ${this.version() ?? '(unknown)'} has no store action "${name}". Run atlas_probe; this plugin targets ${PREFERRED_VERSION}.`);
    }
    return fn(...args) as T;
  }

  /** Calls a store action on the loaded scene the tools are writing to. */
  actOn<T = unknown>(name: string, ...args: unknown[]): T {
    const { state } = this.readyStore();
    const fn = state[name];
    if (typeof fn !== 'function') {
      throw new Error(`Atlas ${this.version() ?? '(unknown)'} has no store action "${name}". Run atlas_probe; this plugin targets ${PREFERRED_VERSION}.`);
    }
    return fn(...args) as T;
  }

  // ── history ────────────────────────────────────────────────────────────────
  history(): { undo(): void; redo(): void; pastStates?: unknown[]; futureStates?: unknown[] } | null {
    const temporal = this.store().temporal;
    if (!temporal) return null;
    const s = temporal.getState();
    return typeof s?.undo === 'function' ? s : null;
  }

  undo(): { undone: boolean; remaining: number } {
    const h = this.history();
    if (!h) throw new Error('This Atlas build exposes no undo history (store.temporal missing).');
    const before = h.pastStates?.length ?? 0;
    if (!before) return { undone: false, remaining: 0 };
    h.undo();
    return { undone: true, remaining: h.pastStates?.length ?? 0 };
  }

  redo(): { redone: boolean; remaining: number } {
    const h = this.history();
    if (!h) throw new Error('This Atlas build exposes no redo history (store.temporal missing).');
    const before = h.futureStates?.length ?? 0;
    if (!before) return { redone: false, remaining: 0 };
    h.redo();
    return { redone: true, remaining: h.futureStates?.length ?? 0 };
  }

  historyDepth(): { undo: number; redo: number } {
    const h = this.history();
    return { undo: h?.pastStates?.length ?? 0, redo: h?.futureStates?.length ?? 0 };
  }

  /** Forces Atlas' debounced save to disk now. */
  async flush(): Promise<void> {
    const store = this.store();
    if (typeof store.flushStorage === 'function') { await store.flushStorage(); return; }
    if (typeof store.persist?.flush === 'function') { await store.persist.flush(); return; }
    throw new Error('No flushStorage on the store; cannot force a save in this Atlas build.');
  }

  // ── files ──────────────────────────────────────────────────────────────────
  listScenes(): string[] {
    return (this.app.vault.getFiles() as TFile[])
      .filter((f) => f.extension === 'atlasmap')
      .map((f) => f.path)
      .sort();
  }

  async openScene(path: string): Promise<{ opened: string; viewType: string }> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) throw new Error(`Scene not found in the vault: ${path}`);
    if (file.extension !== 'atlasmap') throw new Error(`Not a scene file (.atlasmap): ${path}`);
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.openFile(file);
    const viewType = (leaf.view as any)?.getViewType?.() ?? 'unknown';
    return { opened: file.path, viewType };
  }

  async readSceneFile(path: string): Promise<MapFileEnvelope> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) throw new Error(`Scene not found: ${path}`);
    const raw = await this.app.vault.read(file);
    try { return JSON.parse(raw) as MapFileEnvelope; } catch { throw new Error(`Scene file is not valid JSON: ${path}`); }
  }

  /** Writes a new scene file. Never overwrites unless asked — and never behind an open scene. */
  async writeSceneFile(path: string, envelope: MapFileEnvelope, overwrite = false): Promise<string> {
    const target = normalizePath(path);
    const existing = this.app.vault.getAbstractFileByPath(target);
    const open = this.loadedViews().find((v) => {
      try { return v.getStore().getState().mapPath === target; } catch { return false; }
    });
    if (open) {
      // Atlas saves its debounced store over the file; writing it from here would be undone (and
      // worse, the open scene's state would win). Refuse instead of pretending it worked.
      throw new Error(`${target} is open in Atlas right now — Atlas would save its current state over anything written here. Close that scene tab (or use another path) and retry.`);
    }
    if (existing instanceof TFile) {
      if (!overwrite) throw new Error(`File already exists: ${target} (pass overwrite: true to replace it)`);
      await this.app.vault.modify(existing, JSON.stringify(envelope, null, 2));
      return target;
    }
    await this.app.vault.create(target, JSON.stringify(envelope, null, 2));
    return target;
  }

  // ── commands ───────────────────────────────────────────────────────────────
  listCommands(): string[] {
    return Object.keys((this.app as any).commands?.commands ?? {}).filter((id) => id.startsWith('atlas-vtt:')).sort();
  }

  runCommand(id: string): { executed: string } {
    const commands = (this.app as any).commands?.commands ?? {};
    if (!Object.prototype.hasOwnProperty.call(commands, id)) throw new Error(`No such command: ${id}`);
    const ok = (this.app as any).commands.executeCommandById(id);
    if (ok === false) throw new Error(`Command refused by Atlas: ${id} (it may need an open scene, a selection, or the player window).`);
    return { executed: id };
  }

  /** What Atlas presents to the player window right now, if anything. */
  presented(): { filePath: string; tabId: string } | null {
    const scene = this.plugin()?.presentedScene?.scene;
    if (!scene || typeof scene.filePath !== 'string') return null;
    return { filePath: scene.filePath, tabId: String(scene.tabId ?? '') };
  }

  // ── capability report ──────────────────────────────────────────────────────
  capabilities() {
    const version = this.version();
    let actions: string[] = [];
    let error: string | undefined;
    try { actions = this.actionNames(); } catch (e: any) { error = e?.message; }
    const missing = (REQUIRED_ACTIONS as readonly string[]).filter((a) => !actions.includes(a));
    return {
      installed: this.installed(),
      version,
      tested: this.tested(),
      testedVersions: [...TESTED_VERSIONS],
      openScenes: this.views().length,
      loadedScenes: this.loadedViews().length,
      actionCount: actions.length,
      missingActions: missing,
      actions: actions.length ? actions : undefined,
      error,
      warning: this.tested()
        ? undefined
        : `Atlas ${version ?? '(unknown)'} is untested: this plugin was verified on ${TESTED_VERSIONS.join(', ')}. Expect missing actions; run atlas_probe after every Atlas update.`,
    };
  }
}

export function gridOf(state: any): GridState | null {
  return (state?.grid as GridState | null) ?? null;
}

export function cameraOf(state: any): CameraState {
  return (state?.camera as CameraState) ?? { x: 0, y: 0, scale: 1 };
}
