import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_ID, call, callAs, createTask, createUser, json, openTasks, session, type Task } from './helpers';

type User = Awaited<ReturnType<typeof createUser>>;
type Share = { id: string; status: string; mode: string };
type Incoming = { id: string; mode: string; task: { title: string; subtasks: number }; from: { name: string } };

const uniq = () => crypto.randomUUID().slice(0, 8);
const share = (task_id: string, to: string, mode = 'shared', as?: string) => as
  ? callAs(as, '/api/shares', { method: 'POST', json: { task_id, to, mode } })
  : call('/api/shares', { method: 'POST', json: { task_id, to, mode } });
const tasksOf = async (u: User, q = '') => json<Task[]>(await callAs(u.cookie, '/api/tasks' + q));
const listsOf = async (u: User) => json<{ name: string; open: number }[]>(await callAs(u.cookie, '/api/lists'));
const accept = (u: User, id: string) => callAs(u.cookie, `/api/shares/${id}/accept`, { method: 'POST', json: {} });
const owner = async (id: string) => (await env.DB.prepare('SELECT user_id FROM tasks WHERE id = ?').bind(id).first<{ user_id: string }>())?.user_id;

/** Maakt een taak van A en deelt hem (gedeeld, geaccepteerd) met u; geeft taak en deel-id terug. */
async function sharedWith(u: User, body: Record<string, unknown> = {}) {
  const t = await createTask({ title: `Gedeeld ${uniq()}`, list: 'Thuis', ...body });
  const s = await json<Share>(await share(t.id, u.email));
  expect((await accept(u, s.id)).status).toBe(200);
  return { t, s };
}

