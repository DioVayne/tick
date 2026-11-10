// Fixes uit ronde w1: geen 500 op een JSON-body die geen object is, back-up met onleesbare datums, terugzetten in een
// gedeelde lijst, en de lijst van een subtaak.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, callAs, callWith, createTask, createUser, INBOX, json, openEnv, session, type Task } from './helpers';

type User = Awaited<ReturnType<typeof createUser>>;
const uniq = () => crypto.randomUUID().slice(0, 8);
const keyOf = async (res: Response) => (await json<{ key: string }>(res)).key;

describe('A: een JSON-body die geen object is', () => {
  it('POST/PATCH taken, lijsten, plekken en push geven 400 err.invalid_json', async () => {
    const t = await createTask({ title: 'w1-body' });
    const routes: [string, string][] = [
      ['POST', '/api/tasks'], ['PATCH', `/api/tasks/${t.id}`], ['POST', '/api/lists'], ['POST', '/api/lists/rename'],
      ['POST', '/api/lists/delete'], ['POST', '/api/inbox'], ['POST', '/api/push/subscribe'], ['DELETE', '/api/push/subscribe'],
      ['POST', '/api/places'], ['POST', `/api/tasks/${t.id}/snooze`],
    ];
    for (const [method, path] of routes) {
      for (const body of [null, 'x', 5, [1, 2], true]) {
        const res = await call(path, { method, json: body, auth: path === '/api/inbox' ? INBOX : undefined });
        expect(res.status, `${method} ${path} ${JSON.stringify(body)}`).toBe(400);
        expect(await keyOf(res), `${method} ${path} ${JSON.stringify(body)}`).toBe('err.invalid_json');
      }
    }
  });

  it('snoozen zonder body blijft 60 minuten', async () => {
    const t = await createTask({ title: 'w1-snooze' });
    const res = await call(`/api/tasks/${t.id}/snooze`, { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('melden met een body die geen object is: 400', async () => {
    const u = await createUser();
    for (const body of [null, 'x', [1]]) {
      const res = await callWith(openEnv, '/api/reports', { method: 'POST', json: body, cookie: u.cookie });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await keyOf(res)).toBe('err.invalid_json');
    }
  });

  it('MCP: arguments of params die geen object zijn, geven een JSON-RPC-fout en geen 500', async () => {
    for (const params of [{ name: 'create_task', arguments: 'x' }, { name: 'create_task', arguments: [1] }, 'x', 5]) {
      const res = await call('/mcp', { method: 'POST', json: { jsonrpc: '2.0', id: 1, method: 'tools/call', params } });
      expect(res.status, JSON.stringify(params)).toBe(200);
      expect((await json<{ error?: { code: number } }>(res)).error?.code).toBe(-32602);
    }
  });
});

describe('D: back-up met een onleesbare datum', () => {
  const now = new Date().toISOString();
  const base = { position: 1, created_at: now, updated_at: now };

  it('een ritme met een onleesbaar begin valt weg; afvinken geeft geen 500', async () => {
    const cookie = await session();
    const id = crypto.randomUUID();
    const backup = { app: 'tick', version: 1, tasks: [{ ...base, id, title: 'kapot ritme', repeat_rule: 'FREQ=DAILY', repeat_start: 'x', repeat_at: 'y', remind_at: '2099-01-01T09:00:00.000Z' }] };
    expect((await callAs(cookie, '/api/import/backup', { method: 'POST', json: backup })).status).toBe(200);
    const row = await env.DB.prepare('SELECT repeat_rule, repeat_start, repeat_at FROM tasks WHERE id = ?').bind(id).first();
    expect(row).toEqual({ repeat_rule: null, repeat_start: null, repeat_at: null });
    expect((await call(`/api/tasks/${id}/done`, { method: 'POST', json: {} })).status).toBe(200);
  });

  it('een onleesbare herinnering wordt null; een leesbare wordt UTC-ISO', async () => {
    const cookie = await session();
    const bad = crypto.randomUUID();
    const good = crypto.randomUUID();
    const backup = { app: 'tick', version: 1, tasks: [
      { ...base, id: bad, title: 'kapotte herinnering', remind_at: 'morgen' },
      { ...base, id: good, title: 'goede herinnering', remind_at: '2099-01-01T10:00:00+01:00' },
    ] };
    expect((await callAs(cookie, '/api/import/backup', { method: 'POST', json: backup })).status).toBe(200);
    const r = (id: string) => env.DB.prepare('SELECT remind_at FROM tasks WHERE id = ?').bind(id).first<{ remind_at: string | null }>();
    expect((await r(bad))!.remind_at).toBeNull();
    expect((await r(good))!.remind_at).toBe('2099-01-01T09:00:00.000Z');
  });

  it('een goed ritme blijft staan', async () => {
    const cookie = await session();
    const id = crypto.randomUUID();
    const at = '2099-01-04T09:00:00.000Z';
    const backup = { app: 'tick', version: 1, tasks: [{ ...base, id, title: 'goed ritme', repeat_rule: 'FREQ=DAILY', repeat_start: at, repeat_at: at, remind_at: at }] };
    expect((await callAs(cookie, '/api/import/backup', { method: 'POST', json: backup })).status).toBe(200);
    expect(await env.DB.prepare('SELECT repeat_rule, repeat_start, repeat_at FROM tasks WHERE id = ?').bind(id).first())
      .toEqual({ repeat_rule: 'FREQ=DAILY', repeat_start: at, repeat_at: at });
  });
});

const post = (u: User, path: string, body: unknown = {}) => callAs(u.cookie, path, { method: 'POST', json: body });

async function shareList(owner: User, name: string, members: User[]): Promise<string> {
  let id = '';
  for (const u of members) {
    const res = await post(owner, '/api/shared-lists', { name, to_user: u.id });
    expect(res.status).toBe(201);
    id = (await json<{ list_id: string }>(res)).list_id;
    expect((await post(u, `/api/shared-lists/${id}/accept`)).status).toBe(200);
  }
  return id;
}
const sees = async (u: User, id: string) => (await json<Task[]>(await callAs(u.cookie, '/api/tasks'))).some((t) => t.id === id);

describe('E: terugzetten in een gedeelde lijst', () => {
  it('een lid dat zijn prullenbak leegde, ziet de teruggezette taak weer', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const name = `w1-lijst ${uniq()}`;
    const t = await json<Task>(await post(a, '/api/tasks', { title: 'gedeeld', list: name }));
    await shareList(a, name, [b]);
    expect(await sees(b, t.id)).toBe(true);
    expect((await callAs(a.cookie, `/api/tasks/${t.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await post(b, '/api/trash/empty')).status).toBe(200);
    expect((await post(a, `/api/tasks/${t.id}/restore`)).status).toBe(200);
    expect(await sees(b, t.id)).toBe(true);
  });

  it('een lid dat erbij kwam terwijl de taak in de prullenbak lag, ziet hem na terugzetten', async () => {
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    const name = `w1-lijst ${uniq()}`;
    const t = await json<Task>(await post(a, '/api/tasks', { title: 'gedeeld', list: name }));
    await shareList(a, name, [b]);
    expect((await callAs(a.cookie, `/api/tasks/${t.id}`, { method: 'DELETE' })).status).toBe(200);
    await shareList(a, name, [c]);
    expect((await post(a, `/api/tasks/${t.id}/restore`)).status).toBe(200);
    expect(await sees(c, t.id)).toBe(true);
    expect(await sees(b, t.id)).toBe(true);
    // Geen dubbele deelrij voor wie hem al had.
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM task_shares WHERE task_id = ? AND to_user = ?').bind(t.id, b.id).first<number>('n');
    expect(n).toBe(1);
  });
});

describe('F: de lijst van een subtaak volgt altijd de ouder', () => {
  it('de eigenaar kan een subtaak niet naar een andere lijst zetten', async () => {
    const p = await createTask({ title: 'w1-ouder', list: `w1-A ${uniq()}` });
    const k = await createTask({ title: 'w1-kind', parent_id: p.id });
    const res = await call(`/api/tasks/${k.id}`, { method: 'PATCH', json: { list: `w1-B ${uniq()}`, title: 'w1-kind 2' } });
    expect(res.status).toBe(200);
    expect(await json<Task>(res)).toMatchObject({ list: p.list, title: 'w1-kind 2', parent_id: p.id });
    await call(`/api/tasks/${k.id}`, { method: 'PATCH', json: { list: `w1-C ${uniq()}` } });
    expect((await env.DB.prepare('SELECT list FROM tasks WHERE id = ?').bind(k.id).first<{ list: string }>())!.list).toBe(p.list);
  });

  it('losmaken met een nieuwe lijst kan nog wel', async () => {
    const p = await createTask({ title: 'w1-ouder', list: `w1-A ${uniq()}` });
    const k = await createTask({ title: 'w1-kind', parent_id: p.id });
    const dest = `w1-D ${uniq()}`;
    const res = await call(`/api/tasks/${k.id}`, { method: 'PATCH', json: { parent_id: null, list: dest } });
    expect(res.status).toBe(200);
    expect(await json<Task>(res)).toMatchObject({ list: dest, parent_id: null });
  });
});
