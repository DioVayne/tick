import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '../public/i18n.js';
import { call, callAs, callWith, createTask, createUser, json, openEnv } from './helpers';

/**
 * Gedeeld ↔ kopie voor iemand die al op de taak zit: een openstaande uitnodiging krijgt de andere vorm, een
 * geaccepteerde gedeelde taak wordt (na bevestigen) een eigen kopie, een geaccepteerde kopie blijft een kopie.
 */

type User = Awaited<ReturnType<typeof createUser>>;
type Row = { id: string; mode: string; status: string };

const err = (key: string) => ({ error: translate('en', key) });
const uniq = () => crypto.randomUUID().slice(0, 8);
const share = (task_id: string, to_user: string, mode: string, extra: Record<string, unknown> = {}) =>
  call('/api/shares', { method: 'POST', json: { task_id, to_user, mode, ...extra } });
const accept = (u: User, id: string) => callAs(u.cookie, `/api/shares/${id}/accept`, { method: 'POST', json: {} });
const incoming = async (u: User) => json<{ id: string; mode: string; task: { title: string } }[]>(await callAs(u.cookie, '/api/shares/incoming'));
const shareRow = (taskId: string, u: User) =>
  env.DB.prepare('SELECT id, mode, status FROM task_shares WHERE task_id = ? AND to_user = ?').bind(taskId, u.id).first<Row>();
const mainTasks = async (u: User, title: string) => (await env.DB.prepare(
  'SELECT * FROM tasks WHERE user_id = ? AND title = ? AND parent_id IS NULL AND deleted_at IS NULL').bind(u.id, title).all<Record<string, unknown>>()).results;

