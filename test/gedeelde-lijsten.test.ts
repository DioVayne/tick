import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TaskRow } from '../src/index';
import type { Payload, Sender } from '../src/push';
import { attachStmts, detachStmts, listOf, listPush, type ListShare } from '../src/sharedlists';
import { sendToAll } from '../src/push';
import { ADMIN_ID, call, callAs, createTask, createUser, json, openTasks, type Task } from './helpers';

type User = Awaited<ReturnType<typeof createUser>>;
type ListItem = { name: string; open: number; id: string; shared: ListShare | null };
type Incoming = { id: string; name: string; from: { name: string }; open: number };

const uniq = () => crypto.randomUUID().slice(0, 8);
const shareList = (name: string, to: string, extra: Record<string, unknown> = {}, as?: string) => as
  ? callAs(as, '/api/shared-lists', { method: 'POST', json: { name, to, ...extra } })
  : call('/api/shared-lists', { method: 'POST', json: { name, to, ...extra } });
const accept = (u: User, id: string) => callAs(u.cookie, `/api/shared-lists/${id}/accept`, { method: 'POST', json: {} });
const decline = (u: User, id: string) => callAs(u.cookie, `/api/shared-lists/${id}/decline`, { method: 'POST', json: {} });
const removeMember = (id: string, userId: string, as?: string) => as
  ? callAs(as, `/api/shared-lists/${id}/members/${userId}`, { method: 'DELETE' })
  : call(`/api/shared-lists/${id}/members/${userId}`, { method: 'DELETE' });
const tasksOf = async (u: User, q = '') => json<Task[]>(await callAs(u.cookie, '/api/tasks' + q));
const listsOf = async (u?: User) => json<ListItem[]>(await (u ? callAs(u.cookie, '/api/lists') : call('/api/lists')));
const incomingOf = async (u: User) => json<Incoming[]>(await callAs(u.cookie, '/api/shared-lists/incoming'));
const row = async (id: string) => (await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>())!;
const sharesOn = async (taskId: string) => (await env.DB.prepare('SELECT to_user, mode, status, list, position FROM task_shares WHERE task_id = ? ORDER BY to_user')
  .bind(taskId).all<{ to_user: string; mode: string; status: string; list: string; position: number }>()).results;

/** Sender die bijhoudt wie wat kreeg (in het Nederlands), zonder abonnementen. */
function fakeSender() {
  const calls: { userId: string; p: Payload }[] = [];
  const send: Sender = async (_env, userId, make) => {
    calls.push({ userId, p: make('nl') });
    return { ok: 1, total: 1 };
  };
  return { send, calls };
}

/** Een lijst van A (de beheerder) met taken, gedeeld met u; geeft naam, lijst-id en de taken terug. */
async function sharedList(u: User, titles = ['Zonnebrand']) {
  const name = `Vakantie ${uniq()}`;
  const tasks = [];
  for (const title of titles) tasks.push(await createTask({ title: `${title} ${uniq()}`, list: name }));
  const res = await shareList(name, u.email);
  expect(res.status).toBe(201);
  const { list_id } = await json<{ list_id: string }>(res);
  return { name, id: list_id, tasks };
}

