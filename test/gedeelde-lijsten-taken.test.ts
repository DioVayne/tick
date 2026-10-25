import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { TaskRow } from '../src/index';
import { ADMIN_ID, call, callAs, createUser, json, type Task } from './helpers';

type User = Awaited<ReturnType<typeof createUser>>;
type ListTask = Task & {
  shared_list: string | null; done_by: { id: string; name: string } | null; claimed_by: { id: string; name: string } | null; watch: boolean; pinned: boolean;
};

const uniq = () => crypto.randomUUID().slice(0, 8);
const as = (u: User | null, path: string, init: RequestInit & { json?: unknown } = {}) => (u ? callAs(u.cookie, path, init) : call(path, init));
const tasksOf = async (u: User | null, q = '') => json<ListTask[]>(await as(u, '/api/tasks' + q));
const listNames = async (u: User | null) => (await json<{ name: string }[]>(await as(u, '/api/lists'))).map((l) => l.name);
const row = async (id: string) => (await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>())!;
const sharesOn = async (taskId: string) => (await env.DB.prepare('SELECT to_user FROM task_shares WHERE task_id = ? ORDER BY to_user')
  .bind(taskId).all<{ to_user: string }>()).results.map((r) => r.to_user);
const post = (u: User | null, path: string, body: unknown = {}) => as(u, path, { method: 'POST', json: body });
const patch = (u: User | null, id: string, body: unknown) => as(u, `/api/tasks/${id}`, { method: 'PATCH', json: body });
const newTask = async (u: User | null, body: Record<string, unknown>) => {
  const res = await post(u, '/api/tasks', body);
  expect(res.status).toBe(201);
  return json<ListTask>(res);
};

