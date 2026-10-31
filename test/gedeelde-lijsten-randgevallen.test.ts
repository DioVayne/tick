import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import type { TaskRow } from '../src/index';
import type { Payload, Sender } from '../src/push';
import { sendToAll } from '../src/push';
import { attachStmts, listOf, listPush, transferListsStmts } from '../src/sharedlists';
import { callAs, createUser, json, session, type Task } from './helpers';
import { translate } from '../public/i18n.js';

type User = Awaited<ReturnType<typeof createUser>>;
type ListTask = Task & { shared_list: string | null; claimed_by: { id: string } | null; watch: boolean };

const uniq = () => crypto.randomUUID().slice(0, 8);
const mk = (name = `Lid ${uniq()}`) => createUser({ name });
const as = (u: User, path: string, init: RequestInit & { json?: unknown } = {}) => callAs(u.cookie, path, init);
const post = (u: User, path: string, body: unknown = {}) => as(u, path, { method: 'POST', json: body });
const patch = (u: User, id: string, body: unknown) => as(u, `/api/tasks/${id}`, { method: 'PATCH', json: body });
const addTask = async (u: User, body: Record<string, unknown>) => {
  const res = await post(u, '/api/tasks', body);
  expect(res.status).toBe(201);
  return json<ListTask>(res);
};
const taskOf = async (u: User, id: string) => (await json<ListTask[]>(await as(u, '/api/tasks'))).find((x) => x.id === id);
const row = async (id: string) => (await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>())!;
const errorOf = async (res: Response) => (await json<{ error: string }>(res)).error;
const settle = () => new Promise((r) => setTimeout(r, 50));

/** `owner` deelt lijst `name` met elk van `members`, en elk accepteert; geeft het lijst-id terug. */
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

/** `owner` deelt taak `taskId` per taak met `u`, en `u` accepteert; geeft het id van de deelrij terug. */
async function shareTask(owner: User, taskId: string, u: User): Promise<string> {
  const res = await post(owner, '/api/shares', { task_id: taskId, to_user: u.id, mode: 'shared' });
  expect(res.status).toBe(201);
  const { id } = await json<{ id: string }>(res);
  expect((await post(u, `/api/shares/${id}/accept`)).status).toBe(200);
  return id;
}

function fakeSender() {
  const calls: { userId: string; p: Payload }[] = [];
  const send: Sender = async (_env, userId, make) => {
    calls.push({ userId, p: make('nl') });
    return { ok: 1, total: 1 };
  };
  return { send, calls };
}