describe('taken delen', () => {
  let b: User;
  let c: User;
  let bName: string;
  beforeAll(async () => {
    bName = `Bea ${uniq()}`;
    b = await createUser({ name: bName });
    c = await createUser({ name: `Cas ${uniq()}` });
  });

  it('uitnodigen op e-mail en op naam, met de foutgevallen', async () => {
    const t = await createTask({ title: `Uitnodigen ${uniq()}` });
    const r1 = await share(t.id, b.email.toUpperCase());
    expect(r1.status).toBe(201);
    expect(await json(r1)).toMatchObject({ status: 'pending', mode: 'shared' });
    expect((await share(t.id, b.email)).status).toBe(409); // bestaat al
    const t2 = await createTask({ title: `Op naam ${uniq()}` });
    expect((await share(t2.id, `  ${bName.toLowerCase()} `, 'copy')).status).toBe(201);
    expect((await share(t2.id, 'niemand-' + uniq())).status).toBe(404);
    const dup = `Dubbel ${uniq()}`;
    await createUser({ name: dup });
    await createUser({ name: dup });
    expect((await share(t2.id, dup)).status).toBe(409);
    expect((await share(t2.id, 'Tick')).status).toBe(400); // de beheerder zelf
    const kind = await createTask({ title: 'kind', parent_id: t2.id });
    expect((await share(kind.id, c.email)).status).toBe(400);
    expect((await share(t2.id, c.email, 'x')).status).toBe(400);
    expect((await share(crypto.randomUUID(), c.email)).status).toBe(404);
  });

  it('de keuzelijst toont de andere accounts (naam en id, geen e-mail), en uitnodigen kan op id', async () => {
    const people = await json<{ id: string; name: string }[]>(await call('/api/shares/people'));
    expect(people).toEqual(expect.arrayContaining([{ id: b.id, name: bName }]));
    expect(people.map((p) => p.id)).not.toContain(ADMIN_ID);
    expect(Object.keys(people[0]).sort()).toEqual(['id', 'name']);
    const t = await createTask({ title: `Op id ${uniq()}` });
    const res = await call('/api/shares', { method: 'POST', json: { task_id: t.id, to_user: c.id, mode: 'shared' } });
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({ to_user: c.id });
    expect((await call('/api/shares', { method: 'POST', json: { task_id: t.id, to_user: crypto.randomUUID(), mode: 'copy' } })).status).toBe(404);
    expect((await call('/api/shares', { method: 'POST', json: { task_id: t.id, to_user: ADMIN_ID, mode: 'copy' } })).status).toBe(400);
  });

  it('alleen de eigenaar mag uitnodigen', async () => {
    const { t } = await sharedWith(b);
    expect((await share(t.id, c.email, 'shared', b.cookie)).status).toBe(403);
    // C heeft geen toegang: dan gedraagt de taak zich als niet bestaand.
    expect((await share(t.id, b.email, 'shared', c.cookie)).status).toBe(404);
  });

  it('een openstaande uitnodiging lekt niets', async () => {
    const t = await createTask({ title: `Geheim-${uniq()}`, list: 'Geheimlijst', remind_at: '2030-01-01T10:00:00Z' });
    const s = await json<Share>(await share(t.id, b.email));
    for (const q of ['', '?done=1', `?q=${encodeURIComponent(t.title)}`, '?deleted=1'])
      expect((await tasksOf(b, q)).map((x) => x.id)).not.toContain(t.id);
    expect((await listsOf(b)).map((l) => l.name)).not.toContain('Geheimlijst');
    for (const [m, p, body] of [['PATCH', `/api/tasks/${t.id}`, { title: 'x' }], ['DELETE', `/api/tasks/${t.id}`, undefined],
      ['POST', `/api/tasks/${t.id}/done`, {}], ['POST', `/api/tasks/${t.id}/snooze`, { minutes: 5 }]] as const)
      expect((await callAs(b.cookie, p, { method: m, json: body })).status).toBe(404);
    const inc = await json<Incoming[]>(await callAs(b.cookie, '/api/shares/incoming'));
    expect(inc.find((i) => i.id === s.id)).toMatchObject({ mode: 'shared', task: { title: t.title, subtasks: 0 }, from: { name: 'Tick' } });
    expect((await json<Incoming[]>(await callAs(c.cookie, '/api/shares/incoming'))).map((i) => i.id)).not.toContain(s.id);
  });

  it('gedeeld accepteren: Inbox bij de ontvanger, lijst en volgorde per persoon, de rest samen', async () => {
    const { t, s } = await sharedWith(b);
    let mine = (await tasksOf(b)).find((x) => x.id === t.id)!;
    expect(mine.list).toBe('Inbox');
    expect(mine.share).toMatchObject({ mine: false, owner: { id: ADMIN_ID, name: 'Tick' } });
    expect((await openTasks()).find((x) => x.id === t.id)!.share).toMatchObject({ mine: true, members: [{ share_id: s.id, name: bName, status: 'accepted' }] });
    expect((await callAs(b.cookie, `/api/tasks/${t.id}`, { method: 'PATCH', json: { list: 'Boodschappen' } })).status).toBe(200);
    expect((await openTasks()).find((x) => x.id === t.id)!.list).toBe('Thuis');
    await call(`/api/tasks/${t.id}`, { method: 'PATCH', json: { list: 'Werk' } });
    expect((await tasksOf(b)).find((x) => x.id === t.id)!.list).toBe('Boodschappen');
    expect((await listsOf(b)).find((l) => l.name === 'Boodschappen')?.open).toBeGreaterThanOrEqual(1);
    await callAs(b.cookie, `/api/tasks/${t.id}`, { method: 'PATCH', json: { title: 'Nieuwe titel', remind_at: '2031-05-05T10:00:00Z' } });
    expect((await openTasks()).find((x) => x.id === t.id)).toMatchObject({ title: 'Nieuwe titel', remind_at: '2031-05-05T10:00:00.000Z', list: 'Werk' });
    expect((await callAs(b.cookie, `/api/tasks/${t.id}`, { method: 'PATCH', json: { done: true } })).status).toBe(200);
    expect((await openTasks()).map((x) => x.id)).not.toContain(t.id);
    mine = (await tasksOf(b, '?done=1')).find((x) => x.id === t.id)!;
    expect(mine).toMatchObject({ done: true, list: 'Boodschappen' });
  });

  it('een subtaak van de ontvanger hoort bij de eigenaar', async () => {
    const { t } = await sharedWith(b);
    const res = await callAs(b.cookie, '/api/tasks', { method: 'POST', json: { title: 'chips', parent_id: t.id } });
    expect(res.status).toBe(201);
    const k = await json<Task>(res);
    expect(await owner(k.id)).toBe(ADMIN_ID);
    expect((await openTasks()).find((x) => x.id === k.id)).toBeTruthy();
    expect((await tasksOf(b)).find((x) => x.id === k.id)).toMatchObject({ list: 'Inbox', parent_id: t.id, share: null });
    // afvinken van de subtaak door de eigenaar zie je bij de ontvanger
    await call(`/api/tasks/${k.id}/done`, { method: 'POST', json: {} });
    expect((await tasksOf(b)).find((x) => x.id === k.id)).toBeUndefined();
  });

  it('een herhalende gedeelde taak afvinken door de ontvanger zet de subtaken van de eigenaar weer open', async () => {
    const { t } = await sharedWith(b, { remind_at: new Date(Date.now() + 3_600_000).toISOString(), repeat: 'FREQ=DAILY' });
    const k = await createTask({ title: 'subtaak', parent_id: t.id });
    await call(`/api/tasks/${k.id}/done`, { method: 'POST', json: {} });
    const before = (await openTasks()).find((x) => x.id === t.id)!;
    expect((await callAs(b.cookie, `/api/tasks/${t.id}/done`, { method: 'POST', json: {} })).status).toBe(200);
    const after = (await openTasks()).find((x) => x.id === t.id)!;
    expect(Date.parse(after.repeat!.at)).toBeGreaterThan(Date.parse(before.repeat!.at));
    expect((await openTasks()).find((x) => x.id === k.id)).toMatchObject({ done: false });
  });

  it('subtaakregels bij gedeelde taken', async () => {
    const { t } = await sharedWith(b);
    const eigen = await json<Task>(await callAs(b.cookie, '/api/tasks', { method: 'POST', json: { title: 'van B' } }));
    expect((await callAs(b.cookie, `/api/tasks/${eigen.id}`, { method: 'PATCH', json: { parent_id: t.id } })).status).toBe(400);
    const ander = await createTask({ title: 'andere van A' });
    expect((await call(`/api/tasks/${t.id}`, { method: 'PATCH', json: { parent_id: ander.id } })).status).toBe(400);
  });

  it('slepen door de ontvanger werkt op zijn eigen volgorde', async () => {
    const u = await createUser({ name: `Sleep ${uniq()}` });
    const mk = async (title: string) => json<Task>(await callAs(u.cookie, '/api/tasks', { method: 'POST', json: { title } }));
    const x = await mk('x');
    const y = await mk('y'); // nieuw = bovenaan: volgorde y, x
    const { t } = await sharedWith(u); // bovenaan: t, y, x
    const aPos = (await openTasks()).find((r) => r.id === t.id)!.position;
    const order = async () => (await tasksOf(u)).filter((r) => !r.parent_id).map((r) => r.id);
    expect(await order()).toEqual([t.id, y.id, x.id]);
    const ys = (await tasksOf(u)).find((r) => r.id === y.id)!.position;
    const xs = (await tasksOf(u)).find((r) => r.id === x.id)!.position;
    await callAs(u.cookie, `/api/tasks/${t.id}`, { method: 'PATCH', json: { position: (ys + xs) / 2 } });
    expect(await order()).toEqual([y.id, t.id, x.id]);
    expect((await openTasks()).find((r) => r.id === t.id)!.position).toBe(aPos);
    // heel dicht op elkaar: herverdelen houdt de volgorde
    await callAs(u.cookie, `/api/tasks/${t.id}`, { method: 'PATCH', json: { position: xs - 1e-9 } });
    expect(await order()).toEqual([y.id, t.id, x.id]);
  });

  it('kopie: eigen taken met subtaken, los van het origineel', async () => {
    const t = await createTask({ title: `Kadootje ${uniq()}`, list: 'Thuis', description: 'iets leuks' });
    const k = await createTask({ title: 'inpakken', parent_id: t.id });
    await call(`/api/tasks/${k.id}/done`, { method: 'POST', json: {} });
    const s = await json<Share>(await share(t.id, b.email, 'copy'));
    expect((await accept(b, s.id)).status).toBe(200);
    const mine = (await tasksOf(b)).filter((x) => x.title === t.title);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ list: 'Inbox', description: 'iets leuks', source: 'share', share: null });
    expect(mine[0].id).not.toBe(t.id);
    const kids = (await tasksOf(b)).filter((x) => x.parent_id === mine[0].id);
    expect(kids).toMatchObject([{ title: 'inpakken', done: false }]);
    expect(await owner(mine[0].id)).toBe(b.id);
    expect(await env.DB.prepare('SELECT 1 FROM task_shares WHERE id = ?').bind(s.id).first()).toBeNull();
    await callAs(b.cookie, `/api/tasks/${mine[0].id}`, { method: 'PATCH', json: { title: 'anders' } });
    expect((await openTasks()).find((x) => x.id === t.id)!.title).toBe(t.title);
  });

  it('kopie van een taak die intussen in de prullenbak ligt: 410', async () => {
    const t = await createTask({ title: `Weg ${uniq()}` });
    const s = await json<Share>(await share(t.id, b.email, 'copy'));
    await call(`/api/tasks/${t.id}`, { method: 'DELETE' });
    expect((await json<Incoming[]>(await callAs(b.cookie, '/api/shares/incoming'))).map((i) => i.id)).not.toContain(s.id);
    expect((await accept(b, s.id)).status).toBe(410);
    expect(await env.DB.prepare('SELECT 1 FROM task_shares WHERE id = ?').bind(s.id).first()).toBeNull();
  });

  it('weigeren, en andermans uitnodiging', async () => {
    const t = await createTask({ title: `Nee ${uniq()}` });
    const s = await json<Share>(await share(t.id, b.email));
    expect((await accept(c, s.id)).status).toBe(404);
    expect((await callAs(c.cookie, `/api/shares/${s.id}/decline`, { method: 'POST', json: {} })).status).toBe(404);
    expect((await callAs(b.cookie, `/api/shares/${s.id}/decline`, { method: 'POST', json: {} })).status).toBe(200);
    expect((await accept(b, s.id)).status).toBe(404);
    expect((await openTasks()).find((x) => x.id === t.id)!.share).toBeNull();
  });

  it('stoppen met delen door de ontvanger, en iemand eraf halen door de eigenaar', async () => {
    const { t, s } = await sharedWith(b);
    const sc = await json<Share>(await share(t.id, c.email));
    await accept(c, sc.id);
    expect((await callAs(c.cookie, `/api/shares/${s.id}`, { method: 'DELETE' })).status).toBe(404); // niet van C
    expect((await callAs(b.cookie, `/api/shares/${s.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await tasksOf(b)).map((x) => x.id)).not.toContain(t.id);
    expect((await openTasks()).map((x) => x.id)).toContain(t.id);
    expect((await call(`/api/shares/${sc.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await callAs(c.cookie, `/api/tasks/${t.id}`, { method: 'PATCH', json: { title: 'x' } })).status).toBe(404);
  });

  it('prullenbak bij een gedeelde taak', async () => {
    const { t } = await sharedWith(b);
    const inTrash = async (u?: User) => (await json<Task[]>(u ? await callAs(u.cookie, '/api/tasks?deleted=1') : await call('/api/tasks?deleted=1'))).map((x) => x.id);
    expect((await callAs(b.cookie, `/api/tasks/${t.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await inTrash()).toContain(t.id);
    expect(await inTrash(b)).toContain(t.id);
    expect((await call(`/api/tasks/${t.id}/restore`, { method: 'POST', json: {} })).status).toBe(200);
    expect((await tasksOf(b)).map((x) => x.id)).toContain(t.id);
    await call(`/api/tasks/${t.id}`, { method: 'DELETE' });
    expect((await callAs(b.cookie, `/api/tasks/${t.id}?purge=1`, { method: 'DELETE' })).status).toBe(200);
    expect(await inTrash(b)).not.toContain(t.id);
    expect(await inTrash()).toContain(t.id);
    // prullenbak legen door B wist niets van A
    await callAs(b.cookie, '/api/trash/empty', { method: 'POST', json: {} });
    expect(await inTrash()).toContain(t.id);
    expect((await call(`/api/tasks/${t.id}?purge=1`, { method: 'DELETE' })).status).toBe(200);
    expect(await env.DB.prepare('SELECT 1 FROM tasks WHERE id = ?').bind(t.id).first()).toBeNull();
  });

  it('een subtaak definitief verwijderen door de ontvanger laat zijn deelname staan', async () => {
    const { t } = await sharedWith(b);
    const k = await createTask({ title: 'losse subtaak', parent_id: t.id });
    expect((await callAs(b.cookie, `/api/tasks/${k.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await callAs(b.cookie, `/api/tasks/${k.id}?purge=1`, { method: 'DELETE' })).status).toBe(200);
    expect((await tasksOf(b)).map((x) => x.id)).toContain(t.id);
    // de subtaak blijft bij de eigenaar terug te zetten
    expect((await json<Task[]>(await call('/api/tasks?deleted=1'))).map((x) => x.id)).toContain(k.id);
  });

  it('een ontvanger kan een subtaak van een gedeelde taak niet losmaken', async () => {
    const { t } = await sharedWith(b);
    const k = await createTask({ title: 'blijft eronder', parent_id: t.id });
    expect((await callAs(b.cookie, `/api/tasks/${k.id}`, { method: 'PATCH', json: { parent_id: null, position: 5 } })).status).toBe(400);
    expect((await openTasks()).find((x) => x.id === k.id)!.parent_id).toBe(t.id);
  });

  it('een lijst van de ontvanger komt nooit in de lijst van de eigenaar, ook niet met parent_id erbij', async () => {
    const { t } = await sharedWith(b);
    expect((await callAs(b.cookie, `/api/tasks/${t.id}`, { method: 'PATCH', json: { list: 'VanB', parent_id: null } })).status).toBe(200);
    expect((await openTasks()).find((x) => x.id === t.id)!.list).toBe('Thuis');
    expect((await tasksOf(b)).find((x) => x.id === t.id)!.list).toBe('VanB');
  });

  it('lijsten van de ontvanger: hernoemen, naar Inbox, verwijderen', async () => {
    const u = await createUser({ name: `Lijst ${uniq()}` });
    const { t } = await sharedWith(u);
    await callAs(u.cookie, `/api/tasks/${t.id}`, { method: 'PATCH', json: { list: 'Samen' } });
    expect(await json(await callAs(u.cookie, '/api/lists/rename', { method: 'POST', json: { from: 'Samen', to: 'Wij' } }))).toEqual({ moved: 1 });
    expect((await tasksOf(u)).find((x) => x.id === t.id)!.list).toBe('Wij');
    expect((await openTasks()).find((x) => x.id === t.id)!.list).toBe('Thuis');
    expect(await json(await callAs(u.cookie, '/api/lists/delete', { method: 'POST', json: { name: 'Wij', tasks: 'inbox' } }))).toEqual({ moved: 1 });
    expect((await tasksOf(u)).find((x) => x.id === t.id)!.list).toBe('Inbox');
    await callAs(u.cookie, `/api/tasks/${t.id}`, { method: 'PATCH', json: { list: 'Weg' } });
    expect(await json(await callAs(u.cookie, '/api/lists/delete', { method: 'POST', json: { name: 'Weg', tasks: 'delete' } }))).toEqual({ deleted: 1 });
    expect((await json<Task[]>(await call('/api/tasks?deleted=1'))).map((x) => x.id)).toContain(t.id);
  });

  it('een account verwijderen ruimt de deelrijen op', async () => {
    const u = await createUser({ name: `Weg ${uniq()}` });
    const { t } = await sharedWith(u);
    const eigen = await json<Task>(await callAs(u.cookie, '/api/tasks', { method: 'POST', json: { title: 'van u' } }));
    await share(eigen.id, b.email, 'shared', u.cookie);
    const admin = await session();
    expect((await callAs(admin, `/api/users/${u.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM task_shares WHERE to_user = ? OR from_user = ?').bind(u.id, u.id).first()).toEqual({ n: 0 });
    expect((await openTasks()).find((x) => x.id === t.id)!.share).toBeNull();
  });
});
