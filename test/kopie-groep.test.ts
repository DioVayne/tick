import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { translate } from '../public/i18n.js';
import { progressOf } from '../src/copies';
import { ADMIN_ID, call, callAs, createTask, createUser, json, type Task } from './helpers';

type User = Awaited<ReturnType<typeof createUser>>;
type Share = { id: string };

const uniq = () => crypto.randomUUID().slice(0, 8);
const share = (task_id: string, to_user: string, mode = 'copy', as?: string) => as
  ? callAs(as, '/api/shares', { method: 'POST', json: { task_id, to_user, mode } })
  : call('/api/shares', { method: 'POST', json: { task_id, to_user, mode } });
const accept = (u: User, id: string) => callAs(u.cookie, `/api/shares/${id}/accept`, { method: 'POST', json: {} });
const group = async (id: string) => (await env.DB.prepare('SELECT copy_group FROM tasks WHERE id = ?').bind(id).first<{ copy_group: string | null }>())?.copy_group;
/** Hoofdtaken van u met deze titel (de kopie heeft de titel van het origineel). */
const copyOf = async (u: User, title: string) =>
  (await env.DB.prepare('SELECT id FROM tasks WHERE user_id = ? AND title = ? AND parent_id IS NULL').bind(u.id, title).first<{ id: string }>())!.id;
/** Deelt als kopie en laat u accepteren; geeft de id van de kopie. */
async function copyTo(taskId: string, title: string, u: User, from?: User) {
  const res = await share(taskId, u.id, 'copy', from?.cookie);
  expect(res.status).toBe(201);
  expect((await accept(u, (await json<Share>(res)).id)).status).toBe(200);
  return copyOf(u, title);
}