describe('gedeelde lijsten: randgevallen', () => {
  afterEach(() => { listPush.send = sendToAll; });

  it('een al geaccepteerde deelname per taak komt bij accepteren van de lijst in de lijst', async () => {
    const [a, b] = [await mk(), await mk()];
    const name = `Klus ${uniq()}`;
    const t = await addTask(a, { title: 'Schuur', list: name });
    await shareTask(a, t.id, b);
    expect((await taskOf(b, t.id))!.list).toBe('Inbox');
    const id = await shareList(a, name, [b]);
    expect(await taskOf(b, t.id)).toMatchObject({ list: name, shared_list: id });
    expect(await env.DB.prepare('SELECT mode, status FROM task_shares WHERE task_id = ? AND to_user = ?').bind(t.id, b.id).first())
      .toEqual({ mode: 'shared', status: 'accepted' });
  });

  describe('een deelnemer per taak die geen lid is', () => {
    /** A heeft T per taak gedeeld met D, en deelt daarna de lijst met B: D zit wel op T, maar niet in de lijst. */
    async function setup() {
      const [a, b, d] = [await mk(), await mk(), await mk(`Dirk ${uniq()}`)];
      const name = `Huis ${uniq()}`;
      const t = await addTask(a, { title: 'Dak', list: name });
      await shareTask(a, t.id, d);
      const id = await shareList(a, name, [b]);
      expect((await row(t.id)).shared_list).toBe(id);
      return { a, b, d, name, id, t };
    }

    it('kan hem niet op naam zetten of volgen', async () => {
      const { d, t } = await setup();
      const res = await patch(d, t.id, { claimed: true });
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toBe(translate('en', 'err.claim_shared_list'));
      expect(await errorOf(await patch(d, t.id, { watch: true }))).toBe(translate('en', 'err.watch_shared_list'));
      expect((await row(t.id)).claimed_by).toBeNull();
    });

    it('een andere lijst verandert alleen zijn eigen deelrij', async () => {
      const { a, b, d, name, id, t } = await setup();
      const res = await patch(d, t.id, { list: 'Elders' });
      expect(res.status).toBe(200);
      expect(await row(t.id)).toMatchObject({ user_id: a.id, list: name, shared_list: id });
      expect((await taskOf(d, t.id))!.list).toBe('Elders');
      expect((await taskOf(b, t.id))!.list).toBe(name);
      expect((await taskOf(a, t.id))!.list).toBe(name);
      // Naar een gedeelde lijst van hemzelf slepen kan niet, net als bij elke gedeelde taak.
      const eigen = `Eigen ${uniq()}`;
      await addTask(d, { title: 'Iets', list: eigen });
      await shareList(d, eigen, [await mk()]);
      expect(await errorOf(await patch(d, t.id, { list: eigen }))).toBe(translate('en', 'err.shared_task_to_list'));
    });

    it('krijgt de melding bij afvinken, leden zonder meldingen niet', async () => {
      const { a, b, d, t } = await setup();
      const pushes = fakeSender();
      listPush.send = pushes.send;
      expect((await post(b, `/api/tasks/${t.id}/done`)).status).toBe(200);
      await settle();
      expect(pushes.calls.map((x) => x.userId)).toEqual([d.id]);
      expect(pushes.calls[0].p.title).toContain('afgevinkt');
      // Ook als hij zelf afvinkt: de leden met meldingen uit krijgen niets.
      expect((await post(a, `/api/tasks/${t.id}/reopen`)).status).toBe(200);
      pushes.calls.length = 0;
      expect((await post(d, `/api/tasks/${t.id}/done`)).status).toBe(200);
      await settle();
      expect(pushes.calls).toEqual([]);
    });

    it('krijgt de melding bij een nieuwe plek', async () => {
      const { b, d, t } = await setup();
      const pushes = fakeSender();
      listPush.send = pushes.send;
      const res = await patch(b, t.id, { location: { name: 'Bouwmarkt', lat: 52.1, lng: 5.1, radius: 200, trigger: 'enter' } });
      expect(res.status).toBe(200);
      await settle();
      expect(pushes.calls.map((x) => x.userId)).toEqual([d.id]);
    });
  });

  it('terugzetten in een lijst die intussen gedeeld is: de taak hoort weer bij de lijst', async () => {
    const [a, b] = [await mk(), await mk()];
    const name = `Later ${uniq()}`;
    const t = await addTask(a, { title: 'Oud', list: name });
    const kid = await addTask(a, { title: 'Kind', parent_id: t.id });
    expect((await as(a, `/api/tasks/${t.id}`, { method: 'DELETE' })).status).toBe(200);
    await addTask(a, { title: 'Nieuw', list: name });
    const id = await shareList(a, name, [b]);
    expect((await row(t.id)).shared_list).toBeNull();
    expect((await post(a, `/api/tasks/${t.id}/restore`)).status).toBe(200);
    expect(await row(t.id)).toMatchObject({ user_id: a.id, list: name, shared_list: id, deleted_at: null });
    expect(await row(kid.id)).toMatchObject({ user_id: a.id, list: name, deleted_at: null });
    expect(await taskOf(b, t.id)).toMatchObject({ list: name, shared_list: id });
  });

  it('een subtaak losmaken in een gedeelde lijst: de nieuwe hoofdtaak hoort bij de lijst', async () => {
    const [a, b] = [await mk(), await mk()];
    const name = `Los ${uniq()}`;
    const t = await addTask(a, { title: 'Ouder', list: name });
    const kid = await addTask(a, { title: 'Kind', parent_id: t.id });
    const id = await shareList(a, name, [b]);
    const res = await patch(a, kid.id, { parent_id: null });
    expect(res.status).toBe(200);
    expect(await json<ListTask>(res)).toMatchObject({ parent_id: null, list: name, shared_list: id });
    expect(await row(kid.id)).toMatchObject({ user_id: a.id, parent_id: null, list: name, shared_list: id });
    expect(await taskOf(b, kid.id)).toMatchObject({ parent_id: null, list: name, shared_list: id });
  });

  it('een subtaak losmaken in een gewone lijst blijft een gewone taak', async () => {
    const a = await mk();
    const name = `Gewoon ${uniq()}`;
    const t = await addTask(a, { title: 'Ouder', list: name });
    const kid = await addTask(a, { title: 'Kind', parent_id: t.id });
    expect((await patch(a, kid.id, { parent_id: null })).status).toBe(200);
    expect(await row(kid.id)).toMatchObject({ parent_id: null, list: name, shared_list: null });
  });

  it('een backup importeren in een gedeelde lijst: de taak hoort bij de lijst', async () => {
    const [a, b] = [await mk(), await mk()];
    const name = `Import ${uniq()}`;
    await addTask(a, { title: 'Al', list: name });
    const id = await shareList(a, name, [b]);
    const ts = new Date().toISOString();
    const nieuw = crypto.randomUUID(), kind = crypto.randomUUID(), los = crypto.randomUUID();
    const backup = {
      app: 'tick', version: 1, tasks: [
        { id: nieuw, title: 'Uit backup', list: name, position: 3, created_at: ts, updated_at: ts },
        { id: kind, title: 'Kind', list: name, parent_id: nieuw, position: 1, created_at: ts, updated_at: ts },
        { id: los, title: 'Los', list: 'Thuis', position: 4, created_at: ts, updated_at: ts },
      ],
    };
    expect((await post(a, '/api/import/backup', backup)).status).toBe(200);
    expect(await row(nieuw)).toMatchObject({ user_id: a.id, list: name, shared_list: id, position: 3 });
    expect(await row(kind)).toMatchObject({ user_id: a.id, list: name });
    expect((await row(los)).shared_list).toBeNull();
    expect(await taskOf(b, nieuw)).toMatchObject({ list: name, shared_list: id });
  });

  it('de deelrij van een lid stoppen kan niet: dat is vertrekken uit de lijst', async () => {
    const [a, b, d] = [await mk(), await mk(), await mk()];
    const name = `Rij ${uniq()}`;
    const t = await addTask(a, { title: 'Ramen', list: name });
    const outsider = await shareTask(a, t.id, d);
    await shareList(a, name, [b]);
    const rowB = (await env.DB.prepare('SELECT id FROM task_shares WHERE task_id = ? AND to_user = ?').bind(t.id, b.id).first<{ id: string }>())!.id;
    for (const u of [a, b]) {
      const res = await as(u, `/api/shares/${rowB}`, { method: 'DELETE' });
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toBe(translate('en', 'err.share_is_list'));
    }
    expect(await taskOf(b, t.id)).toBeTruthy();
    // Een deelnemer per taak die geen lid is, kan wel gewoon stoppen.
    expect((await as(d, `/api/shares/${outsider}`, { method: 'DELETE' })).status).toBe(200);
    expect(await taskOf(d, t.id)).toBeUndefined();
  });

  it('attachStmts leest de leden in de batch zelf', async () => {
    const [a, b, c] = [await mk(), await mk(), await mk()];
    const name = `Batch ${uniq()}`;
    await addTask(a, { title: 'Al', list: name });
    const id = await shareList(a, name, [b]);
    const t = await addTask(a, { title: 'Los', list: 'Thuis' });
    const stmts = await attachStmts(env.DB, t, (await listOf(env.DB, a.id, name))!, a.id, 9);
    // C accepteert en B vertrekt nadat de statements gemaakt zijn, maar voor de batch draait.
    expect((await post(a, '/api/shared-lists', { name, to_user: c.id })).status).toBe(201);
    expect((await post(c, `/api/shared-lists/${id}/accept`)).status).toBe(200);
    expect((await as(b, `/api/shared-lists/${id}/members/${b.id}`, { method: 'DELETE' })).status).toBe(200);
    await env.DB.batch(stmts);
    expect(await row(t.id)).toMatchObject({ shared_list: id, position: 9 });
    expect((await env.DB.prepare('SELECT to_user FROM task_shares WHERE task_id = ?').bind(t.id).all()).results).toEqual([{ to_user: c.id }]);
  });

  it('account verwijderen met vijf lijsten: elk naar zijn eigen erfgenaam, in een vast aantal statements', async () => {
    const one = await mk();
    await addTask(one, { title: 'Een', list: 'Enkel' });
    await shareList(one, 'Enkel', [await mk()]);
    const single = transferListsStmts(env.DB, one.id).length;

    const a = await mk();
    const lists: { id: string; heir: User; task: string; name: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const name = `Lijst ${i} ${uniq()}`;
      const task = (await addTask(a, { title: `Taak ${i}`, list: name })).id;
      const heir = await mk();
      const id = await shareList(a, name, [heir]);
      lists.push({ id, heir, task, name });
    }
    // De vroegste eerst: in de laatste lijst komt er nog een lid bij, dat later accepteerde.
    await shareList(a, lists[4].name, [await mk()]);
    const stmts = transferListsStmts(env.DB, a.id);
    expect(stmts.length).toBe(single);
    expect((await callAs(await session(), `/api/users/${a.id}`, { method: 'DELETE' })).status).toBe(200);
    for (const l of lists) {
      expect(await env.DB.prepare('SELECT owner_id FROM shared_lists WHERE id = ?').bind(l.id).first()).toEqual({ owner_id: l.heir.id });
      expect(await row(l.task)).toMatchObject({ user_id: l.heir.id, list: l.name, shared_list: l.id });
      expect(await env.DB.prepare("SELECT role FROM list_members WHERE list_id = ? AND user_id = ?").bind(l.id, l.heir.id).first()).toEqual({ role: 'owner' });
    }
  });
});
