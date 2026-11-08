import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callWith, createUser, openEnv } from './helpers';
import type { Env } from '../src/index';

type User = Awaited<ReturnType<typeof createUser>>;
type Task = { id: string; title: string; list: string };

const uniq = () => crypto.randomUUID().slice(0, 8);
const as = (u: User, path: string, o: { method?: string; json?: unknown } = {}, e: Env = openEnv) => callWith(e, path, { ...o, cookie: u.cookie });
const newTask = async (u: User, list = 'Thuis') =>
  (await (await as(u, '/api/tasks', { method: 'POST', json: { title: `Taak ${uniq()}`, list } })).json()) as Task;
const share = (u: User, taskId: string, to: string) => as(u, '/api/shares', { method: 'POST', json: { task_id: taskId, mode: 'shared', to } });
const tasksOf = async (u: User) => (await (await as(u, '/api/tasks')).json()) as Task[];
const incoming = async (u: User) => (await (await as(u, '/api/shares/incoming')).json()) as { id: string; task: { title: string } }[];
const block = (u: User, other: string) => as(u, '/api/blocks', { method: 'POST', json: { user_id: other } });
const mails = () => (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes('resend')).length;

/** Een taak van a, gedeeld met b en geaccepteerd. */
async function acceptedShare(a: User, b: User) {
  const t = await newTask(a);
  expect((await share(a, t.id, b.email)).status).toBe(201);
  const inv = (await incoming(b)).find((i) => i.task.title === t.title)!;
  expect((await as(b, `/api/shares/${inv.id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
  return t;
}

/** Een gedeelde lijst van owner met de leden, allemaal geaccepteerd; geeft naam en id. */
async function sharedList(owner: User, members: User[]) {
  const name = `Lijst ${uniq()}`;
  await as(owner, '/api/lists', { method: 'POST', json: { name } });
  let id = '';
  for (const m of members) {
    const res = await as(owner, '/api/shared-lists', { method: 'POST', json: { name, to: m.email } });
    id = ((await res.json()) as { list_id: string }).list_id;
    expect((await as(m, `/api/shared-lists/${id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
  }
  return { name, id };
}

beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"id":"x"}', { status: 200 })); });
afterEach(() => vi.restoreAllMocks());

describe('blokkeren', () => {
  it('stopt al het delen tussen beiden, beide richtingen, en hun lijst', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const fromA = await acceptedShare(a, b);
    const fromB = await acceptedShare(b, a);
    const list = await sharedList(b, [a]);
    const inList = await newTask(b, list.name);
    expect((await block(a, b.id)).status).toBe(200);
    const ofA = (await tasksOf(a)).map((t) => t.id);
    const ofB = (await tasksOf(b)).map((t) => t.id);
    expect(ofA).not.toContain(fromB.id);
    expect(ofA).not.toContain(inList.id);
    expect(ofB).not.toContain(fromA.id);
    expect(ofA).toContain(fromA.id);
    const member = await env.DB.prepare('SELECT 1 AS x FROM list_members WHERE list_id = ? AND user_id = ?').bind(list.id, a.id).first();
    expect(member).toBeNull();
  });

  it('de lijst van een derde met beiden als lid blijft', async () => {
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    const list = await sharedList(c, [a, b]);
    await acceptedShare(a, b);
    expect((await block(a, b.id)).status).toBe(200);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM list_members WHERE list_id = ? AND status = 'accepted'").bind(list.id).first<{ n: number }>();
    expect(n!.n).toBe(3);
  });

  it('daarna delen geeft hetzelfde antwoord als bij een onbekend adres, maar er komt niets aan', async () => {
    const [a, b] = [await createUser(), await createUser()];
    await acceptedShare(a, b);
    expect((await block(a, b.id)).status).toBe(200);
    for (const [from, to] of [[b, a], [a, b]] as const) {
      const t = await newTask(from);
      const before = mails();
      const res = await share(from, t.id, to.email);
      const unknown = await share(from, (await newTask(from)).id, `niemand-${uniq()}@ex.test`);
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual(await unknown.json());
      expect(mails() - before).toBe(1); // alleen de mail aan het onbekende adres
      expect(await incoming(to)).toEqual([]);
      const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM email_invites WHERE task_id = ?').bind(t.id).first<{ n: number }>();
      expect(rows!.n).toBe(1);
      expect((await share(from, t.id, to.email)).status).toBe(409);
    }
  });

  it('een lijst delen met wie je blokkeerde: niets komt aan', async () => {
    const [a, b] = [await createUser(), await createUser()];
    await acceptedShare(a, b);
    await block(b, a.id);
    const name = `Lijst ${uniq()}`;
    await as(a, '/api/lists', { method: 'POST', json: { name } });
    const res = await as(a, '/api/shared-lists', { method: 'POST', json: { name, to: b.email } });
    expect(res.status).toBe(201);
    expect(await (await as(b, '/api/shared-lists/incoming')).json()).toEqual([]);
  });

  it('een nieuwe lijst delen met wie jou blokkeerde: niets komt aan, ook later niet bij bevestigen', async () => {
    const [a, b] = [await createUser(), await createUser()];
    await acceptedShare(a, b);
    await block(b, a.id);
    const t = await newTask(a);
    await share(a, t.id, b.email);
    const { claimEmailInvites } = await import('../src/invites');
    await claimEmailInvites(openEnv, b.id);
    expect(await incoming(b)).toEqual([]);
  });

  it('knownPeople noemt elkaar niet meer; de lijst geblokkeerden en deblokkeren', async () => {
    const [a, b] = [await createUser({ name: 'Ans' }), await createUser({ name: 'Bas' })];
    const c = await createUser();
    const list = await sharedList(c, [a, b]);
    expect(list.id).toBeTruthy();
    expect((await (await as(a, '/api/shares/people')).json() as { id: string }[]).map((p) => p.id)).toContain(b.id);
    await block(a, b.id);
    expect((await (await as(a, '/api/shares/people')).json() as { id: string }[]).map((p) => p.id)).not.toContain(b.id);
    expect((await (await as(b, '/api/shares/people')).json() as { id: string }[]).map((p) => p.id)).not.toContain(a.id);
    expect(await (await as(a, '/api/blocks')).json()).toEqual([{ id: b.id, name: 'Bas' }]);
    expect((await block(a, b.id)).status).toBe(200); // nog eens: geen fout
    expect((await as(a, `/api/blocks/${b.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await (await as(a, '/api/blocks')).json()).toEqual([]);
  });

  it('wie van een openstaande uitnodiging kan je blokkeren; een onbekende niet', async () => {
    const [a, b, x] = [await createUser(), await createUser(), await createUser()];
    const t = await newTask(a);
    await share(a, t.id, b.email);
    expect((await block(b, a.id)).status).toBe(200);
    expect(await incoming(b)).toEqual([]);
    expect((await block(b, x.id)).status).toBe(404);
  });

  it('blokkeren via wat er gedeeld is (een uitnodiging of taak), zonder id', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const t = await newTask(a);
    await share(a, t.id, b.email);
    const inv = (await incoming(b))[0];
    expect((await as(b, '/api/blocks', { method: 'POST', json: { share_id: inv.id } })).status).toBe(200);
    expect(await env.DB.prepare('SELECT 1 AS x FROM blocks WHERE user_id = ? AND blocked_id = ?').bind(b.id, a.id).first()).toBeTruthy();
    expect(await incoming(b)).toEqual([]);
    expect((await as(b, '/api/blocks', { method: 'POST', json: { task_id: t.id } })).status).toBe(404);
  });

  it('zonder OPEN_SIGNUP: 404', async () => {
    const [a, b] = [await createUser(), await createUser()];
    expect((await as(a, '/api/blocks', {}, env)).status).toBe(404);
    expect((await as(a, '/api/blocks', { method: 'POST', json: { user_id: b.id } }, env)).status).toBe(404);
  });
});