describe('kopiegroep', () => {
  let b: User;
  let c: User;
  beforeAll(async () => {
    b = await createUser({ name: `Bea ${uniq()}` });
    c = await createUser({ name: `Cas ${uniq()}` });
  });

  it('accepteren van een kopie zet dezelfde copy_group op origineel en kopie', async () => {
    const title = `Groep ${uniq()}`;
    const orig = await createTask({ title });
    await createTask({ title: 'kind', parent_id: orig.id });
    expect(await group(orig.id)).toBeNull();
    const kopie = await copyTo(orig.id, title, b);
    expect(await group(orig.id)).not.toBeNull();
    expect(await group(kopie)).toBe(await group(orig.id));
    const { results } = await env.DB.prepare('SELECT copy_group FROM tasks WHERE parent_id = ?').bind(kopie).all();
    expect(results).toEqual([{ copy_group: null }]);
  });

  it('een tweede ontvanger komt in dezelfde groep', async () => {
    const title = `Twee ${uniq()}`;
    const orig = await createTask({ title });
    await copyTo(orig.id, title, b);
    const kopieC = await copyTo(orig.id, title, c);
    expect(await group(kopieC)).toBe(await group(orig.id));
  });

  it('een kopie van een kopie komt in dezelfde groep', async () => {
    const title = `Keten ${uniq()}`;
    const orig = await createTask({ title });
    const kopieB = await copyTo(orig.id, title, b);
    const kopieC = await copyTo(kopieB, title, c, b);
    expect(await group(kopieC)).toBe(await group(orig.id));
  });

  it('twee gelijktijdige accepts geven één groep', async () => {
    const title = `Race ${uniq()}`;
    const orig = await createTask({ title });
    const sb = await json<Share>(await share(orig.id, b.id));
    const sc = await json<Share>(await share(orig.id, c.id));
    const res = await Promise.all([accept(b, sb.id), accept(c, sc.id)]);
    expect(res.map((r) => r.status)).toEqual([200, 200]);
    const g = await group(orig.id);
    expect(g).toBeTruthy();
    expect(await group(await copyOf(b, title))).toBe(g);
    expect(await group(await copyOf(c, title))).toBe(g);
  });

  it('één exemplaar per persoon', async () => {
    const title = `Eén ${uniq()}`;
    const orig = await createTask({ title });
    const kopieB = await copyTo(orig.id, title, b);
    const again = await share(orig.id, b.id);
    expect(again.status).toBe(409);
    expect(await json(again)).toMatchObject({ error: translate('en', 'err.copy_exists') });
    expect((await share(orig.id, b.id, 'shared')).status).toBe(409);
    const terug = await share(kopieB, ADMIN_ID, 'copy', b.cookie);
    expect(terug.status).toBe(409);
    expect(await json(terug)).toMatchObject({ error: translate('en', 'err.copy_exists') });
  });

  it('accept controleert opnieuw', async () => {
    const title = `Dubbel ${uniq()}`;
    const orig = await createTask({ title });
    const kopieC = await copyTo(orig.id, title, c);
    const s1 = await json<Share>(await share(orig.id, b.id));
    const s2 = await json<Share>(await share(kopieC, b.id, 'copy', c.cookie));
    expect((await accept(b, s1.id)).status).toBe(200);
    const second = await accept(b, s2.id);
    expect(second.status).toBe(409);
    expect(await json(second)).toMatchObject({ error: translate('en', 'err.copy_exists') });
    expect(await env.DB.prepare('SELECT id FROM task_shares WHERE id = ?').bind(s2.id).first()).toBeNull();
  });

  it('origineel in de prullenbak', async () => {
    const orig = await createTask({ title: `Weg ${uniq()}` });
    const s = await json<Share>(await share(orig.id, b.id));
    await call(`/api/tasks/${orig.id}`, { method: 'DELETE' });
    expect((await accept(b, s.id)).status).toBe(410);
    expect(await group(orig.id)).toBeNull();
  });

  it('bestaande kopieën blijven los', async () => {
    const t = await createTask({ title: `Los ${uniq()}` });
    await call('/api/tasks?done=1');
    await call(`/api/tasks/${t.id}`, { method: 'PATCH', json: { title: 'nieuwe titel' } });
    expect(await group(t.id)).toBeNull();
  });

  it('copy_group gaat niet naar de client', async () => {
    const title = `Privé ${uniq()}`;
    const orig = await createTask({ title });
    await copyTo(orig.id, title, b);
    expect(await group(orig.id)).not.toBeNull();
    const tasks = await json<Task[]>(await call('/api/tasks'));
    expect(tasks.find((t) => t.id === orig.id)).toBeDefined();
    for (const t of tasks) expect('copy_group' in t).toBe(false);
    const bTasks = await json<Task[]>(await callAs(b.cookie, '/api/tasks'));
    for (const t of bTasks) expect('copy_group' in t).toBe(false);
  });
});

describe('progressOf', () => {
  it('telt takenlijst-regels en subtaken', () => {
    expect(progressOf('', [])).toBeNull();
    expect(progressOf('- [x] a\n- [ ] b', [])).toBe(0.5);
    expect(progressOf('', [{ done: 1 }, { done: 0 }, { done: 0 }, { done: 0 }])).toBe(0.25);
    expect(progressOf('- [x] a', [{ done: 0 }])).toBe(0.5);
    expect(progressOf('```\n- [x] a\n```', [])).toBeNull();
    expect(progressOf('> - [x] a\n- [ ] b', [])).toBe(0.5);
    expect(progressOf('* [x] a', [])).toBe(1);
    expect(progressOf('- [x] a\n  - [ ] b', [])).toBe(0.5);
  });
});