describe('taken in een gedeelde lijst', () => {
  let b: User; let c: User; let d: User;
  let cName: string;
  beforeAll(async () => {
    b = await createUser({ name: `Bea ${uniq()}` });
    cName = `Cas ${uniq()}`;
    c = await createUser({ name: cName });
    d = await createUser({ name: `Dirk ${uniq()}` });
  });

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

  it('een taak van een lid is meteen van iedereen', async () => {
    const { name, id } = await weekend();
    const t = await newTask(b, { title: 'Barbecue', list: name });
    expect(t).toMatchObject({ list: name, shared_list: id, done_by: null, claimed_by: null, watch: false });
    for (const u of [null, c]) expect((await tasksOf(u)).find((x) => x.id === t.id)).toMatchObject({ list: name, shared_list: id });
    expect((await row(t.id)).user_id).toBe(ADMIN_ID);
    expect(await sharesOn(t.id)).toEqual([b.id, c.id].sort());
    // De maker heeft hem bovenaan in zijn eigen volgorde.
    const mine = (await tasksOf(b)).filter((x) => !x.parent_id && !x.pinned && x.id !== t.id);
    expect(mine.every((x) => x.position > t.position)).toBe(true);
    // Een subtaak van een lid hoort bij de eigenaar, net als de hoofdtaak.
    const kid = await newTask(c, { title: 'Kolen', parent_id: t.id });
    expect((await row(kid.id)).user_id).toBe(ADMIN_ID);
  });

  it('opnieuw versturen met hetzelfde id dupliceert niets', async () => {
    const { name } = await weekend();
    const body = { id: crypto.randomUUID(), title: 'Tent', list: name };
    expect((await post(b, '/api/tasks', body)).status).toBe(201);
    const again = await post(b, '/api/tasks', body);
    expect(again.status).toBe(200);
    expect(await json(again)).toMatchObject({ id: body.id, list: name });
    expect(await sharesOn(body.id)).toEqual([b.id, c.id].sort());
    expect((await env.DB.prepare('SELECT count(*) AS n FROM tasks WHERE id = ?').bind(body.id).first<{ n: number }>())!.n).toBe(1);
  });

  it('afvinken onthoudt wie', async () => {
    const { name } = await weekend();
    const t = await newTask(null, { title: 'Strandbal', list: name });
    const kid = await newTask(null, { title: 'Pomp', parent_id: t.id });
    expect((await post(c, `/api/tasks/${t.id}/done`)).status).toBe(200);
    const done = await tasksOf(null, '?done=1');
    expect(done.find((x) => x.id === t.id)!.done_by).toEqual({ id: c.id, name: cName });
    expect(done.find((x) => x.id === kid.id)!.done_by).toEqual({ id: c.id, name: cName });
    expect((await patch(b, t.id, { done: false })).status).toBe(200);
    expect((await tasksOf(null)).find((x) => x.id === t.id)!.done_by).toBeNull();
    expect((await row(kid.id)).done_by).toBeNull();
    expect((await patch(c, t.id, { done: true })).status).toBe(200);
    const shared = await tasksOf(b, '?shared_done=1');
    expect(shared.find((x) => x.id === t.id)).toMatchObject({ list: name, done: true, done_by: { id: c.id, name: cName } });
    expect(shared.map((x) => x.id)).not.toContain(kid.id); // alleen hoofdtaken
    expect(shared.every((x) => x.shared_list !== null)).toBe(true);
    // Een gewone afgevinkte taak hoort er niet bij, en die van een lijst waar je niet in zit ook niet.
    const own = await newTask(b, { title: 'Eigen', list: 'Thuis' });
    expect((await post(b, `/api/tasks/${own.id}/done`)).status).toBe(200);
    expect((await tasksOf(b, '?shared_done=1')).map((x) => x.id)).not.toContain(own.id);
    expect((await tasksOf(d, '?shared_done=1')).map((x) => x.id)).not.toContain(t.id);
    // Een verwijderd account geeft null.
    await env.DB.prepare('UPDATE tasks SET done_by = ? WHERE id = ?').bind(crypto.randomUUID(), t.id).run();
    expect((await tasksOf(b, '?shared_done=1')).find((x) => x.id === t.id)!.done_by).toBeNull();
  });

  it('eruit slepen maakt hem persoonlijk', async () => {
    const { name } = await weekend();
    const t = await newTask(b, { title: 'Kaart', list: name });
    const kid = await newTask(b, { title: 'Kompas', parent_id: t.id });
    await env.DB.prepare('INSERT INTO task_watch (task_id, user_id) VALUES (?, ?), (?, ?)').bind(t.id, c.id, t.id, b.id).run();
    const res = await patch(b, t.id, { list: 'Thuis', position: 42 });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ list: 'Thuis', shared_list: null, position: 42 });
    for (const u of [null, c]) {
      for (const x of [t, kid]) expect((await patch(u, x.id, { title: 'x' })).status).toBe(404);
      expect((await tasksOf(u)).map((x) => x.id)).not.toContain(t.id);
    }
    const mine = await tasksOf(b);
    expect(mine.find((x) => x.id === t.id)).toMatchObject({ list: 'Thuis', title: 'Kaart' });
    expect(mine.find((x) => x.id === kid.id)).toMatchObject({ list: 'Thuis', title: 'Kompas' });
    expect(await row(t.id)).toMatchObject({ user_id: b.id, shared_list: null });
    expect((await row(kid.id)).user_id).toBe(b.id);
    expect(await sharesOn(t.id)).toEqual([]);
    const watch = await env.DB.prepare('SELECT user_id FROM task_watch WHERE task_id = ?').bind(t.id).all<{ user_id: string }>();
    expect(watch.results.map((r) => r.user_id)).toEqual([b.id]);
    const later = await newTask(b, { title: 'Zaklamp', parent_id: t.id });
    expect((await row(later.id)).user_id).toBe(b.id);
    // De eigenaar sleept er ook een uit.
    const van = await newTask(null, { title: 'Van A', list: name });
    expect((await patch(null, van.id, { list: 'Privé' })).status).toBe(200);
    expect(await row(van.id)).toMatchObject({ user_id: ADMIN_ID, list: 'Privé', shared_list: null });
    expect((await tasksOf(b)).map((x) => x.id)).not.toContain(van.id);
  });

  it('erin slepen deelt hem', async () => {
    const { name, id } = await weekend();
    const t = await newTask(null, { title: 'Zonnebrand', list: 'Privé' });
    const res = await patch(null, t.id, { list: name });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ list: name, shared_list: id });
    for (const u of [b, c]) expect((await tasksOf(u)).find((x) => x.id === t.id)).toMatchObject({ list: name });
    // Van de ene gedeelde lijst naar de andere: los en weer vast.
    const ander = await weekend();
    expect((await patch(b, t.id, { list: ander.name })).status).toBe(200);
    expect(await row(t.id)).toMatchObject({ user_id: ADMIN_ID, list: ander.name, shared_list: ander.id });
    expect((await tasksOf(c)).find((x) => x.id === t.id)).toMatchObject({ list: ander.name });
    // Een lid sleept zijn eigen taak erin: hij wordt van de eigenaar.
    const eigen = await newTask(b, { title: 'Hangmat', list: 'Thuis' });
    expect((await patch(b, eigen.id, { list: name })).status).toBe(200);
    expect(await row(eigen.id)).toMatchObject({ user_id: ADMIN_ID, list: name, shared_list: id });
    // Een per taak gedeelde taak niet.
    const los = await newTask(null, { title: 'Per taak', list: 'Privé' });
    expect((await call('/api/shares', { method: 'POST', json: { task_id: los.id, to_user: d.id, mode: 'shared' } })).status).toBe(201);
    expect((await patch(null, los.id, { list: name })).status).toBe(400);
    expect((await row(los.id)).shared_list).toBeNull();
  });

  it('per taak delen in een gedeelde lijst', async () => {
    const { name } = await weekend();
    const t = await newTask(null, { title: 'Koelbox', list: name });
    expect((await call('/api/shares', { method: 'POST', json: { task_id: t.id, to_user: d.id, mode: 'shared' } })).status).toBe(400);
    expect((await call('/api/shares', { method: 'POST', json: { task_id: t.id, to_user: d.id, mode: 'copy' } })).status).toBe(201);
  });

  it('hernoemen en samenvoegen', async () => {
    const { name } = await weekend();
    const t = await newTask(null, { title: 'Wandelschoenen', list: name });
    const to = `Ardennen ${uniq()}`;
    expect((await post(b, '/api/lists/rename', { from: name, to })).status).toBe(200);
    expect((await tasksOf(b)).find((x) => x.id === t.id)!.list).toBe(to);
    expect(await listNames(b)).toContain(to);
    expect(await listNames(b)).not.toContain(name);
    expect((await tasksOf(null)).find((x) => x.id === t.id)!.list).toBe(name);
    // Een nieuwe taak van B in "Ardennen" komt in de gedeelde lijst.
    const nieuw = await newTask(b, { title: 'Regenjas', list: to });
    expect(await row(nieuw.id)).toMatchObject({ user_id: ADMIN_ID, list: name });
    // Samenvoegen met een bestaande lijst kan niet, van of naar een gedeelde lijst.
    const eigen = `Eigen ${uniq()}`;
    await post(b, '/api/lists', { name: eigen });
    expect((await post(b, '/api/lists/rename', { from: to, to: eigen })).status).toBe(400);
    expect((await post(b, '/api/lists/rename', { from: eigen, to })).status).toBe(400);
    // De eigenaar hernoemt: zijn taken verhuizen mee, die van B niet.
    const nieuwNaam = `Eifel ${uniq()}`;
    expect((await post(null, '/api/lists/rename', { from: name, to: nieuwNaam })).status).toBe(200);
    expect((await tasksOf(null)).find((x) => x.id === t.id)!.list).toBe(nieuwNaam);
    expect((await tasksOf(b)).find((x) => x.id === t.id)!.list).toBe(to);
    expect(await row((await newTask(null, { title: 'Kaart', list: nieuwNaam })).id)).toMatchObject({ shared_list: expect.any(String) });
  });

  it('de eigenaar verwijdert de lijst naar de prullenbak', async () => {
    const { name } = await weekend();
    const t = await newTask(b, { title: 'Picknickkleed', list: name });
    expect((await post(null, '/api/lists/delete', { name, tasks: 'delete' })).status).toBe(200);
    expect((await tasksOf(b, '?deleted=1')).map((x) => x.id)).toContain(t.id);
    expect(await listNames(b)).not.toContain(name);
    expect((await post(b, `/api/tasks/${t.id}/restore`)).status).toBe(403);
    expect((await post(null, `/api/tasks/${t.id}/restore`)).status).toBe(200);
    expect((await tasksOf(null)).find((x) => x.id === t.id)).toMatchObject({ list: 'Inbox', shared_list: null });
    expect((await row(t.id)).shared_list).toBeNull();
    expect(await sharesOn(t.id)).toEqual([]);
    expect((await tasksOf(b)).map((x) => x.id)).not.toContain(t.id);
    expect((await tasksOf(b, '?deleted=1')).map((x) => x.id)).not.toContain(t.id);
  });

  it('een taak uit een bestaande gedeelde lijst zet ieder lid terug', async () => {
    const { name, id } = await weekend();
    const t = await newTask(null, { title: 'Parasol', list: name });
    expect((await as(b, `/api/tasks/${t.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await post(c, `/api/tasks/${t.id}/restore`)).status).toBe(200);
    expect((await tasksOf(b)).find((x) => x.id === t.id)).toMatchObject({ list: name, shared_list: id });
  });

  it('de eigenaar houdt de taken', async () => {
    const { name } = await weekend();
    const t = await newTask(c, { title: 'Luchtbed', list: name });
    const kid = await newTask(c, { title: 'Pomp', parent_id: t.id });
    expect((await post(b, '/api/lists/delete', { name, tasks: 'inbox' })).status).toBe(400);
    expect((await post(b, '/api/lists/delete', { name, tasks: 'delete' })).status).toBe(400);
    expect((await tasksOf(b)).map((x) => x.id)).toContain(t.id);
    expect((await post(null, '/api/lists/delete', { name, tasks: 'inbox' })).status).toBe(200);
    const mine = await tasksOf(null);
    expect(mine.find((x) => x.id === t.id)).toMatchObject({ list: 'Inbox', shared_list: null });
    expect(mine.find((x) => x.id === kid.id)).toMatchObject({ list: 'Inbox' });
    for (const u of [b, c]) {
      expect((await tasksOf(u)).map((x) => x.id)).not.toContain(t.id);
      expect(await listNames(u)).not.toContain(name);
    }
    expect(await sharesOn(t.id)).toEqual([]);
    expect(await env.DB.prepare('SELECT 1 FROM list_members WHERE name = ?').bind(name).first()).toBeNull();
  });

  it('opruimen', async () => {
    const { name } = await weekend();
    const klaar = [await newTask(b, { title: 'Bal', list: name }), await newTask(null, { title: 'Emmer', list: name })];
    const open = await newTask(c, { title: 'Schepje', list: name });
    for (const t of klaar) expect((await post(c, `/api/tasks/${t.id}/done`)).status).toBe(200);
    const res = await post(c, '/api/lists/clear-done', { name });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ deleted: 2 });
    const trash = (await tasksOf(null, '?deleted=1')).map((x) => x.id);
    for (const t of klaar) expect(trash).toContain(t.id);
    expect(trash).not.toContain(open.id);
    expect((await tasksOf(b)).map((x) => x.id)).toContain(open.id);
    expect((await post(c, '/api/lists/clear-done', { name })).status).toBe(200);
    expect((await post(c, '/api/lists/clear-done', {})).status).toBe(400);
  });
});
