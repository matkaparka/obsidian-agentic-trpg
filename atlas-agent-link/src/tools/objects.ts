/**
 * Tools that write scene objects: tokens, fog, walls/doors, lights/light zones, texts and pins.
 * Every one of them turns into a single Atlas store action, so each is exactly one undo step.
 */
import type { GridState, Point } from '../atlas/grid';
import { cellToWorld, summariseGrid, worldToCell } from '../atlas/grid';
import { TOKEN_UPDATE_FIELDS, WALL_UPDATE_FIELDS, isPlainObject, pickFields, validateLight, validateWall } from '../atlas/shapes';
import {
  anyObject, bool, CELL_SCHEMA, describeToken, enumOf, gridSummary, num, obj, placementResult, pointArg,
  pointFrom, requireIds, requireString, sceneGrid, str, strArray, tokenById, ToolCtx, ToolDef,
} from './shared';

/** World-space rectangle covering a block of cells (hex: the bounding box of their centres). */
function cellRectToWorld(start: { col: number; row: number }, widthCells: number, heightCells: number, grid: GridState) {
  const a = cellToWorld(start, grid, 1);
  const b = cellToWorld({ col: start.col + widthCells, row: start.row + heightCells }, grid, 1);
  const half = grid.size / 2;
  return {
    x: Math.min(a.x, b.x) - half,
    y: Math.min(a.y, b.y) - half,
    width: Math.abs(b.x - a.x) + grid.size,
    height: Math.abs(b.y - a.y) + grid.size,
  };
}