describe('copies in GET /api/tasks', () => {
  type U = User & { name: string };
  let a: U, b: U, c: U, d: U, e: U;
  const mk = async (name: string): Promise<U> => ({ ...await createUser({ name }), name });
  beforeAll(async () => {
    [a, b, c, d, e] = await Promise.all(['Anna', 'Bert', 'Cor', 'Dirk', 'Els'].map((n) => mk(`${n} ${uniq()}`)));
  });
  const post = async (u: User, body: Record<string, unknown>) => {
    const res = await callAs(u.cookie, '/api/tasks', { method: 'POST', json: body });
    expect(res.status).toBe(201);
    return json<Task>(res);
  };
  const patch = (u: User, id: string, body: Record<string, unknown>) => callAs(u.cookie, `/api/tasks/${id}`, { method: 'PATCH', json: body });
  const del = (u: User, id: string) => callAs(u.cookie, `/api/tasks/${id}`, { method: 'DELETE' });
  const list = async (u: User, q = '') => json<Task[]>(await callAs(u.cookie, `/api/tasks${q}`));
  const copiesOf = async (u: User, id: string, q = '') => {
    const t = (await list(u, q)).find((x) => x.id === id);
    expect(t).toBeDefined();
    return t!.copies;
  };
  const names = (cp: Task['copies']) => (cp?.members ?? []).map((m) => m.name);
  const member = async (u: User, id: string, name: string) => (await copiesOf(u, id))!.members.find((m) => m.name === name)!;
  /** Groep van a met b en c; geeft de ids van de drie exemplaren. */
  async function trio(extra: Record<string, unknown> = {}) {
    const title = `Klus ${uniq()}`;
    const ta = (await post(a, { title, ...extra })).id;
    const tb = await copyTo(ta, title, b, a);
    const tc = await copyTo(ta, title, c, a);
    return { ta, tb, tc };
  }

  it('de deler ziet de ontvangers, de ontvangers zien de deler en elkaar', async () => {
    const { ta, tb, tc } = await trio();
    expect(names(await copiesOf(a, ta))).toEqual([b.name, c.name]);
    expect(names(await copiesOf(b, tb))).toEqual([a.name, c.name]);
    expect(names(await copiesOf(c, tc))).toEqual([a.name, b.name]);
  });

  it('alleen naam, klaar en voortgang', async () => {
    const { ta, tb } = await trio({ description: 'beschrijving van Anna' });
    const geheim = `Bert-titel ${uniq()}`;
    expect((await patch(b, tb, { title: geheim, description: 'geheime notitie' })).status).toBe(200);
    for (const m of (await copiesOf(a, ta))!.members) expect(Object.keys(m).sort()).toEqual(['done', 'done_at', 'name', 'progress']);
    const body = await (await callAs(a.cookie, '/api/tasks')).text();
    expect(body).not.toContain(geheim);
    expect(body).not.toContain('geheime notitie');
  });

  it('voortgang van een ander', async () => {
    const title = `Sub ${uniq()}`;
    const ta = (await post(a, { title })).id;
    await post(a, { title: 'k1', parent_id: ta });
    await post(a, { title: 'k2', parent_id: ta });
    const tb = await copyTo(ta, title, b, a);
    expect(await member(a, ta, b.name)).toEqual({ name: b.name, done: false, done_at: null, progress: 0 });
    const k1 = (await list(b)).find((t) => t.parent_id === tb && t.title === 'k1')!;
    expect((await patch(b, k1.id, { done: true })).status).toBe(200);
    expect((await member(a, ta, b.name)).progress).toBe(0.5);
    expect((await patch(b, tb, { done: true })).status).toBe(200);
    const klaar = await member(a, ta, b.name);
    expect(klaar.done).toBe(true);
    expect(klaar.done_at).toBeTruthy();
  });

  it('een derde buiten de groep ziet niets', async () => {
    const { ta } = await trio();
    const eigen = await post(e, { title: `Eigen ${uniq()}` });
    const tasks = await list(e);
    expect(tasks.find((t) => t.id === ta)).toBeUndefined();
    expect(tasks.find((t) => t.id === eigen.id)!.copies).toBeNull();
    expect((await patch(e, ta, { title: 'x' })).status).toBe(404);
  });

  it('pending alleen voor de eigenaar', async () => {
    const title = `Wacht ${uniq()}`;
    const ta = (await post(a, { title })).id;
    const tb = await copyTo(ta, title, b, a);
    expect((await share(ta, c.id, 'copy', a.cookie)).status).toBe(201);
    const tA = (await list(a)).find((t) => t.id === ta)!;
    expect(tA.copies!.pending).toEqual([{ name: c.name }]);
    expect((tA.share?.members ?? []).some((m) => m.user_id === c.id)).toBe(false);
    expect((await copiesOf(b, tb))!.pending).toEqual([]);
  });

  it('alleen een openstaande uitnodiging geeft ook copies', async () => {
    const ta = (await post(a, { title: `Alleen ${uniq()}` })).id;
    expect(await copiesOf(a, ta)).toBeNull();
    expect((await share(ta, c.id, 'copy', a.cookie)).status).toBe(201);
    expect(await copiesOf(a, ta)).toEqual({ members: [], pending: [{ name: c.name }] });
  });

  it('prullenbak', async () => {
    const { ta, tb } = await trio();
    expect((await del(b, tb)).status).toBe(200);
    expect(names(await copiesOf(a, ta))).toEqual([c.name]);
    const trash = await list(b, '?deleted=1');
    expect(trash.some((t) => t.id === tb)).toBe(true);
    for (const t of trash) expect(t.copies).toBeNull();
    expect((await callAs(b.cookie, `/api/tasks/${tb}/restore`, { method: 'POST', json: {} })).status).toBe(200);
    expect(names(await copiesOf(a, ta))).toEqual([b.name, c.name]);
  });

  it('origineel verwijderd', async () => {
    const { ta, tb, tc } = await trio();
    expect((await del(a, ta)).status).toBe(200);
    expect(names(await copiesOf(b, tb))).toEqual([c.name]);
    expect(names(await copiesOf(c, tc))).toEqual([b.name]);
  });

  it('groep van één', async () => {
    const { ta, tb, tc } = await trio();
    await del(b, tb);
    await del(c, tc);
    expect(await copiesOf(a, ta)).toBeNull();
  });

  it('?done=1 geeft copies mee', async () => {
    const { ta } = await trio();
    expect((await patch(a, ta, { done: true })).status).toBe(200);
    expect(names(await copiesOf(a, ta, '?done=1'))).toEqual([b.name, c.name]);
  });

  it('gedeeld exemplaar', async () => {
    const { ta, tb } = await trio();
    const s = await json<Share>(await share(ta, d.id, 'shared', a.cookie));
    expect((await accept(d, s.id)).status).toBe(200);
    const vanA = await copiesOf(a, ta);
    expect(names(vanA)).toEqual([b.name, c.name]);
    expect(await copiesOf(d, ta)).toEqual(vanA);
    expect(names(await copiesOf(b, tb))).toEqual([a.name, c.name]);
  });

  it('herhalend, relatief aan de kijker', async () => {
    const title = `Wekelijks ${uniq()}`;
    const ta = (await post(a, { title, remind_at: '2099-10-18T10:00:00', repeat: 'FREQ=WEEKLY;BYDAY=SU' })).id;
    const tb = await copyTo(ta, title, b, a);
    expect(await member(a, ta, b.name)).toMatchObject({ done: false });
    expect((await patch(b, tb, { done: true })).status).toBe(200);
    expect(await member(a, ta, b.name)).toMatchObject({ done: true, done_at: null });
    expect(await member(b, tb, a.name)).toMatchObject({ done: false });
    expect((await patch(a, ta, { done: true })).status).toBe(200);
    expect(await member(a, ta, b.name)).toMatchObject({ done: false });
  });

  it('herhaling weggehaald', async () => {
    const title = `Niet meer ${uniq()}`;
    const ta = (await post(a, { title, remind_at: '2099-10-18T10:00:00', repeat: 'FREQ=WEEKLY;BYDAY=SU' })).id;
    const tb = await copyTo(ta, title, b, a);
    expect((await patch(b, tb, { repeat: '' })).status).toBe(200);
    // B herhaalt niet meer: A die doorschuift maakt B niet ineens "achter", en B is pas klaar als B afvinkt.
    expect((await patch(a, ta, { done: true })).status).toBe(200);
    expect(await member(a, ta, b.name)).toMatchObject({ done: false, done_at: null });
    expect((await patch(b, tb, { done: true })).status).toBe(200);
    const m = await member(a, ta, b.name);
    expect(m.done).toBe(true);
    expect(m.done_at).toBeTruthy();
  });
});
