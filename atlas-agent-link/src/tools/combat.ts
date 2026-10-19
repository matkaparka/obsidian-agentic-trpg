/**
 * Combat and dice: the initiative tracker and the dice log.
 *
 * Dice are rolled inside this plugin (`rollFormula`, crypto-free but code-side), never by the
 * model, and the result is written into Atlas' own dice log so it shows in the UI, persists with
 * the scene and appears in the event stream as `dice_rolled`.
 */
import type { DiceRollResult, InitiativeEntry } from '../atlas/shapes';
import { isPlainObject } from '../atlas/shapes';
import { localId, rollFormula } from '../util';
import { summariseEntry } from '../events';
import { anyObject, bool, enumOf, num, obj, requireString, str, strArray, tokenById, ToolCtx, ToolDef } from './shared';

const INITIATIVE_ENTRY_FIELDS = ['name', 'initiative', 'initiativeModifier', 'statblockPath', 'isNPC', 'sitsOut', 'isActive', 'order'] as const;

export function combatTools(ctx: ToolCtx): ToolDef[] {
  const { atlas, bus } = ctx;

  const initiativeState = () => (atlas.readyStore().state.initiative ?? {}) as any;

  const buildEntry = (state: any, input: any): Omit<InitiativeEntry, 'id' | 'order' | 'isActive'> => {
    const tokenId = String(input.tokenId ?? '');
    if (!tokenId) throw new Error('entry.tokenId is required (the token this entry belongs to)');
    const token = state.objects.tokens?.[tokenId];
    if (!token) throw new Error(`No token with id "${tokenId}"; add the token first (atlas_add_token).`);
    return {
      tokenId,
      name: String(input.name ?? token.name ?? token.statblockName ?? 'Unnamed'),
      initiative: Number.isFinite(Number(input.initiative)) ? Number(input.initiative) : 0,
      initiativeModifier: Number.isFinite(Number(input.initiativeModifier)) ? Number(input.initiativeModifier) : 0,
      imagePath: String(input.imagePath ?? token.imagePath ?? ''),
      ...(input.statblockPath ? { statblockPath: String(input.statblockPath) } : token.statblockPath ? { statblockPath: token.statblockPath } : {}),
      isNPC: typeof input.isNPC === 'boolean' ? input.isNPC : token.kind === 'token',
    };
  };

  return [
    {
      name: 'atlas_initiative',
      description: 'Initiative and combat. action=list | add | add_tokens (one entry per token id) | remove | update | roll_all | roll_one | next | prev | reorder | to_front | to_back | sits_out | start | end | reset | tracker | config. Rolls happen in Atlas (roll_all/roll_one use the collection\'s dice rules); turns advance with next/prev and rounds count themselves.',
      write: true,
      needsScene: true,
      inputSchema: obj({
        action: enumOf(['list', 'add', 'add_tokens', 'remove', 'update', 'roll_all', 'roll_one', 'next', 'prev', 'reorder', 'to_front', 'to_back', 'sits_out', 'start', 'end', 'reset', 'tracker', 'config'], 'what to do'),
        id: str('entry id (remove/update/roll_one/reorder/to_front/to_back/sits_out)'),
        ids: strArray('token ids for action=add_tokens'),
        entry: anyObject('{ tokenId, name?, initiative?, initiativeModifier?, isNPC?, statblockPath? } for action=add'),
        updates: anyObject('{ name?, initiative?, initiativeModifier?, isNPC?, sitsOut? } for action=update'),
        roll: str('dice formula for roll_all/roll_one, e.g. "1d20+3" (omit to use the collection default)'),
        fromStatblocks: bool('roll_all: add each creature\'s statblock modifier'),
        from: num('reorder: current index'),
        to: num('reorder: target index'),
        sitsOut: bool('sits_out: does not act this round'),
        open: bool('tracker: show/hide the initiative panel'),
        autoSort: bool('config: sort by initiative after rolls'),
        rules: anyObject('start: initiative rules override'),
      }, ['action']),
      handler: (a) => {
        const state = atlas.readyStore().state;
        const action = requireString(a, 'action');
        switch (action) {
          case 'list': {
            const s = initiativeState();
            return {
              isActive: !!s.isActive, round: s.round ?? 0, currentIndex: s.currentIndex ?? -1,
              trackerOpen: !!state.initiativeTrackerOpen,
              entries: (s.entries ?? []).map((e: any) => ({ ...summariseEntry(e), order: e.order })),
            };
          }
          case 'add': {
            const input = isPlainObject(a.entry) ? a.entry : a;
            const id = atlas.actOn<string>('addToInitiative', buildEntry(state, input));
            return { id, entries: (initiativeState().entries ?? []).map((e: any) => summariseEntry(e)) };
          }
          case 'add_tokens': {
            const ids = Array.isArray(a.ids) ? a.ids.map(String) : [];
            if (!ids.length) throw new Error('ids is required for add_tokens');
            const created: string[] = [];
            for (const tokenId of ids) {
              tokenById(state, tokenId);
              created.push(atlas.actOn<string>('addToInitiative', buildEntry(atlas.readyStore().state, { tokenId })));
            }
            return { ids: created, entries: (initiativeState().entries ?? []).map((e: any) => summariseEntry(e)) };
          }
          case 'remove': {
            const id = requireString(a, 'id');
            if (!(initiativeState().entries ?? []).some((e: any) => e.id === id)) throw new Error(`No initiative entry with id "${id}".`);
            atlas.actOn('removeFromInitiative', id);
            return { removed: id, entries: (initiativeState().entries ?? []).map((e: any) => summariseEntry(e)) };
          }
          case 'update': {
            const id = requireString(a, 'id');
            const raw = isPlainObject(a.updates) ? a.updates : {};
            const unknown = Object.keys(raw).filter((k) => !(INITIATIVE_ENTRY_FIELDS as readonly string[]).includes(k));
            if (unknown.length) throw new Error(`Unknown entry field(s): ${unknown.join(', ')}`);
            if (!Object.keys(raw).length) throw new Error('updates is empty');
            atlas.actOn('updateInitiativeEntry', id, raw);
            return { id, entry: summariseEntry((initiativeState().entries ?? []).find((e: any) => e.id === id)) };
          }
          case 'roll_all':
            atlas.actOn('rollAllInitiative', a.roll, a.fromStatblocks === true ? undefined : undefined);
            return { entries: (initiativeState().entries ?? []).map((e: any) => summariseEntry(e)) };
          case 'roll_one': {
            const id = requireString(a, 'id');
            atlas.actOn('rollEntryInitiative', id, a.roll);
            return { id, entry: summariseEntry((initiativeState().entries ?? []).find((e: any) => e.id === id)) };
          }
          case 'next':
            atlas.actOn('nextTurn');
            return { round: initiativeState().round, index: initiativeState().currentIndex, active: summariseEntry((initiativeState().entries ?? [])[initiativeState().currentIndex]) };
          case 'prev':
            atlas.actOn('previousTurn');
            return { round: initiativeState().round, index: initiativeState().currentIndex, active: summariseEntry((initiativeState().entries ?? [])[initiativeState().currentIndex]) };
          case 'reorder': {
            const from = Number(a.from);
            const to = Number(a.to);
            if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error('reorder needs integer from and to indexes');
            atlas.actOn('reorderInitiative', from, to);
            return { entries: (initiativeState().entries ?? []).map((e: any) => summariseEntry(e)) };
          }
          case 'to_front':
            atlas.actOn('moveToFront', requireString(a, 'id'));
            return { entries: (initiativeState().entries ?? []).map((e: any) => summariseEntry(e)) };
          case 'to_back':
            atlas.actOn('moveToBack', requireString(a, 'id'));
            return { entries: (initiativeState().entries ?? []).map((e: any) => summariseEntry(e)) };
          case 'sits_out':
            atlas.actOn('setInitiativeSitsOut', requireString(a, 'id'), a.sitsOut !== false);
            return { id: a.id, sitsOut: a.sitsOut !== false };
          case 'start':
            atlas.actOn('startCombat', a.rules ?? undefined);
            return { isActive: !!initiativeState().isActive, round: initiativeState().round };
          case 'end':
            atlas.actOn('endCombat');
            return { isActive: !!initiativeState().isActive };
          case 'reset':
            atlas.actOn('resetInitiative');
            return { entries: (initiativeState().entries ?? []).length, round: initiativeState().round };
          case 'tracker':
            atlas.actOn('setInitiativeTrackerOpen', a.open !== false);
            return { trackerOpen: !!atlas.readyStore().state.initiativeTrackerOpen };
          case 'config':
            if (typeof a.autoSort !== 'boolean') throw new Error('config needs autoSort');
            atlas.actOn('setInitiativeConfig', { autoSort: a.autoSort });
            return { config: initiativeState().config };
          default:
            throw new Error(`Unknown initiative action "${action}"`);
        }
      },
    },
    {
      name: 'atlas_roll_dice',
      description: 'Roll dice. The roll happens here in code (a model cannot fudge it) and is written into Atlas\' own dice log, so it shows in the UI, saves with the scene and streams as dice_rolled. Formula supports NdM with keep-high/low and +/- constants: "2d20kh1+5", "3d6", "1d20-1d4".',
      write: true,
      needsScene: true,
      inputSchema: obj({
        formula: str('dice formula, e.g. "2d20kh1+5"'),
        label: str('what the roll is for, e.g. "Goblin scimitar"'),
        tokenId: str('token the roll belongs to (shown in the log)'),
        player: str('who rolled it (defaults to the GM)'),
        log: bool('write it into the Atlas dice log (default true)'),
      }, ['formula']),
      handler: (a) => {
        const outcome = rollFormula(requireString(a, 'formula'));
        const state = atlas.readyStore().state;
        const token = a.tokenId ? state.objects.tokens?.[a.tokenId] : undefined;
        const entry: DiceRollResult = {
          id: localId('roll'),
          timestamp: Date.now(),
          formula: outcome.formula,
          rolls: outcome.dice,
          modifiers: outcome.modifiers,
          total: outcome.total,
          ...(a.player ? { player: String(a.player) } : {}),
          source: {
            type: 'toolbar',
            ...(a.tokenId ? { tokenId: String(a.tokenId) } : {}),
            ...(token ? { tokenName: token.name ?? undefined, tokenImagePath: token.imagePath } : {}),
            ...(a.label ? { abilityName: String(a.label) } : {}),
          },
        };
        let logged = false;
        let logError: string | undefined;
        if (a.log !== false) {
          try {
            atlas.actOn('addDiceLogEntry', entry);
            logged = true;
          } catch (e: any) {
            logError = e?.message ?? String(e);
          }
        }
        // A logged roll reaches the stream through the store diff (dice_rolled with the same id);
        // only an unlogged roll has to be announced here, so listeners never see it twice.
        if (!logged) {
          bus.emit('dice_rolled', { id: entry.id, formula: entry.formula, total: entry.total, rolls: outcome.parts, logged, label: a.label ?? null });
        }
        return { formula: entry.formula, total: entry.total, dice: outcome.dice, parts: outcome.parts, modifiers: outcome.modifiers, logged, logError, writtenToAtlas: logged, event: logged ? 'dice_rolled (once, from the dice log)' : 'dice_rolled (from the tool; nothing was logged)' };
      },
    },
    {
      name: 'atlas_dice_log',
      description: 'Read the scene\'s dice log (Atlas keeps the last 20 rolls per scene). Use it to narrate a streak or check what was rolled before.',
      inputSchema: obj({ limit: num('how many recent rolls (default 20)') }),
      handler: (a) => {
        const log: any[] = atlas.readyStore().state.diceLog ?? [];
        return { count: log.length, rolls: log.slice(-Math.max(1, Math.min(50, a.limit ?? 20))) };
      },
    },
    {
      name: 'atlas_clear_dice_log',
      description: 'Clear the scene\'s dice log (between fights, at scene start). This is not undoable in Atlas.',
      write: true,
      needsScene: true,
      inputSchema: obj({}),
      handler: () => {
        const before = (atlas.readyStore().state.diceLog ?? []).length;
        atlas.actOn('clearDiceLog');
        return { cleared: before, undoable: false };
      },
    },
  ];
}