export function objectTools(ctx: ToolCtx): ToolDef[] {
  const { atlas } = ctx;

  const readCellRect = (value: any) => {
    if (!value || typeof value !== 'object') return null;
    const col = value.col ?? value.q;
    const row = value.row ?? value.r;
    const width = value.width ?? value.w;
    const height = value.height ?? value.h;
    return [col, row, width, height].every((n) => typeof n === 'number') ? { col, row, width: width as number, height: height as number } : null;
  };

  return [
    // ── tokens ───────────────────────────────────────────────────────────────
    {
      name: 'atlas_add_token',
      description: 'Place one token. Give `imagePath` (a vault image) and a position: `cell` {col,row} (hex: {q,r}) or x/y in world pixels. Optional name/size/conditions/hidden/ringColor and any other Atlas token field via `data`. Returns the new token id and the pixel+cell position it got. Tokens are characters only if you set kind via data {kind:"character"} with a name.',
      write: true,
      needsScene: true,
      inputSchema: obj({
        imagePath: str('vault image path for the token art, e.g. "assets/goblin.png"'),
        cell: CELL_SCHEMA,
        col: num('cell column (hex: axial q) — alternative to cell'),
        row: num('cell row (hex: axial r)'),
        x: num('world x of the token centre (alternative to cell)'),
        y: num('world y'),
        name: str('nameplate text'),
        size: num('footprint multiplier: 1 = 1 cell, 1.5 = 2 cells, 2 = 3 cells (default 1)'),
        conditions: strArray('condition ids to start with'),
        hidden: bool('visible to the GM only'),
        ringColor: str('ring colour, e.g. "#ff0000"'),
        data: anyObject('any other Atlas token fields, merged last (kind, rotation, tags, resources, vision, light …)'),
      }, ['imagePath']),
      handler: (a) => {
        const grid = sceneGrid(ctx);
        const size = typeof a.size === 'number' ? a.size : (a.data?.size ?? 1);
        const point = pointFrom(a, grid, size);
        const input: Record<string, unknown> = {
          ...(isPlainObject(a.data) ? a.data : {}),
          imagePath: requireString(a, 'imagePath'),
          x: point.x,
          y: point.y,
          size,
          ...(a.name !== undefined ? { name: a.name } : {}),
          ...(a.conditions ? { conditions: a.conditions } : {}),
          ...(a.hidden !== undefined ? { isHidden: !!a.hidden } : {}),
          ...(a.ringColor ? { ringColor: a.ringColor } : {}),
        };
        const id = atlas.actOn<string>('addToken', input);
        const token = atlas.readyStore().state.objects.tokens[id];
        return { id, token: describeToken(token, grid), ...placementResult(point, grid, size) };
      },
    },
    {
      name: 'atlas_add_tokens',
      description: 'Place several tokens in one step (one undo). `tokens` items take the same fields as atlas_add_token. Returns the new ids in input order.',
      write: true,
      needsScene: true,
      inputSchema: obj({
        tokens: {
          type: 'array',
          description: 'token specs: {imagePath, cell|col/row|x/y, name?, size?, hidden?, conditions?, data?}',
          items: { type: 'object', additionalProperties: true },
        },
      }, ['tokens']),
      handler: (a) => {
        const list = Array.isArray(a.tokens) ? a.tokens : [];
        if (!list.length) throw new Error('tokens must be a non-empty array');
        const grid = sceneGrid(ctx);
        const inputs = list.map((spec: any, index: number) => {
          if (!spec?.imagePath) throw new Error(`tokens[${index}] needs imagePath`);
          const size = typeof spec.size === 'number' ? spec.size : (spec.data?.size ?? 1);
          const point = pointFrom(spec, grid, size);
          return {
            ...(isPlainObject(spec.data) ? spec.data : {}),
            imagePath: spec.imagePath,
            x: point.x,
            y: point.y,
            size,
            ...(spec.name !== undefined ? { name: spec.name } : {}),
            ...(spec.conditions ? { conditions: spec.conditions } : {}),
            ...(spec.hidden !== undefined ? { isHidden: !!spec.hidden } : {}),
            ...(spec.ringColor ? { ringColor: spec.ringColor } : {}),
          };
        });
        const ids = atlas.actOn<string[]>('addTokens', inputs);
        const tokens = atlas.readyStore().state.objects.tokens;
        return { ids, tokens: ids.map((id) => describeToken(tokens[id], grid)) };
      },
    },
    {
      name: 'atlas_move_token',
      description: 'Move a token to a grid cell or world position. With snap (default true) the token lands exactly on the cell centre Atlas would snap to. Returns from/to, the cells, and the distance in cells — handy for narration ("the goblin dashes 3 squares"). While the stream frame is open, also returns frameCheck: a pixel diff proving the mirrored player picture changed within 1 s.',
      write: true,
      needsScene: true,
      inputSchema: obj({
        id: str('token id'),
        cell: CELL_SCHEMA,
        col: num('cell column / axial q'),
        row: num('cell row / axial r'),
        x: num('world x'),
        y: num('world y'),
        snap: bool('snap to the nearest cell centre (default true when the scene snaps)'),
      }, ['id']),
      handler: async (a) => {
        const grid = sceneGrid(ctx);
        const { state } = atlas.readyStore();
        const token = tokenById(state, requireString(a, 'id'));
        const point = pointFrom(a, grid, token.size, { snap: a.snap !== false });
        const from = { x: token.x, y: token.y };
        const fromCell = worldToCell(from, grid, token.size);
        const toCell = worldToCell(point, grid, token.size);
        const sameCell = fromCell.col === toCell.col && fromCell.row === toCell.row;
        const hidden = !!token.isHidden;
        const check = sameCell || hidden ? null : ctx.playerFrame.beginMoveCheck(fromCell, toCell);
        atlas.actOn('moveToken', token.id, point.x, point.y);
        const frameCheck = hidden
          ? { checked: false, reason: 'hidden token: it is not drawn in the player view' }
          : sameCell
            ? { checked: false, reason: 'same cell: nothing should change on screen' }
            : await ctx.playerFrame.finishMoveCheck(check);
        const moved = atlas.readyStore().state.objects.tokens[token.id];
        return {
          id: token.id,
          from,
          to: { x: moved.x, y: moved.y },
          cells: {
            from: grid.type && grid.type !== 'square' ? { q: fromCell.col, r: fromCell.row } : fromCell,
            to: grid.type && grid.type !== 'square' ? { q: toCell.col, r: toCell.row } : toCell,
          },
          distanceCells: Math.max(Math.abs(fromCell.col - toCell.col), Math.abs(fromCell.row - toCell.row)),
          frameCheck,
        };
      },
    },
    {
      name: 'atlas_move_tokens',
      description: 'Move several tokens in one step (one undo). Either give a delta (dx/dy world pixels) or explicit positions [{id,x,y}]. Ids without a position keep their place with the delta.',
      write: true,
      needsScene: true,
      inputSchema: obj({
        ids: strArray('token ids to move'),
        dx: num('world pixels to add to x'),
        dy: num('world pixels to add to y'),
        positions: { type: 'array', description: '[{id,x,y}] explicit world positions', items: { type: 'object', additionalProperties: true } },
        snap: bool('snap results to cell centres (default false)'),
      }, ['ids']),
      handler: (a) => {
        const grid = sceneGrid(ctx);
        const { state } = atlas.readyStore();
        const ids = requireIds(a);
        const explicit = new Map<string, Point>((Array.isArray(a.positions) ? a.positions : []).map((p: any) => [String(p.id), { x: Number(p.x), y: Number(p.y) }]));
        const moves = ids.map((id) => {
          const token = tokenById(state, id);
          const target = explicit.get(id) ?? { x: token.x + (a.dx ?? 0), y: token.y + (a.dy ?? 0) };
          const point = a.snap ? cellToWorld(worldToCell(target, grid, token.size), grid, token.size) : target;
          return { id, ...point };
        });
        atlas.actOn('setTokenPositions', moves);
        const tokens = atlas.readyStore().state.objects.tokens;
        return { moved: moves.map((m) => ({ id: m.id, ...placementResult({ x: m.x, y: m.y }, grid, tokens[m.id]?.size) })) };
      },
    },
    {
      name: 'atlas_update_token',
      description: 'Patch one token. Known fields: name, imagePath, size, rotation, ringColor, conditions, conditionValues, isHidden, showNameplate, showRing, layer, resources, tags, side, vision, light, notePath, statblockPath, difficulty. Unknown keys are rejected (so a typo cannot quietly do nothing).',
      write: true,
      needsScene: true,
      inputSchema: obj({ id: str('token id'), updates: anyObject('fields to change') }, ['id', 'updates']),
      handler: (a) => {
        const { state } = atlas.readyStore();
        const token = tokenById(state, requireString(a, 'id'));
        const raw = isPlainObject(a.updates) ? a.updates : {};
        const unknown = Object.keys(raw).filter((k) => !(TOKEN_UPDATE_FIELDS as readonly string[]).includes(k));
        if (unknown.length) throw new Error(`Unknown token field(s): ${unknown.join(', ')}. Allowed: ${TOKEN_UPDATE_FIELDS.join(', ')}`);
        const updates = pickFields(raw, TOKEN_UPDATE_FIELDS);
        if (!Object.keys(updates).length) throw new Error('updates is empty');
        atlas.actOn('updateToken', token.id, updates);
        return { id: token.id, changed: Object.keys(updates), token: describeToken(atlas.readyStore().state.objects.tokens[token.id], summariseGrid(state.grid) ? (state.grid as GridState) : null) };
      },
    },
    {
      name: 'atlas_remove_token',
      description: 'Delete one token (undoable with atlas_undo). Initiative entries that referenced it stay; remove those with atlas_initiative action=remove.',
      write: true,
      needsScene: true,
      inputSchema: obj({ id: str('token id') }, ['id']),
      handler: (a) => {
        const { state } = atlas.readyStore();
        const token = tokenById(state, requireString(a, 'id'));
        const summary = describeToken(token, summariseGrid(state.grid) ? (state.grid as GridState) : null);
        atlas.actOn('deleteToken', token.id);
        const stillThere = !!atlas.readyStore().state.objects.tokens[token.id];
        if (stillThere) throw new Error(`Atlas did not delete token ${token.id}`);
        return { removed: summary };
      },
    },
    {
      name: 'atlas_remove_tokens',
      description: 'Delete several tokens in one step (one undo).',
      write: true,
      needsScene: true,
      inputSchema: obj({ ids: strArray('token ids') }, ['ids']),
      handler: (a) => {
        const { state } = atlas.readyStore();
        const ids = requireIds(a);
        const summaries = ids.map((id) => describeToken(tokenById(state, id), summariseGrid(state.grid) ? (state.grid as GridState) : null));
        atlas.actOn('deleteTokens', ids);
        const left = atlas.readyStore().state.objects.tokens;
        return { removed: summaries, remaining: Object.keys(left).length };
      },
    },
    {
      name: 'atlas_update_tokens',
      description: 'Patch several tokens with the same change in one step (one undo) — e.g. hide a group, set a ring colour, change size.',
      write: true,
      needsScene: true,
      inputSchema: obj({ ids: strArray('token ids'), updates: anyObject('fields to change (same whitelist as atlas_update_token)') }, ['ids', 'updates']),
      handler: (a) => {
        const ids = requireIds(a);
        const raw = isPlainObject(a.updates) ? a.updates : {};
        const unknown = Object.keys(raw).filter((k) => !(TOKEN_UPDATE_FIELDS as readonly string[]).includes(k));
        if (unknown.length) throw new Error(`Unknown token field(s): ${unknown.join(', ')}`);
        const updates = pickFields(raw, TOKEN_UPDATE_FIELDS);
        if (!Object.keys(updates).length) throw new Error('updates is empty');
        const entries = ids.map((id) => ({ id, changes: updates }));
        atlas.actOn('updateTokens', entries);
        return { updated: ids, changed: Object.keys(updates) };
      },
    },
    {
      name: 'atlas_set_condition',
      description: 'Add or clear one condition on tokens. `conditionId` is an id defined by the scene\'s collection (Atlas shows them in the token right-click menu); ids are not validated here, so use the ones you read from the scene or a token.',
      write: true,
      needsScene: true,
      inputSchema: obj({ ids: strArray('token ids'), conditionId: str('condition id'), active: bool('true adds, false clears') }, ['ids', 'conditionId', 'active']),
      handler: (a) => {
        const ids = requireIds(a);
        const conditionId = requireString(a, 'conditionId');
        atlas.actOn('setTokensCondition', ids, conditionId, a.active !== false);
        const tokens = atlas.readyStore().state.objects.tokens;
        return { ids, conditions: ids.map((id) => ({ id, conditions: tokens[id]?.conditions ?? [] })) };
      },
    },
    {
      name: 'atlas_change_condition_value',
      description: 'Change the stack value of a valued condition (e.g. "poisoned 2 → 3"). Use for conditions Atlas shows with a number.',
      write: true,
      needsScene: true,
      inputSchema: obj({ ids: strArray('token ids'), conditionId: str('condition id'), delta: num('amount to add (may be negative)') }, ['ids', 'conditionId', 'delta']),
      handler: (a) => {
        const ids = requireIds(a);
        atlas.actOn('changeTokensConditionValue', ids, requireString(a, 'conditionId'), Number(a.delta ?? 0));
        const tokens = atlas.readyStore().state.objects.tokens;
        return { values: ids.map((id) => ({ id, conditionValues: tokens[id]?.conditionValues ?? {} })) };
      },
    },
    {
      name: 'atlas_clear_conditions',
      description: 'Clear every condition from one token.',
      write: true,
      needsScene: true,
      inputSchema: obj({ id: str('token id') }, ['id']),
      handler: (a) => {
        const id = requireString(a, 'id');
        tokenById(atlas.readyStore().state, id);
        atlas.actOn('clearTokenConditions', id);
        return { cleared: id };
      },
    },
    {
      name: 'atlas_set_token_resources',
      description: 'Set resource values on a token (HP and the collection\'s other resources). `resources` maps a resource key to {current,max}; keys you omit keep their value. Use overriddenMax to stop a maximum from following the statblock.',
      write: true,
      needsScene: true,
      inputSchema: obj({
        id: str('token id'),
        resources: anyObject('{ "hp": { "current": 12, "max": 20 }, ... }'),
        overriddenMax: strArray('resource keys whose max is now set by hand'),
      }, ['id', 'resources']),
      handler: (a) => {
        const { state } = atlas.readyStore();
        const token = tokenById(state, requireString(a, 'id'));
        const patch = isPlainObject(a.resources) ? a.resources : {};
        const merged: Record<string, unknown> = { ...(token.resources ?? {}) };
        for (const [key, value] of Object.entries(patch)) {
          if (!isPlainObject(value)) throw new Error(`resources.${key} must be {current,max}`);
          const current = Number((value as any).current);
          const max = Number((value as any).max);
          if (!Number.isFinite(current) || !Number.isFinite(max)) throw new Error(`resources.${key} needs numeric current and max`);
          merged[key] = { current, max };
        }
        atlas.actOn('updateToken', token.id, {
          resources: merged,
          ...(Array.isArray(a.overriddenMax) ? { overriddenMax: a.overriddenMax } : {}),
        });
        return { id: token.id, resources: atlas.readyStore().state.objects.tokens[token.id]?.resources ?? {} };
      },
    },
    {
      name: 'atlas_set_token_ring',
      description: 'Set or clear the coloured ring around tokens (a GM aid that players see too). `color` null clears it.',
      write: true,
      needsScene: true,
      inputSchema: obj({ ids: strArray('token ids'), color: str('ring colour "#rrggbb", or null to clear') }, ['ids']),
      handler: (a) => {
        const ids = requireIds(a);
        const color = a.color === null || a.color === '' || a.color === undefined ? null : String(a.color);
        for (const id of ids) atlas.actOn('setTokenRing', id, color);
        return { ids, color };
      },
    },
    {
      name: 'atlas_stack_tokens',
      description: 'Change stacking order (which token covers which when they share a cell). direction "top" puts them above every other token in the order given, "bottom" below all of them. This is Atlas\' layer field, one undo step.',
      write: true,
      needsScene: true,
      inputSchema: obj({ ids: strArray('token ids, in the order they should stack'), direction: enumOf(['top', 'bottom'], 'top = drawn above others') }, ['ids', 'direction']),
      handler: (a) => {
        const { state } = atlas.readyStore();
        const ids = requireIds(a);
        const tokens: Record<string, any> = state.objects.tokens;
        const picked = new Set(ids);
        const layers = Object.values(tokens).filter((t: any) => !picked.has(t.id)).map((t: any) => t.layer ?? 0);
        const base = a.direction === 'bottom' ? Math.min(0, ...layers) : Math.max(0, ...layers);
        const entries = ids.map((id, i) => ({
          id,
          changes: { layer: a.direction === 'bottom' ? base - ids.length + i : base + 1 + i },
        }));
        atlas.actOn('updateTokens', entries);
        const after = atlas.readyStore().state.objects.tokens;
        return { layers: ids.map((id) => ({ id, layer: after[id]?.layer ?? 0 })) };
      },
    },
    {
      name: 'atlas_select_tokens',
      description: 'Set the GM\'s canvas selection (what the next Atlas command or manual drag acts on). Pass an empty ids array to clear it.',
      write: true,
      needsScene: true,
      inputSchema: obj({ ids: { type: 'array', items: { type: 'string' }, description: 'token ids to select (empty clears)' } }, ['ids']),
      handler: (a) => {
        const ids = Array.isArray(a.ids) ? a.ids.map(String) : [];
        if (ids.length) atlas.actOn('setSelection', ids);
        else atlas.actOn('clearSelection');
        return { selected: ids };
      },
    },

    // ── fog of war ───────────────────────────────────────────────────────────
    {
      name: 'atlas_fog',
      description: 'Fog of war. action "reveal" erases fog (players see the area), "hide" paints fog back, "delete" removes specific fog operations, "list" reports what exists. Geometry: a block of cells via cell {col,row} + width/height in cells (best for gameplay), or an explicit world rectangle, or a polygon/brush in world pixels. Each call is one undo step.',
      write: true,
      needsScene: true,
      inputSchema: obj({
        action: enumOf(['reveal', 'hide', 'delete', 'list'], 'reveal = erase fog, hide = paint fog'),
        cell: CELL_SCHEMA,
        width: num('width in cells (with cell) or world pixels (with x/y)'),
        height: num('height in cells or world pixels'),
        x: num('world x of the rectangle corner'),
        y: num('world y'),
        points: { type: 'array', description: 'world-pixel points for a lasso/brush shape', items: { type: 'object', additionalProperties: true } },
        shape: enumOf(['rectangle', 'lasso', 'brush'], 'geometry kind (default rectangle)'),
        brushRadius: num('brush radius in world pixels (default 35)'),
        ids: strArray('fog operation ids for action=delete'),
        limit: num('for action=list: how many ids to return (default 50)'),
      }, ['action']),
      handler: (a) => {
        const grid = sceneGrid(ctx);
        const { state } = atlas.readyStore();
        const fogCount = () => Object.keys(atlas.readyStore().state.objects.fog ?? {}).length;
        if (a.action === 'list') {
          const ops = Object.values(state.objects.fog ?? {}) as any[];
          return {
            count: ops.length,
            operations: ops.slice(-Math.max(1, Math.min(500, a.limit ?? 50))).map((op) => ({
              id: op.id, type: op.type, erasing: !!op.isErasing,
              ...(op.type === 'rectangle' ? { x: op.x, y: op.y, width: op.width, height: op.height } : { points: op.points?.length ?? 0 }),
            })),
            grid: summariseGrid(grid),
          };
        }
        if (a.action === 'delete') {
          const ids = requireIds(a);
          const before = fogCount();
          atlas.actOn('deleteFogOperations', ids);
          return { deleted: ids, count: { before, after: fogCount() } };
        }
        const isErasing = a.action === 'reveal';
        const shape = a.shape ?? (Array.isArray(a.points) ? 'lasso' : 'rectangle');
        let operation: Record<string, unknown>;
        if (shape === 'rectangle') {
          const cellRect = readCellRect({ ...(a.cell ?? {}), width: a.width, height: a.height });
          const rect = cellRect && !(typeof a.x === 'number')
            ? cellRectToWorld({ col: cellRect.col, row: cellRect.row }, cellRect.width, cellRect.height, grid)
            : { x: Number(a.x), y: Number(a.y), width: Number(a.width), height: Number(a.height) };
          if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
            throw new Error('rectangle needs cell {col,row} + width/height in cells, or x/y + width/height in world pixels');
          }
          operation = { type: 'rectangle', isErasing, ...rect };
        } else {
          const rawPoints = Array.isArray(a.points) ? a.points : [];
          if (rawPoints.length < 2) throw new Error(`${shape} needs at least two points`);
          const points = rawPoints.map((p: any) => (typeof p.x === 'number' ? { x: p.x, y: p.y } : cellToWorld({ col: p.col ?? p.q, row: p.row ?? p.r }, grid, 1)));
          operation = shape === 'brush'
            ? { type: 'brush', isErasing, points, brushRadius: Number(a.brushRadius ?? 35) }
            : { type: 'lasso', isErasing, points };
        }
        const before = fogCount();
        const id = atlas.actOn<string>('addFogOperation', operation);
        return { id, action: a.action, operation: { type: operation.type, isErasing }, count: { before, after: fogCount() } };
      },
    },

    // ── walls and doors ──────────────────────────────────────────────────────
    {
      name: 'atlas_add_wall',
      description: 'Add one wall segment. p1/p2 are world pixels or cells. type "solid" blocks sight and light; "door" and "secret-door" can be opened with atlas_toggle_door. Optional blocks (sight|light), limited (a low wall sees past one), direction (which side light passes), closed, locked.',
      write: true,
      needsScene: true,
      inputSchema: obj({
        type: enumOf(['solid', 'door', 'secret-door'], 'wall kind'),
        p1: anyObject('start point {x,y} or {col,row}'),
        p2: anyObject('end point {x,y} or {col,row}'),
        blocks: enumOf(['sight', 'light'], 'the one thing this wall stops (default both)'),
        limited: bool('low wall: blocks on the second pass only'),
        direction: enumOf(['left', 'right'], 'light passes on this side only'),
        closed: bool('doors: starts closed (default true)'),
        locked: bool('doors: the GM locked it'),
        chainId: str('group id for segments drawn together'),
      }, ['type', 'p1', 'p2']),
      handler: (a) => {
        const grid = sceneGrid(ctx);
        const resolve = (p: unknown) => {
          if (!isPlainObject(p)) return null;
          if (typeof p.x === 'number' && typeof p.y === 'number') return { x: p.x, y: p.y };
          const col = p.col ?? p.q;
          const row = p.row ?? p.r;
          return typeof col === 'number' && typeof row === 'number' ? cellToWorld({ col, row }, grid, 1) : null;
        };
        const result = validateWall(a, resolve);
        if (!result.ok) throw new Error(result.error);
        const id = atlas.actOn<string>('addWall', result.value);
        return { id, wall: { ...result.value, id } };
      },
    },
    {
      name: 'atlas_add_wall_chain',
      description: 'Add a connected run of wall segments through several points (a room, a corridor). `points` are world pixels or cells; consecutive pairs become segments. Each segment is its own undo step, so one atlas_undo only removes the last one.',
      write: true,
      needsScene: true,
      inputSchema: obj({
        points: { type: 'array', description: '[{x,y} | {col,row}, …] at least 2', items: { type: 'object', additionalProperties: true } },
        type: enumOf(['solid', 'door', 'secret-door'], 'wall kind for every segment'),
        blocks: enumOf(['sight', 'light'], 'the one thing these walls stop'),
        limited: bool('low walls'),
        closed: bool('doors start closed'),
      }, ['points', 'type']),
      handler: (a) => {
        const grid = sceneGrid(ctx);
        const raw = Array.isArray(a.points) ? a.points : [];
        if (raw.length < 2) throw new Error('points needs at least two positions');
        const resolve = (p: any) => (typeof p.x === 'number' ? { x: p.x, y: p.y } : cellToWorld({ col: p.col ?? p.q, row: p.row ?? p.r }, grid, 1));
        const points = raw.map(resolve);
        const ids: string[] = [];
        for (let i = 0; i < points.length - 1; i++) {
          const result = validateWall({ type: a.type, p1: points[i], p2: points[i + 1], blocks: a.blocks, limited: a.limited, closed: a.closed });
          if (!result.ok) throw new Error(`segment ${i}: ${result.error}`);
          ids.push(atlas.actOn<string>('addWall', result.value));
        }
        return { ids, segments: ids.length, points };
      },
    },
    {
      name: 'atlas_update_wall',
      description: 'Patch a wall: type, p1, p2, closed, locked, blocks, limited, direction. Use atlas_toggle_door for the common open/close, and atlas_set_door_locked for locking.',
      write: true,
      needsScene: true,
      inputSchema: obj({ id: str('wall id'), updates: anyObject('fields to change') }, ['id', 'updates']),
      handler: (a) => {
        const id = requireString(a, 'id');
        const wall = atlas.readyStore().state.objects.walls?.[id];
        if (!wall) throw new Error(`No wall with id "${id}". Use atlas_list_walls.`);
        const raw = isPlainObject(a.updates) ? a.updates : {};
        const unknown = Object.keys(raw).filter((k) => !(WALL_UPDATE_FIELDS as readonly string[]).includes(k));
        if (unknown.length) throw new Error(`Unknown wall field(s): ${unknown.join(', ')}. Allowed: ${WALL_UPDATE_FIELDS.join(', ')}`);
        const updates = pickFields(raw, WALL_UPDATE_FIELDS);
        if (!Object.keys(updates).length) throw new Error('updates is empty');
        atlas.actOn('updateWall', id, updates);
        return { id, changed: Object.keys(updates), wall: atlas.readyStore().state.objects.walls[id] };
      },
    },
    {
      name: 'atlas_remove_wall',
      description: 'Delete one wall segment (undoable).',
      write: true,
      needsScene: true,
      inputSchema: obj({ id: str('wall id') }, ['id']),
      handler: (a) => {
        const id = requireString(a, 'id');
        if (!atlas.readyStore().state.objects.walls?.[id]) throw new Error(`No wall with id "${id}".`);
        atlas.actOn('deleteWall', id);
        return { removed: id };
      },
    },
    {
      name: 'atlas_remove_walls',
      description: 'Delete several wall segments in one step (one undo).',
      write: true,
      needsScene: true,
      inputSchema: obj({ ids: strArray('wall ids') }, ['ids']),
      handler: (a) => {
        const ids = requireIds(a);
        atlas.actOn('deleteWalls', ids);
        return { removed: ids, remaining: Object.keys(atlas.readyStore().state.objects.walls ?? {}).length };
      },
    },
    {
      name: 'atlas_toggle_door',
      description: 'Open or close a door or secret door. Returns the new state — use it to narrate ("the door swings open") and to re-check line of sight.',
      write: true,
      needsScene: true,
      inputSchema: obj({ id: str('door wall id') }, ['id']),
      handler: (a) => {
        const id = requireString(a, 'id');
        const wall = atlas.readyStore().state.objects.walls?.[id];
        if (!wall) throw new Error(`No wall with id "${id}".`);
        if (wall.type !== 'door' && wall.type !== 'secret-door') throw new Error(`Wall ${id} is a ${wall.type}, not a door.`);
        if (wall.locked) throw new Error(`Door ${id} is locked (unlock it with atlas_set_door_locked).`);
        atlas.actOn('toggleDoor', id);
        const after = atlas.readyStore().state.objects.walls[id];
        return { id, type: after.type, closed: after.closed !== false, locked: !!after.locked };
      },
    },
    {
      name: 'atlas_set_door_locked',
      description: 'Lock or unlock a door. A locked door stays closed until it is unlocked (Atlas gates the door badge on this).',
      write: true,
      needsScene: true,
      inputSchema: obj({ id: str('door wall id'), locked: bool('true locks, false unlocks') }, ['id', 'locked']),
      handler: (a) => {
        const id = requireString(a, 'id');
        const wall = atlas.readyStore().state.objects.walls?.[id];
        if (!wall) throw new Error(`No wall with id "${id}".`);
        if (wall.type !== 'door' && wall.type !== 'secret-door') throw new Error(`Wall ${id} is a ${wall.type}, not a door.`);
        atlas.actOn('setDoorLocked', id, a.locked !== false);
        const after = atlas.readyStore().state.objects.walls[id];
        return { id, locked: !!after.locked, closed: after.closed !== false };
      },
    },
    {
      name: 'atlas_list_walls',
      description: 'List walls and doors of the open scene (ids, endpoints in pixels, door state). Filter with type to get just the doors.',
      inputSchema: obj({ type: enumOf(['solid', 'door', 'secret-door'], 'only this kind') }),
      handler: (a) => {
        const walls = Object.values(atlas.readyStore().state.objects.walls ?? {}) as any[];
        const filtered = a.type ? walls.filter((w) => w.type === a.type) : walls;
        return {
          walls: filtered.map((w) => ({ id: w.id, type: w.type, p1: w.p1, p2: w.p2, closed: w.closed !== false, locked: !!w.locked, blocks: w.blocks ?? 'both', limited: !!w.limited })),
          count: filtered.length,
        };
      },
    },

    // ── lights ───────────────────────────────────────────────────────────────
    {
      name: 'atlas_add_light',
      description: 'Place a light source. emission radii are GAME UNITS (feet/metres as the collection uses), not pixels: {bright, dim, color?, intensity?, animation?} with animation none|torch|candle|pulse|magic. Position by cell or world x/y. Dynamic lighting must be enabled on the scene for players to see it (atlas_set_lighting).',
      write: true,
      needsScene: true,
      inputSchema: obj({
        cell: CELL_SCHEMA,
        col: num('cell column / axial q'),
        row: num('cell row / axial r'),
        x: num('world x'),
        y: num('world y'),
        emission: anyObject('{ bright, dim, color, intensity, animation, angle?, darkness?, priority? }'),
        hidden: bool('switched off by the GM'),
        rotation: num('degrees: which way an angled light shines'),
        activeBelowAmbient: num('only shines while scene ambient is at or below this (0..1)'),
      }, ['emission']),
      handler: (a) => {
        const grid = sceneGrid(ctx);
        const resolve = (p: any) => {
          if (p?.cell) return cellToWorld({ col: p.cell.col ?? p.cell.q, row: p.cell.row ?? p.cell.r }, grid, 1);
          if (typeof p?.col === 'number' && typeof p?.row === 'number') return cellToWorld({ col: p.col, row: p.row }, grid, 1);
          if (typeof p?.x === 'number' && typeof p?.y === 'number') return { x: p.x, y: p.y };
          return null;
        };
        const result = validateLight(a, resolve);
        if (!result.ok) throw new Error(result.error);
        const id = atlas.actOn<string>('addLight', result.value);
        return { id, light: { ...result.value, id } };
      },
    },
    {
      name: 'atlas_update_light',
      description: 'Patch a placed light: x/y, emission fields (merged into the existing emission), hidden, rotation, activeBelowAmbient.',
      write: true,
      needsScene: true,
      inputSchema: obj({
        id: str('light id'),
        x: num('world x'),
        y: num('world y'),
        emission: anyObject('emission fields to merge'),
        hidden: bool('switched off'),
        rotation: num('degrees'),
        activeBelowAmbient: num('0..1'),
      }, ['id']),
      handler: (a) => {
        const grid = sceneGrid(ctx);
        const id = requireString(a, 'id');
        const light = atlas.readyStore().state.objects.lights?.[id];
        if (!light) throw new Error(`No light with id "${id}". See atlas_get_scene path=objects.lights.`);
        const changes: Record<string, unknown> = {};
        if (typeof a.x === 'number') changes.x = a.x;
        if (typeof a.y === 'number') changes.y = a.y;
        if (typeof a.hidden === 'boolean') changes.hidden = a.hidden;
        if (typeof a.rotation === 'number') changes.rotation = a.rotation;
        if (typeof a.activeBelowAmbient === 'number') changes.activeBelowAmbient = a.activeBelowAmbient;
        if (isPlainObject(a.emission)) changes.emission = { ...light.emission, ...a.emission };
        if (!Object.keys(changes).length) throw new Error('Nothing to change: pass x/y, emission, hidden, rotation or activeBelowAmbient.');
        atlas.actOn('updateLight', id, changes);
        return { id, light: atlas.readyStore().state.objects.lights[id], grid: summariseGrid(grid) };
      },
    },
    {
      name: 'atlas_remove_light',
      description: 'Delete one light source (undoable).',
      write: true,
      needsScene: true,
      inputSchema: obj({ id: str('light id') }, ['id']),
      handler: (a) => {
        const id = requireString(a, 'id');
        if (!atlas.readyStore().state.objects.lights?.[id]) throw new Error(`No light with id "${id}".`);
        atlas.actOn('deleteLight', id);
        return { removed: id };
      },
    },
    {
      name: 'atlas_set_lighting',
      description: 'Change the scene\'s dynamic lighting: enabled (the master switch), ambient (0 = pitch black, 1 = daylight), tokenVision, exploredMemory and the threshold colours. Note: Atlas does not put lighting into its undo history, so atlas_undo will not revert this.',
      write: true,
      needsScene: true,
      inputSchema: obj({
        enabled: bool('dynamic lighting on/off'),
        ambient: num('ambient light 0..1'),
        ambientColor: str('#rrggbb tint of the ambient light'),
        tokenVision: bool('tokens limit what players see'),
        exploredMemory: bool('keep a memory of what players saw'),
        exploredColor: str('#rrggbb tint of remembered areas'),
        unexploredColor: str('#rrggbb fill of never-seen areas'),
        litThreshold: num('0..1 from which an area counts as dimly lit'),
        brightThreshold: num('0..1 from which it counts as bright'),
        sightOnDrop: bool('sight follows the drop point, not the drag'),
      }),
      handler: (a) => {
        const changes: Record<string, unknown> = {};
        for (const key of ['enabled', 'ambient', 'ambientColor', 'tokenVision', 'exploredMemory', 'exploredColor', 'unexploredColor', 'litThreshold', 'brightThreshold', 'sightOnDrop'] as const) {
          if (a[key] !== undefined) changes[key] = a[key];
        }
        if (!Object.keys(changes).length) throw new Error('Pass at least one lighting field.');
        if (typeof changes.ambient === 'number' && (changes.ambient < 0 || changes.ambient > 1)) throw new Error('ambient must be 0..1');
        const before = atlas.readyStore().state.lighting;
        atlas.actOn('setSceneLighting', changes);
        return { before, after: atlas.readyStore().state.lighting, undoable: false };
      },
    },
    {
      name: 'atlas_add_light_zone',
      description: 'Draw an area with its own ambient light (a lit hall in a dark dungeon, a cave mouth by day). `points` are world pixels or cells, at least three, in order. Later zones lie over earlier ones.',
      write: true,
      needsScene: true,
      inputSchema: obj({
        points: { type: 'array', description: '[{x,y} | {col,row}, …] at least 3', items: { type: 'object', additionalProperties: true } },
        ambient: num('ambient light inside, 0..1'),
        ambientColor: str('#rrggbb tint'),
        name: str('what this zone is, for narration'),
      }, ['points', 'ambient']),
      handler: (a) => {
        const grid = sceneGrid(ctx);
        const raw = Array.isArray(a.points) ? a.points : [];
        if (raw.length < 3) throw new Error('points needs at least three corners');
        const polygon = raw.map((p: any) => (typeof p.x === 'number' ? { x: p.x, y: p.y } : cellToWorld({ col: p.col ?? p.q, row: p.row ?? p.r }, grid, 1)));
        const ambient = Number(a.ambient);
        if (!(ambient >= 0 && ambient <= 1)) throw new Error('ambient must be 0..1');
        const input = { polygon, ambient, ...(a.ambientColor ? { ambientColor: a.ambientColor } : {}), ...(a.name ? { name: a.name } : {}) };
        const id = atlas.actOn<string>('addLightZone', input);
        return { id, ...input };
      },
    },
    {
      name: 'atlas_update_light_zone',
      description: 'Patch a light zone: polygon, ambient, ambientColor, name.',
      write: true,
      needsScene: true,
      inputSchema: obj({
        id: str('light zone id'),
        points: { type: 'array', description: 'new polygon corners', items: { type: 'object', additionalProperties: true } },
        ambient: num('0..1'),
        ambientColor: str('#rrggbb or null to clear'),
        name: str('name or null to clear'),
      }, ['id']),
      handler: (a) => {
        const grid = sceneGrid(ctx);
        const id = requireString(a, 'id');
        const zone = atlas.readyStore().state.objects.lightZones?.[id];
        if (!zone) throw new Error(`No light zone with id "${id}".`);
        const changes: Record<string, unknown> = {};
        if (Array.isArray(a.points) && a.points.length >= 3) {
          changes.polygon = a.points.map((p: any) => (typeof p.x === 'number' ? { x: p.x, y: p.y } : cellToWorld({ col: p.col ?? p.q, row: p.row ?? p.r }, grid, 1)));
        }
        if (typeof a.ambient === 'number') changes.ambient = a.ambient;
        if (a.ambientColor !== undefined) changes.ambientColor = a.ambientColor || undefined;
        if (a.name !== undefined) changes.name = a.name || undefined;
        if (!Object.keys(changes).length) throw new Error('Nothing to change.');
        atlas.actOn('updateLightZone', id, changes);
        return { id, zone: atlas.readyStore().state.objects.lightZones[id] };
      },
    },
    {
      name: 'atlas_remove_light_zone',
      description: 'Delete a light zone (undoable).',
      write: true,
      needsScene: true,
      inputSchema: obj({ id: str('light zone id') }, ['id']),
      handler: (a) => {
        const id = requireString(a, 'id');
        if (!atlas.readyStore().state.objects.lightZones?.[id]) throw new Error(`No light zone with id "${id}".`);
        atlas.actOn('deleteLightZone', id);
        return { removed: id };
      },
    },

    // ── texts ────────────────────────────────────────────────────────────────
    {
      name: 'atlas_add_text',
      description: 'Place a text label on the map (a caption, an area name). Position by cell or world x/y; fontSize and colour are optional.',
      write: true,
      needsScene: true,
      inputSchema: obj({
        text: str('the text'),
        cell: CELL_SCHEMA,
        col: num('cell column'),
        row: num('cell row'),
        x: num('world x'),
        y: num('world y'),
        fontSize: num('pixels (default 24)'),
        color: str('#rrggbb (default #ffffff)'),
        backgroundColor: str('#rrggbb or omit'),
        align: enumOf(['left', 'center', 'right'], 'alignment'),
        bold: bool('bold'),
        italic: bool('italic'),
        rotation: num('degrees'),
      }, ['text']),
      handler: (a) => {
        const grid = sceneGrid(ctx);
        const point = pointFrom(a, grid, 1);
        const input = {
          text: requireString(a, 'text'),
          x: point.x,
          y: point.y,
          fontSize: typeof a.fontSize === 'number' ? a.fontSize : 24,
          fontFamily: 'Arial',
          color: a.color ?? '#ffffff',
          align: a.align ?? 'left',
          ...(a.backgroundColor ? { backgroundColor: a.backgroundColor } : {}),
          ...(a.bold !== undefined ? { bold: !!a.bold } : {}),
          ...(a.italic !== undefined ? { italic: !!a.italic } : {}),
          ...(typeof a.rotation === 'number' ? { rotation: a.rotation } : {}),
        };
        const id = atlas.actOn<string>('addText', input);
        return { id, ...placementResult(point, grid, 1), text: input.text };
      },
    },
    {
      name: 'atlas_update_text',
      description: 'Patch a text element (text, position, colour, size …).',
      write: true,
      needsScene: true,
      inputSchema: obj({ id: str('text id'), updates: anyObject('fields to change') }, ['id', 'updates']),
      handler: (a) => {
        const id = requireString(a, 'id');
        if (!atlas.readyStore().state.objects.texts?.[id]) throw new Error(`No text element with id "${id}".`);
        const updates = isPlainObject(a.updates) ? a.updates : {};
        if (!Object.keys(updates).length) throw new Error('updates is empty');
        atlas.actOn('updateText', id, updates);
        return { id, text: atlas.readyStore().state.objects.texts[id] };
      },
    },
    {
      name: 'atlas_remove_text',
      description: 'Delete a text element (undoable).',
      write: true,
      needsScene: true,
      inputSchema: obj({ id: str('text id') }, ['id']),
      handler: (a) => {
        const id = requireString(a, 'id');
        if (!atlas.readyStore().state.objects.texts?.[id]) throw new Error(`No text element with id "${id}".`);
        atlas.actOn('deleteText', id);
        return { removed: id };
      },
    },

    // ── note pins ────────────────────────────────────────────────────────────
    {
      name: 'atlas_add_pin',
      description: 'Drop a pin that links a vault note onto the map (a location marker). On hex grids pass hex:true to link the note to the whole cell.',
      write: true,
      needsScene: true,
      inputSchema: obj({
        notePath: str('vault path of the note, e.g. "notes/Tavern.md"'),
        cell: CELL_SCHEMA,
        col: num('cell column'),
        row: num('cell row'),
        x: num('world x'),
        y: num('world y'),
        icon: str('pin icon id (see Atlas pin palette)'),
        label: str('label shown on the pin'),
        gmOnly: bool('GM-only pin'),
        hex: bool('link the note to the hex cell (hex grids)'),
        readable: bool('players may read the note once they find the pin'),
      }, ['notePath']),
      handler: (a) => {
        const grid = sceneGrid(ctx);
        const notePath = requireString(a, 'notePath');
        if (!ctx.app.vault.getAbstractFileByPath(notePath)) throw new Error(`Note not found in the vault: ${notePath}`);
        const point = pointFrom(a, grid, 1);
        const id = atlas.actOn<string>('addNotePin', point.x, point.y, notePath, a.icon, {
          ...(a.hex !== undefined ? { hex: !!a.hex } : {}),
        });
        const patch: Record<string, unknown> = {};
        if (a.label !== undefined) patch.label = a.label;
        if (a.gmOnly !== undefined) patch.gmOnly = !!a.gmOnly;
        if (a.readable !== undefined) patch.readable = !!a.readable;
        if (Object.keys(patch).length) atlas.actOn('updateNotePin', id, patch);
        return { id, notePath, ...placementResult(point, grid, 1) };
      },
    },
    {
      name: 'atlas_update_pin',
      description: 'Patch a note pin (icon, label, notePath, gmOnly, readable, position).',
      write: true,
      needsScene: true,
      inputSchema: obj({ id: str('pin id'), updates: anyObject('fields to change') }, ['id']),
      handler: (a) => {
        const id = requireString(a, 'id');
        if (!atlas.readyStore().state.objects.pins?.[id]) throw new Error(`No pin with id "${id}".`);
        const updates = isPlainObject(a.updates) ? a.updates : {};
        if (!Object.keys(updates).length) throw new Error('updates is empty');
        atlas.actOn('updateNotePin', id, updates);
        return { id, pin: atlas.readyStore().state.objects.pins[id] };
      },
    },
    {
      name: 'atlas_remove_pin',
      description: 'Delete a note pin (undoable; the note itself is untouched).',
      write: true,
      needsScene: true,
      inputSchema: obj({ id: str('pin id') }, ['id']),
      handler: (a) => {
        const id = requireString(a, 'id');
        if (!atlas.readyStore().state.objects.pins?.[id]) throw new Error(`No pin with id "${id}".`);
        atlas.actOn('deleteNotePin', id);
        return { removed: id };
      },
    },
  ];
}
