/** Plugin settings, persisted by Obsidian in `<vault>/.obsidian/plugins/atlas-agent-link/data.json`. */

export interface Settings {
  port: number;
  token: string;
  /** Off by default: every write tool fails until an operator turns this on. */
  allowWrite: boolean;
  autostart: boolean;
  /** Actions `atlas_apply` may call by name (dedicated tools do not need this list). */
  applyAllowlist: string[];
  /** Where `atlas_screenshot` writes PNGs inside the vault. */
  screenshotDir: string;
  /** Longest side of a screenshot in pixels. */
  screenshotMaxWidth: number;
  /** Requests per minute on the local HTTP endpoint. */
  rateLimit: number;
}

/**
 * Actions `atlas_apply` may call by name: safe, granular, and not already covered by a typed
 * tool. `adapter.BLOCKED_ACTIONS` and the deny pattern are applied on top of this list, so adding
 * a name here can never unlock a scene-wiping action.
 */
export const DEFAULT_APPLY_ALLOWLIST = [
  'addToken', 'addTokens', 'moveToken', 'moveTokensBulk', 'updateToken', 'updateTokens',
  'deleteToken', 'deleteTokens', 'setTokenRing', 'setTokensCondition', 'changeTokensConditionValue',
  'clearTokenConditions', 'setSelection', 'clearSelection',
  'addFogOperation', 'deleteFogOperation', 'deleteFogOperations',
  'addWall', 'updateWall', 'deleteWall', 'deleteWalls', 'toggleDoor', 'setDoorLocked',
  'addLight', 'updateLight', 'deleteLight', 'addLightZone', 'updateLightZone', 'deleteLightZone',
  'setSceneLighting', 'setExploredMask', 'addText', 'updateText', 'deleteText',
  'addNotePin', 'updateNotePin', 'deleteNotePin',
  'addToInitiative', 'removeFromInitiative', 'updateInitiativeEntry', 'rollAllInitiative',
  'rollEntryInitiative', 'nextTurn', 'previousTurn', 'reorderInitiative', 'moveToFront', 'moveToBack',
  'startCombat', 'endCombat', 'setInitiativeConfig', 'setInitiativeSitsOut',
  'setInitiativeTrackerOpen', 'addDiceLogEntry',
  'setCamera', 'setGrid', 'setGridVisible', 'setSnapToGrid', 'setGridUnits', 'setBackground',
];

export const DEFAULT_SETTINGS: Settings = {
  port: 27125,
  token: '',
  allowWrite: false,
  autostart: true,
  applyAllowlist: DEFAULT_APPLY_ALLOWLIST,
  screenshotDir: 'atlas-agent-link/screenshots',
  screenshotMaxWidth: 1280,
  /** Requests per minute on POST /mcp: high enough for a busy orchestrator, low enough to bound a runaway loop. */
  rateLimit: 600,
};
