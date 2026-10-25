import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TaskRow } from '../src/index';
import { loadInstallPrefs } from '../src/prefs';
import { type Payload, runReminders, type Sender, sendToAll } from '../src/push';
import { listPush, notifyListDone } from '../src/sharedlists';
import { ADMIN_ID, call, callAs, createUser, json, type Task } from './helpers';

type User = Awaited<ReturnType<typeof createUser>>;
type Person = { id: string; name: string } | null;
type ListTask = Task & { shared_list: string | null; done_by: Person; claimed_by: Person; watch: boolean };

const uniq = () => crypto.randomUUID().slice(0, 8);
const as = (u: User | null, path: string, init: RequestInit & { json?: unknown } = {}) => (u ? callAs(u.cookie, path, init) : call(path, init));
const post = (u: User | null, path: string, body: unknown = {}) => as(u, path, { method: 'POST', json: body });
const patch = (u: User | null, id: string, body: unknown) => as(u, `/api/tasks/${id}`, { method: 'PATCH', json: body });
const taskOf = async (u: User | null, id: string) => (await json<ListTask[]>(await as(u, '/api/tasks'))).find((x) => x.id === id);
const row = async (id: string) => (await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>())!;
const newTask = async (u: User | null, body: Record<string, unknown>) => {
  const res = await post(u, '/api/tasks', body);
  expect(res.status).toBe(201);
  return json<ListTask>(res);
};
const errorOf = async (res: Response) => (await json<{ error: string }>(res)).error;
/** Even wachten op meldingen die op de achtergrond gaan, ook als er geen komt. */
const settle = () => new Promise((r) => setTimeout(r, 50));

/** Sender die bijhoudt wie wat kreeg (in het Nederlands), zonder abonnementen. */
function fakeSender() {
  const calls: { userId: string; p: Payload }[] = [];
  const send: Sender = async (_env, userId, make) => {
    calls.push({ userId, p: make('nl') });
    return { ok: 1, total: 1 };
  };
  return { send, calls };
}

