/** Tool registry: one list, assembled from the scene, object and combat modules. */
import { combatTools } from './combat';
import { objectTools } from './objects';
import { playerTools } from './player';
import { sceneTools } from './scene';
import type { ToolCtx, ToolDef } from './shared';

export type { ToolCtx, ToolDef, CallRecord } from './shared';
export { DEFAULT_APPLY_ALLOWLIST } from '../settings';

export function buildTools(ctx: ToolCtx): ToolDef[] {
  const tools = [...sceneTools(ctx), ...objectTools(ctx), ...combatTools(ctx), ...playerTools(ctx)];
  const seen = new Set<string>();
  for (const t of tools) {
    if (seen.has(t.name)) throw new Error(`Duplicate tool name: ${t.name}`);
    seen.add(t.name);
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name));
}