describe('gedeelde lijsten', () => {
  let b: User; let c: User; let d: User;
  let bName: string;
  beforeAll(async () => {
    bName = `Bea ${uniq()}`;
    b = await createUser({ name: bName });
    c = await createUser({ name: `Cas ${uniq()}` });
    d = await createUser({ name: `Dirk ${uniq()}` });
  });
  afterEach(() => { listPush.send = sendToAll; });

  it('delen maakt bestaande taken deel van de lijst', async () => {
    const pushes = fakeSender();
    listPush.send = pushes.send;
    const name = `Vakantie ${uniq()}`;
    const open = await createTask({ title: 'Paspoort', list: name });
    const done = await createTask({ title: 'Tent', list: name });
    const kid = await createTask({ title: 'Haringen', parent_id: done.id });
    await call(`/api/tasks/${done.id}/done`, { method: 'POST' });
    const res = await shareList(name, b.email);
    expect(res.status).toBe(201);
    const body = await json<{ id: string; list_id: string; status: string }>(res);
    expect(body).toMatchObject({ id: body.list_id, status: 'pending' });
    expect((await row(open.id)).shared_list).toBe(body.list_id);
    expect((await row(done.id)).shared_list).toBe(body.list_id);
    expect((await row(kid.id)).shared_list).toBeNull(); // alleen hoofdtaken
    const mine = (await listsOf()).find((l) => l.name === name)!;
    expect(mine.shared).toEqual({
      id: body.list_id, mine: true, owner: { id: ADMIN_ID, name: 'Tick' }, notify_done: false,
      members: [{ user_id: b.id, name: bName, status: 'pending' }],
    });
    // Nog geen deelrijen: een uitnodiging geeft geen toegang.
    expect(await sharesOn(open.id)).toEqual([]);
    await expect.poll(() => pushes.calls.length).toBe(1);
    expect(pushes.calls[0]).toMatchObject({
      userId: b.id,
      p: { title: `Tick deelt de lijst “${name}” met je`, url: `/?listInvite=${body.list_id}`, listInviteId: body.list_id },
    });
    expect(pushes.calls[0].p.actions?.map((a) => a.action)).toEqual(['accept', 'decline']);
    // Een tweede persoon: dezelfde lijst, geen nieuwe.
    const again = await json<{ list_id: string }>(await shareList(name, c.email));
    expect(again.list_id).toBe(body.list_id);
  });

  it('een openstaande uitnodiging lekt niets', async () => {
    const { name, id, tasks: [t] } = await sharedList(b);
    for (const q of ['', '?done=1', `?q=${encodeURIComponent(t.title)}`, '?deleted=1'])
      expect((await tasksOf(b, q)).map((x) => x.id)).not.toContain(t.id);
    expect((await listsOf(b)).map((l) => l.name)).not.toContain(name);
    expect((await callAs(b.cookie, `/api/tasks/${t.id}`, { method: 'PATCH', json: { title: 'x' } })).status).toBe(404);
    expect((await incomingOf(b)).find((i) => i.id === id)).toEqual({ id, name, from: { name: 'Tick' }, open: 1 });
    expect((await incomingOf(c)).map((i) => i.id)).not.toContain(id);
  });

  it('accepteren toont de lijst met alle taken', async () => {
    const { name, id, tasks: [t, klaar] } = await sharedList(b, ['Zonnebrand', 'Tent']);
    await call(`/api/tasks/${klaar.id}/done`, { method: 'POST' });
    const res = await accept(b, id);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, name });
    const l = (await listsOf(b)).find((x) => x.name === name)!;
    expect(l).toMatchObject({ open: 1, shared: { id, mine: false, owner: { id: ADMIN_ID, name: 'Tick' }, notify_done: false } });
    expect(l.shared!.members).toEqual([{ user_id: b.id, name: bName, status: 'accepted' }]);
    expect((await tasksOf(b)).find((x) => x.id === t.id)).toMatchObject({ list: name });
    expect((await tasksOf(b, '?done=1')).find((x) => x.id === klaar.id)).toMatchObject({ list: name });
    expect((await incomingOf(b)).map((i) => i.id)).not.toContain(id);
    expect((await accept(b, id)).status).toBe(404);
    // In de volgorde van de eigenaar, bovenaan bij B.
    const [st] = await sharesOn(t.id);
    const [sk] = await sharesOn(klaar.id);
    expect(st).toMatchObject({ to_user: b.id, mode: 'shared', status: 'accepted', list: name });
    expect(st.position < sk.position).toBe((await row(t.id)).position < (await row(klaar.id)).position);
    expect(Math.max(st.position, sk.position)).toBeLessThan(Math.min(...(await tasksOf(b)).filter((x) => x.id !== t.id && !x.parent_id).map((x) => x.position), Infinity));
    // De eigen meldingskeuze.
    expect((await callAs(b.cookie, `/api/shared-lists/${id}/me`, { method: 'PATCH', json: { notify_done: 'ja' } })).status).toBe(400);
    expect((await callAs(b.cookie, `/api/shared-lists/${id}/me`, { method: 'PATCH', json: { notify_done: true } })).status).toBe(200);
    expect((await listsOf(b)).find((x) => x.name === name)!.shared!.notify_done).toBe(true);
    expect((await listsOf()).find((x) => x.name === name)!.shared!.notify_done).toBe(false);
    expect((await callAs(c.cookie, `/api/shared-lists/${id}/me`, { method: 'PATCH', json: { notify_done: true } })).status).toBe(404);
  });

  it('een openstaande uitnodiging per taak wordt bij accepteren een deelname in de lijst', async () => {
    // De uitnodigingen per taak zijn van vóór het delen van de lijst: daarna kan per taak alleen nog een kopie.
    const name = `Vakantie ${uniq()}`;
    const gedeeld = await createTask({ title: 'Per taak gedeeld', list: name });
    const kopie = await createTask({ title: 'Per taak kopie', list: name });
    const invites: string[] = [];
    for (const [t, mode] of [[gedeeld, 'shared'], [kopie, 'copy']] as const) {
      const res = await call('/api/shares', { method: 'POST', json: { task_id: t.id, to_user: b.id, mode } });
      expect(res.status).toBe(201);
      invites.push((await json<{ id: string }>(res)).id);
    }
    const { list_id: id } = await json<{ list_id: string }>(await shareList(name, b.email));
    expect((await accept(b, id)).status).toBe(200);
    const mine = await tasksOf(b);
    for (const t of [gedeeld, kopie]) expect(mine.find((x) => x.id === t.id)).toMatchObject({ list: name });
    for (const t of [gedeeld, kopie]) expect(await sharesOn(t.id)).toMatchObject([{ to_user: b.id, mode: 'shared', status: 'accepted', list: name }]);
    const incoming = await json<{ id: string }[]>(await callAs(b.cookie, '/api/shares/incoming'));
    expect(incoming.map((i) => i.id)).not.toEqual(expect.arrayContaining([invites[0]]));
    expect(incoming.map((i) => i.id)).not.toEqual(expect.arrayContaining([invites[1]]));
  });

  it('een lid zonder taken in de lijst ziet hem toch', async () => {
    const name = `Leeg ${uniq()}`;
    await call('/api/lists', { method: 'POST', json: { name } });
    const { list_id } = await json<{ list_id: string }>(await shareList(name, b.email));
    expect(await json(await accept(b, list_id))).toEqual({ ok: true, name });
    expect((await listsOf(b)).find((x) => x.name === name)).toMatchObject({ open: 0, shared: { id: list_id, mine: false } });
  });

  it('bestaande naam krijgt de naam van de eigenaar erbij', async () => {
    const { name, id, tasks: [t] } = await sharedList(c);
    const eigen = await json<Task>(await callAs(c.cookie, '/api/tasks', { method: 'POST', json: { title: 'van C', list: name } }));
    expect(await json(await accept(c, id))).toEqual({ ok: true, name: `${name} (Tick)` });
    expect((await tasksOf(c)).find((x) => x.id === eigen.id)!.list).toBe(name);
    expect((await tasksOf(c)).find((x) => x.id === t.id)!.list).toBe(`${name} (Tick)`);
    // Bestaat die ook al, dan een nummer erachter.
    const tweede = `Weekend ${uniq()}`;
    await createTask({ title: 'Kaart', list: tweede });
    const { list_id } = await json<{ list_id: string }>(await shareList(tweede, c.email));
    await callAs(c.cookie, '/api/lists', { method: 'POST', json: { name: tweede } });
    await callAs(c.cookie, '/api/lists', { method: 'POST', json: { name: `${tweede} (Tick)` } });
    expect(await json(await accept(c, list_id))).toEqual({ ok: true, name: `${tweede} (Tick) 2` });
  });

  it('weigeren', async () => {
    const { name, id } = await sharedList(b);
    expect((await decline(b, id)).status).toBe(200);
    expect((await incomingOf(b)).map((i) => i.id)).not.toContain(id);
    expect((await listsOf()).find((x) => x.name === name)!.shared!.members).toEqual([]);
    expect((await decline(b, id)).status).toBe(404);
    expect((await accept(b, id)).status).toBe(404);
    expect((await decline(c, id)).status).toBe(404);
  });

  it('foutgevallen', async () => {
    const { name, id } = await sharedList(b);
    expect((await shareList('Inbox', b.email)).status).toBe(400);
    expect((await shareList(`Bestaat niet ${uniq()}`, b.email)).status).toBe(404);
    expect((await shareList(name, b.email)).status).toBe(409); // al uitgenodigd
    expect((await accept(b, id)).status).toBe(200);
    expect((await shareList(name, b.email)).status).toBe(409); // al lid
    expect((await shareList(name, c.email, {}, b.cookie)).status).toBe(403); // een lid deelt niet verder
    expect((await shareList(name, 'Tick')).status).toBe(400);
    expect((await call('/api/shared-lists', { method: 'POST', json: { name, to_user: ADMIN_ID } })).status).toBe(400);
    expect((await shareList(name, `niemand-${uniq()}`)).status).toBe(404);
    expect((await call('/api/shared-lists', { method: 'POST', json: { name, to_user: crypto.randomUUID() } })).status).toBe(404);
    expect((await shareList(name, c.email, { mode: 'copy' })).status).toBe(400);
    expect((await call('/api/shared-lists', { method: 'POST', json: { name, to_user: c.id, mode: 'shared' } })).status).toBe(201);
  });

  it('vertrekken laat de taken bij de eigenaar', async () => {
    const { name, id, tasks: [t, weg] } = await sharedList(b, ['Zonnebrand', 'Oud']);
    expect((await accept(b, id)).status).toBe(200);
    await call(`/api/tasks/${weg.id}`, { method: 'DELETE' }); // in de prullenbak, ook bij B
    const ts = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO reminder_sent (task_id, user_id, remind_at) VALUES (?, ?, ?)').bind(t.id, b.id, ts),
      env.DB.prepare('INSERT INTO task_watch (task_id, user_id) VALUES (?, ?)').bind(t.id, b.id),
      env.DB.prepare('UPDATE tasks SET claimed_by = ? WHERE id = ?').bind(b.id, t.id),
    ]);
    expect((await removeMember(id, ADMIN_ID)).status).toBe(400); // de eigenaar vertrekt niet
    expect((await removeMember(id, b.id, b.cookie)).status).toBe(200);
    expect((await listsOf(b)).map((l) => l.name)).not.toContain(name);
    expect((await tasksOf(b)).map((x) => x.id)).not.toContain(t.id);
    expect((await tasksOf(b, '?deleted=1')).map((x) => x.id)).not.toContain(weg.id);
    expect((await callAs(b.cookie, `/api/tasks/${t.id}`, { method: 'PATCH', json: { title: 'x' } })).status).toBe(404);
    expect(await sharesOn(t.id)).toEqual([]);
    expect(await sharesOn(weg.id)).toEqual([]);
    expect(await env.DB.prepare('SELECT 1 FROM reminder_sent WHERE task_id = ? AND user_id = ?').bind(t.id, b.id).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM task_watch WHERE task_id = ? AND user_id = ?').bind(t.id, b.id).first()).toBeNull();
    expect((await row(t.id)).claimed_by).toBeNull();
    // A ziet alles nog.
    expect((await openTasks()).find((x) => x.id === t.id)).toMatchObject({ list: name });
    expect((await listsOf()).find((x) => x.name === name)!.shared!.members).toEqual([]);
    expect((await removeMember(id, b.id, b.cookie)).status).toBe(404);
  });

  it('eruit halen', async () => {
    const { name, id, tasks: [t] } = await sharedList(b);
    expect((await shareList(name, c.email)).status).toBe(201);
    expect((await shareList(name, d.email)).status).toBe(201);
    expect((await accept(b, id)).status).toBe(200);
    expect((await accept(c, id)).status).toBe(200);
    const pushes = fakeSender();
    listPush.send = pushes.send;
    expect((await removeMember(id, b.id, c.cookie)).status).toBe(404); // een lid haalt geen ander eruit
    expect((await removeMember(id, d.id)).status).toBe(200); // uitnodiging intrekken: geen melding
    expect((await incomingOf(d)).map((i) => i.id)).not.toContain(id);
    expect((await removeMember(id, b.id)).status).toBe(200);
    expect((await tasksOf(b)).map((x) => x.id)).not.toContain(t.id);
    expect((await tasksOf(c)).map((x) => x.id)).toContain(t.id);
    await expect.poll(() => pushes.calls.length).toBe(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(pushes.calls).toEqual([{ userId: b.id, p: expect.objectContaining({ title: `Tick heeft je uit “${name}” gehaald` }) }]);
    expect((await removeMember(id, crypto.randomUUID())).status).toBe(404);
  });

  it('attachStmts en detachStmts: een taak van een lid de lijst in en er weer uit', async () => {
    const { name, id } = await sharedList(b);
    expect((await accept(b, id)).status).toBe(200);
    expect((await shareList(name, c.email)).status).toBe(201);
    expect((await accept(c, id)).status).toBe(200);
    const eigen = await json<Task>(await callAs(b.cookie, '/api/tasks', { method: 'POST', json: { title: 'Barbecue', list: 'Thuis' } }));
    const kind = await json<Task>(await callAs(b.cookie, '/api/tasks', { method: 'POST', json: { title: 'Kolen', parent_id: eigen.id } }));
    const list = (await listOf(env.DB, b.id, name))!;
    expect(list).toEqual({ id, owner_id: ADMIN_ID, owner_name: 'Tick', name, role: 'member' });
    await env.DB.batch(await attachStmts(env.DB, await row(eigen.id), list, b.id, 5));
    expect(await row(eigen.id)).toMatchObject({ user_id: ADMIN_ID, list: name, shared_list: id });
    expect(await row(kind.id)).toMatchObject({ user_id: ADMIN_ID, list: name });
    const rows = await sharesOn(eigen.id);
    expect(rows.map((r) => r.to_user).sort()).toEqual([b.id, c.id].sort());
    expect(rows.find((r) => r.to_user === b.id)).toMatchObject({ mode: 'shared', status: 'accepted', list: name, position: 5 });
    expect((await tasksOf(c)).find((x) => x.id === eigen.id)).toMatchObject({ list: name });

    await env.DB.batch(detachStmts(env.DB, await row(eigen.id), b.id, 'Thuis', 7));
    expect(await row(eigen.id)).toMatchObject({ user_id: b.id, list: 'Thuis', position: 7, shared_list: null, claimed_by: null });
    expect(await row(kind.id)).toMatchObject({ user_id: b.id, list: 'Thuis' });
    expect(await sharesOn(eigen.id)).toEqual([]);
    expect((await tasksOf(c)).map((x) => x.id)).not.toContain(eigen.id);
    expect((await openTasks()).map((x) => x.id)).not.toContain(eigen.id);
  });
});