describe('gedeeld of kopie omzetten', () => {
  let b: User;
  beforeAll(async () => { b = await createUser({ name: `Bas ${uniq()}` }); });

  it('een openstaande uitnodiging als gedeeld wordt een kopie-uitnodiging', async () => {
    const t = await createTask({ title: `Open ${uniq()}` });
    expect((await share(t.id, b.id, 'shared')).status).toBe(201);
    const res = await share(t.id, b.id, 'copy');
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ mode: 'copy', status: 'pending', changed: 'mode' });
    expect(await shareRow(t.id, b)).toMatchObject({ mode: 'copy', status: 'pending' });
    expect((await incoming(b)).find((i) => i.task.title === t.title)?.mode).toBe('copy');
  });

  it('een openstaande kopie-uitnodiging wordt een gedeelde', async () => {
    const t = await createTask({ title: `Kopie open ${uniq()}` });
    expect((await share(t.id, b.id, 'copy')).status).toBe(201);
    const res = await share(t.id, b.id, 'shared');
    expect(res.status).toBe(200);
    expect(await shareRow(t.id, b)).toMatchObject({ mode: 'shared', status: 'pending' });
    const inv = (await incoming(b)).find((i) => i.task.title === t.title)!;
    expect(inv.mode).toBe('shared');
    // Accepteren geeft nu een gedeelde taak, geen kopie.
    expect((await accept(b, inv.id)).status).toBe(200);
    expect(await shareRow(t.id, b)).toMatchObject({ mode: 'shared', status: 'accepted' });
    expect(await mainTasks(b, t.title)).toHaveLength(0);
  });

  it('dezelfde vorm nog eens blijft een 409', async () => {
    const t = await createTask({ title: `Zelfde ${uniq()}` });
    expect((await share(t.id, b.id, 'shared')).status).toBe(201);
    const res = await share(t.id, b.id, 'shared');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(err('err.share_exists'));
  });

  it('gedeeld naar kopie bij een openstaande uitnodiging, terwijl die al een kopie in de groep heeft: 409', async () => {
    const title = `Groep ${uniq()}`;
    const t = await createTask({ title });
    const c = await createUser({ name: `Cor ${uniq()}` });
    const first = await json<{ id: string }>(await share(t.id, c.id, 'copy'));
    expect((await accept(c, first.id)).status).toBe(200);
    const [kopie] = await mainTasks(c, title);
    // Cor deelt zijn kopie met Bas als gedeeld; Bas heeft nog geen exemplaar.
    const fromC = await callAs(c.cookie, '/api/shares', { method: 'POST', json: { task_id: kopie.id, to_user: b.id, mode: 'shared' } });
    expect(fromC.status).toBe(201);
    // Bas krijgt van de eigenaar een kopie: daarmee heeft hij een exemplaar in de groep.
    const own = await json<{ id: string }>(await share(t.id, b.id, 'copy'));
    expect((await accept(b, own.id)).status).toBe(200);
    // Cor zet zijn openstaande uitnodiging om naar kopie: Bas heeft er al een.
    const res = await callAs(c.cookie, '/api/shares', { method: 'POST', json: { task_id: kopie.id, to_user: b.id, mode: 'copy' } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(err('err.copy_exists'));
    expect(await shareRow(kopie.id as string, b)).toMatchObject({ mode: 'shared', status: 'pending' });
  });

  it('een geaccepteerde gedeelde taak vraagt eerst om bevestiging', async () => {
    const t = await createTask({ title: `Bevestig ${uniq()}` });
    const s = await json<{ id: string }>(await share(t.id, b.id, 'shared'));
    expect((await accept(b, s.id)).status).toBe(200);
    const res = await share(t.id, b.id, 'copy');
    expect(res.status).toBe(428);
    expect(await res.json()).toEqual(err('err.share_to_copy_confirm'));
    expect(await shareRow(t.id, b)).toMatchObject({ mode: 'shared', status: 'accepted' });
  });

  it('een geaccepteerde gedeelde taak wordt een eigen kopie, op dezelfde plek', async () => {
    const title = `Omzetten ${uniq()}`;
    const t = await createTask({ title, description: 'notitie', remind_at: '2030-01-01T09:00:00Z' });
    const kid1 = await createTask({ title: 'een', parent_id: t.id });
    await createTask({ title: 'twee', parent_id: t.id });
    expect((await call(`/api/tasks/${kid1.id}`, { method: 'PATCH', json: { done: true } })).status).toBe(200);
    const s = await json<{ id: string }>(await share(t.id, b.id, 'shared'));
    expect((await accept(b, s.id)).status).toBe(200);
    // Bas zet hem in zijn eigen lijst en pint hem.
    await env.DB.prepare("UPDATE task_shares SET list = 'Werk', position = 123, pinned = 1 WHERE id = ?").bind(s.id).run();

    const res = await share(t.id, b.id, 'copy', { convert: true });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, changed: 'copy' });

    // De deelrij is weg; het origineel staat er nog, onveranderd.
    expect(await shareRow(t.id, b)).toBeNull();
    const orig = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(t.id).first<Record<string, unknown>>();
    expect(orig).toMatchObject({ title, description: 'notitie', user_id: expect.any(String), deleted_at: null });
    // Bas heeft een eigen exemplaar in dezelfde groep, van de eigenaar, in Werk op zijn plek.
    const [kopie] = await mainTasks(b, title);
    expect(kopie).toMatchObject({
      description: 'notitie', remind_at: '2030-01-01T09:00:00.000Z', list: 'Werk', position: 123, pinned: 1, done: 0,
      copy_group: orig!.copy_group, copied_from: orig!.user_id, source: 'share',
    });
    expect(orig!.copy_group).toBeTruthy();
    // Subtaken gaan mee zoals ze nu zijn: afgevinkt blijft afgevinkt.
    const { results: kids } = await env.DB.prepare('SELECT title, done, user_id FROM tasks WHERE parent_id = ? ORDER BY position').bind(kopie.id).all();
    expect(kids).toEqual([{ title: 'een', done: 1, user_id: b.id }, { title: 'twee', done: 0, user_id: b.id }]);

    // Los van elkaar: Bas ziet het origineel niet meer, en afvinken loopt niet meer gelijk.
    const list = await json<{ id: string }[]>(await callAs(b.cookie, '/api/tasks'));
    expect(list.some((x) => x.id === t.id)).toBe(false);
    expect(list.some((x) => x.id === kopie.id)).toBe(true);
    expect((await call(`/api/tasks/${t.id}`, { method: 'PATCH', json: { done: true } })).status).toBe(200);
    expect((await env.DB.prepare('SELECT done FROM tasks WHERE id = ?').bind(kopie.id).first<{ done: number }>())!.done).toBe(0);
  });

  it('een afgevinkte gedeelde taak blijft afgevinkt als kopie', async () => {
    const title = `Klaar ${uniq()}`;
    const t = await createTask({ title });
    const s = await json<{ id: string }>(await share(t.id, b.id, 'shared'));
    expect((await accept(b, s.id)).status).toBe(200);
    expect((await call(`/api/tasks/${t.id}`, { method: 'PATCH', json: { done: true } })).status).toBe(200);
    expect((await share(t.id, b.id, 'copy', { convert: true })).status).toBe(200);
    const [kopie] = await mainTasks(b, title);
    expect(kopie.done).toBe(1);
    expect(kopie.done_at).toBeTruthy();
  });

  it('een geaccepteerde kopie wordt niet gedeeld: eerst de kopie weg', async () => {
    const title = `Al kopie ${uniq()}`;
    const t = await createTask({ title });
    const s = await json<{ id: string }>(await share(t.id, b.id, 'copy'));
    expect((await accept(b, s.id)).status).toBe(200);
    const res = await share(t.id, b.id, 'shared');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(err('err.copy_exists_shared'));
    // Een kopie nog eens sturen geeft de oude melding.
    expect(await (await share(t.id, b.id, 'copy')).json()).toEqual(err('err.copy_exists'));
    // Verwijdert Bas zijn kopie, dan kan delen wel.
    const [kopie] = await mainTasks(b, title);
    expect((await callAs(b.cookie, `/api/tasks/${kopie.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await share(t.id, b.id, 'shared')).status).toBe(201);
  });
});

describe('gedeeld of kopie omzetten op een openbare Tick', () => {
  beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"id":"x"}', { status: 200 })); });
  afterEach(() => vi.restoreAllMocks());

  it('een uitnodiging aan een adres zonder account krijgt de andere vorm, met hetzelfde antwoord als bij een account', async () => {
    const a = await createUser();
    const b = await createUser();
    const as = (path: string, body: unknown) => callWith(openEnv, path, { method: 'POST', json: body, cookie: a.cookie });
    const t = await json<{ id: string }>(await callWith(openEnv, '/api/tasks', { method: 'POST', json: { title: `Adres ${uniq()}` }, cookie: a.cookie }));
    const email = `niemand-${uniq()}@example.test`;
    expect((await as('/api/shares', { task_id: t.id, to: email, mode: 'shared' })).status).toBe(201);
    expect((await as('/api/shares', { task_id: t.id, to: b.email, mode: 'shared' })).status).toBe(201);

    const noAccount = await as('/api/shares', { task_id: t.id, to: email, mode: 'copy' });
    const account = await as('/api/shares', { task_id: t.id, to: b.email, mode: 'copy' });
    expect(noAccount.status).toBe(200);
    expect(account.status).toBe(200);
    expect(await noAccount.json()).toEqual(await account.json());
    expect((await env.DB.prepare('SELECT mode FROM email_invites WHERE task_id = ? AND email = ?').bind(t.id, email).first<{ mode: string }>())!.mode).toBe('copy');
    expect((await env.DB.prepare('SELECT mode FROM task_shares WHERE task_id = ? AND to_user = ?').bind(t.id, b.id).first<{ mode: string }>())!.mode).toBe('copy');
    // Dezelfde vorm nog eens: 409, ook bij het adres.
    expect((await as('/api/shares', { task_id: t.id, to: email, mode: 'copy' })).status).toBe(409);
  });
});