describe('gedeelde lijsten: ik pak het op en meldingen', () => {
  let b: User; let c: User; let d: User;
  let bName: string; let cName: string;
  beforeAll(async () => {
    bName = `Bea ${uniq()}`;
    cName = `Cas ${uniq()}`;
    b = await createUser({ name: bName });
    c = await createUser({ name: cName });
    d = await createUser({ name: `Dirk ${uniq()}` });
  });
  afterEach(() => { listPush.send = sendToAll; });

  /** A (de beheerder) deelt een nieuwe lijst "Weekend …" met B en C, en beide accepteren. */
  async function weekend() {
    const name = `Weekend ${uniq()}`;
    await call('/api/lists', { method: 'POST', json: { name } });
    let id = '';
    for (const u of [b, c]) {
      const res = await call('/api/shared-lists', { method: 'POST', json: { name, to_user: u.id } });
      expect(res.status).toBe(201);
      id = (await json<{ list_id: string }>(res)).list_id;
      expect((await post(u, `/api/shared-lists/${id}/accept`)).status).toBe(200);
    }
    return { name, id };
  }

  it('op naam zetten en loslaten', async () => {
    const { name } = await weekend();
    const pushes = fakeSender();
    listPush.send = pushes.send;
    const t = await newTask(null, { title: 'Barbecue', list: name });
    const res = await patch(b, t.id, { claimed: true });
    expect(res.status).toBe(200);
    expect((await json<ListTask>(res)).claimed_by).toEqual({ id: b.id, name: bName });
    for (const u of [null, b, c]) expect((await taskOf(u, t.id))!.claimed_by).toEqual({ id: b.id, name: bName });
    const taken = await patch(c, t.id, { claimed: true });
    expect(taken.status).toBe(409);
    expect(await errorOf(taken)).toBe(`${bName} is already on this.`);
    expect((await patch(c, t.id, { claimed: false })).status).toBe(409);
    expect((await patch(b, t.id, { claimed: true })).status).toBe(200); // nog eens: niets aan de hand
    const free = await patch(b, t.id, { claimed: false });
    expect(free.status).toBe(200);
    expect((await json<ListTask>(free)).claimed_by).toBeNull();
    expect((await patch(c, t.id, { claimed: false })).status).toBe(200); // niemand: niets
    expect((await patch(c, t.id, { claimed: true })).status).toBe(200);
    expect((await row(t.id)).claimed_by).toBe(c.id);
    // Alleen open hoofdtaken in een gedeelde lijst.
    const kid = await newTask(null, { title: 'Kolen', parent_id: t.id });
    expect(await errorOf(await patch(b, kid.id, { claimed: true }))).toBe('Only an open task in a shared list can be taken on.');
    const own = await newTask(b, { title: 'Eigen', list: 'Thuis' });
    expect((await patch(b, own.id, { claimed: true })).status).toBe(400);
    const done = await newTask(null, { title: 'Klaar', list: name });
    expect((await post(null, `/api/tasks/${done.id}/done`)).status).toBe(200);
    expect((await patch(b, done.id, { claimed: true })).status).toBe(400);
    expect((await patch(b, t.id, { claimed: 'ja' })).status).toBe(400);
    await settle();
    expect(pushes.calls).toEqual([]); // op naam zetten of loslaten meldt niets
  });

  it('alleen wie hem oppakt vinkt af', async () => {
    const { name } = await weekend();
    const t = await newTask(null, { title: 'Tent', list: name });
    const kid = await newTask(null, { title: 'Haringen', parent_id: t.id });
    expect((await patch(b, t.id, { claimed: true })).status).toBe(200);
    const viaPatch = await patch(c, t.id, { done: true });
    expect(viaPatch.status).toBe(403);
    expect(await errorOf(viaPatch)).toBe(`${bName} is already on this.`);
    expect((await post(c, `/api/tasks/${t.id}/done`)).status).toBe(403);
    expect((await patch(c, kid.id, { done: true })).status).toBe(403);
    expect((await row(t.id)).done).toBe(0);
    expect((await row(kid.id)).done).toBe(0);
    const res = await patch(b, t.id, { done: true });
    expect(res.status).toBe(200);
    expect(await json<ListTask>(res)).toMatchObject({ done: true, done_by: { id: b.id, name: bName }, claimed_by: { id: b.id, name: bName } });
    expect((await post(c, `/api/tasks/${t.id}/reopen`)).status).toBe(403);
    expect((await patch(c, t.id, { done: false })).status).toBe(403);
    expect((await row(t.id)).done).toBe(1);
  });

  it('vertrekken laat taken vrij', async () => {
    const { name, id } = await weekend();
    const t = await newTask(null, { title: 'Zwembad', list: name });
    expect((await patch(b, t.id, { claimed: true, watch: true })).status).toBe(200);
    expect((await as(b, `/api/shared-lists/${id}/members/${b.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await taskOf(c, t.id))!.claimed_by).toBeNull();
    expect((await env.DB.prepare('SELECT count(*) AS n FROM task_watch WHERE task_id = ?').bind(t.id).first<{ n: number }>())!.n).toBe(0);
    expect((await post(c, `/api/tasks/${t.id}/done`)).status).toBe(200);
  });

  it('geen meldingen standaard', async () => {
    const { name } = await weekend();
    const t = await newTask(b, { title: 'Hout', list: name });
    const pushes = fakeSender();
    listPush.send = pushes.send;
    expect((await post(c, `/api/tasks/${t.id}/done`)).status).toBe(200);
    expect((await patch(c, (await newTask(c, { title: 'Markt', list: name })).id, {
      location: { name: 'Markt', lat: 52.09, lng: 5.12, radius: 200, trigger: 'enter' },
    })).status).toBe(200);
    await settle();
    expect(pushes.calls).toEqual([]);
  });

  it('melding op lijstniveau', async () => {
    const { name, id } = await weekend();
    expect((await as(null, `/api/shared-lists/${id}/me`, { method: 'PATCH', json: { notify_done: true } })).status).toBe(200);
    const t = await newTask(b, { title: 'Ijs', list: name });
    const pushes = fakeSender();
    listPush.send = pushes.send;
    expect((await post(c, `/api/tasks/${t.id}/done`)).status).toBe(200);
    await expect.poll(() => pushes.calls.length).toBe(1);
    await settle();
    expect(pushes.calls).toEqual([{ userId: ADMIN_ID, p: expect.objectContaining({ title: `${cName} heeft dit afgevinkt ✓`, body: 'Ijs' }) }]);
    // Ook wie de melding aan heeft, krijgt zijn eigen afvinken niet te horen.
    pushes.calls.length = 0;
    const own = await newTask(null, { title: 'Bier', list: name });
    expect((await post(null, `/api/tasks/${own.id}/done`)).status).toBe(200);
    await settle();
    expect(pushes.calls).toEqual([]);
  });

  it('melding op taakniveau', async () => {
    const { name } = await weekend();
    const t = await newTask(null, { title: 'Stoelen', list: name });
    const other = await newTask(null, { title: 'Tafel', list: name });
    const res = await patch(b, t.id, { watch: true });
    expect(res.status).toBe(200);
    expect((await json<ListTask>(res)).watch).toBe(true);
    expect((await taskOf(b, t.id))!.watch).toBe(true);
    expect((await taskOf(c, t.id))!.watch).toBe(false);
    const pushes = fakeSender();
    listPush.send = pushes.send;
    expect((await post(c, `/api/tasks/${other.id}/done`)).status).toBe(200);
    expect((await post(c, `/api/tasks/${t.id}/done`)).status).toBe(200);
    await expect.poll(() => pushes.calls.length).toBe(1);
    await settle();
    expect(pushes.calls).toEqual([{ userId: b.id, p: expect.objectContaining({ body: 'Stoelen', url: `/?task=${t.id}` }) }]);
    expect((await json<ListTask>(await patch(b, t.id, { watch: false }))).watch).toBe(false);
    expect((await taskOf(b, t.id))).toBeUndefined(); // afgevinkt, dus niet meer in de open taken
    const own = await newTask(b, { title: 'Eigen', list: 'Thuis' });
    const outside = await patch(b, own.id, { watch: true });
    expect(outside.status).toBe(400);
    expect(await errorOf(outside)).toBe('Only a task in a shared list can have its own notification.');
    expect((await patch(b, t.id, { watch: 1 })).status).toBe(400);
  });

  it('notifyListDone met een eigen sender', async () => {
    const { name, id } = await weekend();
    expect((await as(c, `/api/shared-lists/${id}/me`, { method: 'PATCH', json: { notify_done: true } })).status).toBe(200);
    const t = await newTask(null, { title: 'Parasol', list: name });
    expect((await patch(b, t.id, { watch: true })).status).toBe(200);
    const pushes = fakeSender();
    await notifyListDone(env, await row(t.id), b.id, bName, 'nl', pushes.send);
    expect(pushes.calls.map((x) => x.userId)).toEqual([c.id]); // B deed het zelf
    pushes.calls.length = 0;
    await notifyListDone(env, await row(t.id), ADMIN_ID, 'Tick', 'nl', pushes.send);
    expect(pushes.calls.map((x) => x.userId).sort()).toEqual([b.id, c.id].sort());
  });

  it('herinnering naar elk lid één keer', async () => {
    const { name, id } = await weekend();
    expect((await call('/api/shared-lists', { method: 'POST', json: { name, to_user: d.id } })).status).toBe(201); // D: openstaand
    const t = await newTask(b, { title: 'Bellen', list: name, remind_at: new Date(Date.now() - 60_000).toISOString() });
    expect((await row(t.id)).shared_list).toBe(id);
    const first = fakeSender();
    await runReminders(env, await loadInstallPrefs(env), first.send);
    expect(first.calls.filter((x) => x.p.taskId === t.id).map((x) => x.userId).sort()).toEqual([ADMIN_ID, b.id, c.id].sort());
    const second = fakeSender();
    await runReminders(env, await loadInstallPrefs(env), second.send);
    expect(second.calls.filter((x) => x.p.taskId === t.id)).toEqual([]);
  });
});
