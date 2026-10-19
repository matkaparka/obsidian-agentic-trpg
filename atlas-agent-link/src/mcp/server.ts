/**
 * Minimal MCP server: JSON-RPC 2.0 over HTTP, tools only.
 *
 * Deliberately hand-written and small: Obsidian plugins cannot rely on extra npm packages, and
 * the MCP "Streamable HTTP" shape this needs is a handful of methods. Notifications get no body
 * (HTTP 202), which is what the transport expects.
 */
import { isRetryable } from '../errors';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Write tools are refused while writes are disabled (read-only mode / kill switch). */
  write?: boolean;
  handler: (args: any) => Promise<unknown> | unknown;
}export interface McpOptions {
  tools: () => ToolDef[];
  allowWrite: () => boolean;
  onCall?: (e: { tool: string; args: unknown; ok: boolean; error?: string; ms: number }) => void;
  serverInfo?: { name: string; version: string };
}

type Json = any;
const ok = (id: Json, result: Json) => ({ jsonrpc: '2.0', id, result });
const err = (id: Json, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

const INSTRUCTIONS = [
  'Control an Atlas VTT scene. Call atlas_probe first, then atlas_scene_summary to see what is on the table.',
  'Coordinates: x/y are world pixels; cells are {col,row} (hex: {q,r}). Odd-footprint tokens sit on a cell centre, even ones where cells meet — atlas_cell_to_world does the conversion Atlas uses.',
  'Fog: action reveal erases fog, hide paints it back.',
  'Dice: always atlas_roll_dice — it rolls in code and writes Atlas\' own log; never state a result you did not get from it.',
  'Every write is one Atlas undo step; atlas_undo reverts it. Writes are refused entirely while the operator has read-only mode on.',
].join('\n');

export class McpServer {
  constructor(private o: McpOptions) {}

  /** Returns null for notifications (the transport answers 202). */
  async handle(msg: Json): Promise<Json | null> {
    if (Array.isArray(msg)) {
      const results = (await Promise.all(msg.map((m) => this.handle(m)))).filter((r) => r !== null);
      return results.length ? results : null;
    }
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return err(msg?.id ?? null, -32600, 'Invalid Request');
    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null && method.startsWith('notifications/');
    try {
      switch (method) {
        case 'initialize':
          return ok(id, {
            protocolVersion: params?.protocolVersion ?? '2025-03-26',
            capabilities: { tools: { listChanged: false } },
            serverInfo: this.o.serverInfo ?? { name: 'atlas-agent-link', version: '0.2.0' },
            instructions: INSTRUCTIONS,
          });
        case 'ping':
          return ok(id, {});
        case 'tools/list':
          return ok(id, {
            tools: this.o.tools().map(({ name, description, inputSchema, write }) => ({
              name,
              description,
              inputSchema,
              annotations: { readOnlyHint: !write, destructiveHint: !!write, openWorldHint: false },
            })),
          });
        case 'tools/call':
          return ok(id, await this.call(params?.name, params?.arguments ?? {}));
        case 'notifications/initialized':
        case 'notifications/cancelled':
          return null;
        default:
          if (msg.id === undefined || method.startsWith('notifications/')) return null;
          return err(id, -32601, `Method not found: ${method}`);
      }
    } catch (e: any) {
      if (msg.id === undefined) return null;
      return err(id, -32603, e?.message ?? String(e));
    }
  }

  private async call(name: string, args: Json) {
    const t0 = Date.now();
    const tool = this.o.tools().find((t) => t.name === name);
    const done = (didOk: boolean, error?: string) => this.o.onCall?.({ tool: name, args, ok: didOk, error, ms: Date.now() - t0 });
    if (!tool) {
      done(false, 'unknown tool');
      return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}. Call tools/list for the current set.` }] };
    }
    if (tool.write && !this.o.allowWrite()) {
      done(false, 'writes disabled');
      return {
        isError: true,
        content: [{
          type: 'text',
          text: 'Write access is disabled (read-only mode or kill switch). This is an operator decision: ask them to enable writes in the Atlas Agent Link settings or run the "Toggle AI write access" command. You can still use the read tools.',
        }],
      };
    }
    try {
      // Atlas loads and saves asynchronously: a call that lands mid-load is retried, not failed.
      let result: unknown;
      const attempts = 4;
      for (let attempt = 0; ; attempt++) {
        try {
          result = await tool.handler(args);
          break;
        } catch (e) {
          if (attempt < attempts - 1 && isRetryable(e)) {
            await new Promise((r) => setTimeout(r, 250));
            continue;
          }
          throw e;
        }
      }
      done(true);
      if (result && typeof result === 'object' && Array.isArray((result as any).__mcpContent)) {
        return { content: (result as any).__mcpContent };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result ?? { ok: true }, null, 1) }] };
    } catch (e: any) {
      done(false, e?.message);
      return { isError: true, content: [{ type: 'text', text: `Error: ${e?.message ?? e}` }] };
    }
  }
}
