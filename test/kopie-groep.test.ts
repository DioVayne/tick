import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { translate } from '../public/i18n.js';
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
