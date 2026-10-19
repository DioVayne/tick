import { Hono, type ExecutionContext } from 'hono';
import type { AppEnv, Env } from './index';

/**
 * MCP-server (Model Context Protocol) voor Claude Code en Claude Desktop: stateless "Streamable HTTP", dus JSON-RPC via
 * POST op /mcp met een JSON-antwoord (geen sessies, geen SSE-stream). Alleen met een `full`-sleutel.
 * Elke tool roept de gewone API aan met dezelfde sleutel, zodat validatie, toegang (delen) en tijdzones op één plek blijven.
 * Tool-beschrijvingen zijn Engels: ze zijn voor het model, niet voor de gebruiker.
 */

type Api = (req: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
type Args = Record<string, unknown>;
type Call = (method: string, path: string, body?: unknown) => Promise<unknown>;

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_DESC = 500;

/** Een 4xx van de API: wordt een tool-resultaat met `isError`, zodat het model de melding ziet. */
class ToolError extends Error {}

const id = { type: 'string', description: 'Task id' };
const remindAt = {
  type: ['string', 'null'],
  description: "Reminder (also the deadline), ISO 8601. Without a time zone it counts in the user's time zone; a bare date (YYYY-MM-DD) means the user's default reminder time. null clears it.",
};
const repeat = {
  type: ['string', 'null'],
  description: 'Repeat rule, an RRULE subset: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, BYDAY (e.g. MO,FR or 3SU/-1SU for months), BYMONTHDAY, UNTIL=YYYYMMDD. Only on top-level tasks with a reminder. null removes it.',
};
const fields = {
  title: { type: 'string', description: 'Title, at most 500 characters' },
  description: { type: 'string', description: 'Notes in markdown; `- [ ]` lines are checklist items' },
  list: { type: 'string', description: 'List name; "Inbox" when left out' },
  remind_at: remindAt,
  repeat,
};

type Tool = { name: string; description: string; inputSchema: Record<string, unknown>; run: (a: Args, api: Call) => Promise<unknown> };

const TOOLS: Tool[] = [
  {
    name: 'list_tasks',
    description: 'List open tasks in display order (pinned first), or completed ones with done=true (newest first). Subtasks are separate items with parent_id.',
    inputSchema: {
      type: 'object',
      properties: {
        list: { type: 'string', description: 'Only tasks in this list' },
        query: { type: 'string', description: 'Search title and notes' },
        done: { type: 'boolean', description: 'Completed tasks instead of open ones' },
        limit: { type: 'integer', minimum: 1, maximum: 500, description: 'At most this many tasks (default 100)' },
      },
    },
    run: async (a, api) => {
      const limit = Number.isInteger(a.limit) ? Math.min(Math.max(a.limit as number, 1), 500) : 100;
      const q = new URLSearchParams();
      if (typeof a.query === 'string' && a.query) q.set('q', a.query);
      if (a.done === true) q.set('done', '1');
      // Gefilterd op lijst ná het ophalen: haal bij voltooide taken dan ruimer op.
      if (a.done === true) q.set('limit', String(typeof a.list === 'string' ? 500 : limit));
      let tasks = await api('GET', `/api/tasks?${q}`) as Args[];
      if (typeof a.list === 'string') {
        const want = a.list.toLowerCase();
        tasks = tasks.filter((t) => String(t.list).toLowerCase() === want);
      }
      return tasks.slice(0, limit).map(compact);
    },
  },
  {
    name: 'list_lists',
    description: 'All list names with the number of open tasks in each.',
    inputSchema: { type: 'object', properties: {} },
    run: (_a, api) => api('GET', '/api/lists'),
  },
  {
    name: 'create_task',
    description: 'Create a task. With parent_id it becomes a subtask (one level deep; it follows the list of its parent).',
    inputSchema: {
      type: 'object',
      properties: { ...fields, parent_id: { type: 'string', description: 'Id of the parent task' } },
      required: ['title'],
    },
    run: async (a, api) => compact(await api('POST', '/api/tasks', pick(a, ['title', 'description', 'list', 'remind_at', 'repeat', 'parent_id'])) as Args),
  },
  {
    name: 'update_task',
    description: 'Change a task; only the given fields change. Use complete_task to check it off.',
    inputSchema: {
      type: 'object',
      properties: { id, ...fields, pinned: { type: 'boolean', description: 'Keep a top-level task on top of its list' } },
      required: ['id'],
    },
    run: async (a, api) => compact(await api('PATCH', `/api/tasks/${seg(a.id)}`, pick(a, ['title', 'description', 'list', 'remind_at', 'repeat', 'pinned'])) as Args),
  },
  {
    name: 'complete_task',
    description: 'Check off a task with its subtasks. A repeating task moves on to its next occurrence and stays open.',
    inputSchema: { type: 'object', properties: { id }, required: ['id'] },
    run: (a, api) => api('POST', `/api/tasks/${seg(a.id)}/done`),
  },
  {
    name: 'reopen_task',
    description: 'Undo completing a task (for a repeating task: within 15 minutes).',
    inputSchema: { type: 'object', properties: { id }, required: ['id'] },
    run: (a, api) => api('POST', `/api/tasks/${seg(a.id)}/reopen`),
  },
  {
    name: 'snooze_task',
    description: 'Move the reminder to a number of minutes from now (only this occurrence of a repeating task).',
    inputSchema: {
      type: 'object',
      properties: { id, minutes: { type: 'integer', minimum: 1, maximum: 43200, description: 'Default 60' } },
      required: ['id'],
    },
    run: (a, api) => api('POST', `/api/tasks/${seg(a.id)}/snooze`, a.minutes === undefined ? {} : { minutes: a.minutes }),
  },
  {
    name: 'delete_task',
    description: 'Move a task and its subtasks to the trash (restorable in the app for 30 days). For a shared task it goes for everyone.',
    inputSchema: { type: 'object', properties: { id }, required: ['id'] },
    run: (a, api) => api('DELETE', `/api/tasks/${seg(a.id)}`),
  },
];

function seg(v: unknown): string {
  if (typeof v !== 'string' || !v) throw new ToolError('id is required');
  return encodeURIComponent(v);
}

function pick(a: Args, keys: string[]): Args {
  return Object.fromEntries(keys.filter((k) => k in a).map((k) => [k, a[k]]));
}

/** Alleen wat het model nodig heeft; spaart tokens. */
function compact(t: Args): Args {
  const desc = typeof t.description === 'string' ? t.description : '';
  const share = t.share as { owner: { name: string }; mine: boolean } | null;
  const loc = t.location as { name: string; trigger: string } | null;
  return {
    id: t.id, title: t.title, list: t.list, parent_id: t.parent_id ?? undefined,
    description: desc ? (desc.length > MAX_DESC ? desc.slice(0, MAX_DESC) + '…' : desc) : undefined,
    remind_at: t.remind_at ?? undefined,
    repeat: (t.repeat as { rule: string } | null)?.rule,
    pinned: t.pinned || undefined,
    done: t.done || undefined, done_at: t.done_at ?? undefined,
    location: loc ? `${loc.trigger === 'exit' ? 'leaving' : 'arriving at'} ${loc.name}` : undefined,
    shared_by: share && !share.mine ? share.owner.name : undefined,
  };
}

const rpc = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

export function mcpApi(api: Api) {
  const mcp = new Hono<AppEnv>();

  // Geen SSE-stream: een client die er een opent, krijgt 405 en werkt verder met POST.
  mcp.get('/', (c) => c.body(null, 405, { Allow: 'POST' }));

  mcp.post('/', async (c) => {
    const kind = c.get('auth').kind;
    // Alleen een full-sleutel (of lokaal de bypass): een browsersessie hoort hier niet, dat sluit ook CSRF uit.
    if (kind !== 'token' && kind !== 'dev') return c.text('Forbidden', 403);
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(c.req.url).origin) return c.text('Forbidden', 403); // DNS-rebinding
    const msg = await c.req.json<Args>().catch(() => null);
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string') {
      return c.json(rpcError(null, -32600, 'Invalid request'), 400);
    }
    // Notificaties (zonder id) en antwoorden krijgen geen JSON-RPC-antwoord.
    if (!('id' in msg)) return c.body(null, 202);
    const params = (msg.params ?? {}) as Args;

    switch (msg.method) {
      case 'initialize': {
        const asked = String(params.protocolVersion ?? '');
        return c.json(rpc(msg.id, {
          protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'tick', version: '1.0.0' },
          instructions: "Tick is the user's to-do app. Times are stored in UTC; send local times without a zone and Tick uses the user's time zone.",
        }));
      }
      case 'ping':
        return c.json(rpc(msg.id, {}));
      case 'tools/list':
        return c.json(rpc(msg.id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }));
      case 'tools/call': {
        const tool = TOOLS.find((t) => t.name === params.name);
        if (!tool) return c.json(rpcError(msg.id, -32602, `Unknown tool: ${String(params.name)}`));
        const call: Call = async (method, path, body) => {
          const headers = new Headers();
          for (const h of ['authorization', 'accept-language', 'cookie', 'cf-connecting-ip']) {
            const v = c.req.header(h);
            if (v) headers.set(h, v);
          }
          if (body !== undefined) headers.set('content-type', 'application/json');
          const res = await api(new Request(new URL(path, c.req.url), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), c.env, c.executionCtx);
          const data = await res.json<Args>().catch((): Args => ({}));
          if (res.status >= 400 && res.status < 500) throw new ToolError(String(data.error ?? res.statusText));
          if (!res.ok) throw new Error(`API ${method} ${path}: ${res.status}`);
          return data;
        };
        try {
          const out = await tool.run((params.arguments ?? {}) as Args, call);
          return c.json(rpc(msg.id, { content: [{ type: 'text', text: JSON.stringify(out) }] }));
        } catch (e) {
          if (!(e instanceof ToolError)) throw e;
          return c.json(rpc(msg.id, { content: [{ type: 'text', text: e.message }], isError: true }));
        }
      }
      default:
        return c.json(rpcError(msg.id, -32601, `Method not found: ${msg.method}`));
    }
  });

  return mcp;
}
