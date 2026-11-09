import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callWith, createUser, openEnv } from './helpers';
import { translate } from '../public/i18n.js';
import type { Env } from '../src/index';

type User = Awaited<ReturnType<typeof createUser>>;
type Member = { share_id: string; user_id: string; name: string; status: string };
type Task = { id: string; title: string; share: { mine: boolean; members: Member[] } | null };

const err = (key: string) => ({ error: translate('en', key), key, vars: {} });
const uniq = () => crypto.randomUUID().slice(0, 8);
const as = (u: User, path: string, o: { method?: string; json?: unknown } = {}, e: Env = openEnv) => callWith(e, path, { ...o, cookie: u.cookie });
const newTask = async (u: User, title = `Taak ${uniq()}`) =>
  (await (await as(u, '/api/tasks', { method: 'POST', json: { title, list: 'Thuis' } })).json()) as Task;
const share = (u: User, taskId: string, to: unknown, mode = 'shared', e: Env = openEnv) =>
  as(u, '/api/shares', { method: 'POST', json: { task_id: taskId, mode, ...(typeof to === 'object' ? to : { to }) } }, e);
const taskOf = async (u: User, id: string) => ((await (await as(u, '/api/tasks')).json()) as Task[]).find((t) => t.id === id)!;
const incoming = async (u: User) => (await (await as(u, '/api/shares/incoming')).json()) as { id: string; task: { title: string } }[];

/** Een taak van a, gedeeld met b en door b geaccepteerd. */
async function acceptedShare(a: User, b: User) {
  const t = await newTask(a);
  expect((await share(a, t.id, b.email)).status).toBe(201);
  const inv = (await incoming(b)).find((i) => i.task.title === t.title)!;
  expect((await as(b, `/api/shares/${inv.id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
  return t;
}

beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"id":"x"}', { status: 200 })); });
afterEach(() => vi.restoreAllMocks());

describe('delen op een openbare Tick', () => {
  it('people toont alleen wie je al kent', async () => {
    const [a, b, c] = [await createUser({ name: 'An' }), await createUser({ name: 'Bo' }), await createUser({ name: 'Cor' })];
    expect(await (await as(a, '/api/shares/people')).json()).toEqual([]);
    await acceptedShare(a, b);
    expect(await (await as(a, '/api/shares/people')).json()).toEqual([{ id: b.id, name: 'Bo' }]);
    expect(await (await as(b, '/api/shares/people')).json()).toEqual([{ id: a.id, name: 'An' }]);
    expect(await (await as(c, '/api/shares/people')).json()).toEqual([]);
  });

  it('een id buiten je bekenden telt niet; een naam ook niet', async () => {
    const [a, b] = [await createUser(), await createUser({ name: `Naam ${uniq()}` })];
    const t = await newTask(a);
    const byId = await share(a, t.id, { to_user: b.id });
    expect(byId.status).toBe(400);
    expect(await byId.json()).toEqual(err('err.share_email_needed'));
    const byName = await share(a, t.id, 'Naam');
    expect(await byName.json()).toEqual(err('err.share_email_needed'));
  });

  it('een onbevestigde afzender kan niet delen', async () => {
    const a = await createUser({ verified: false });
    const t = await newTask(a);
    const res = await share(a, t.id, 'iemand@ex.test');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(err('err.verify_first'));
  });

  it('hetzelfde antwoord voor een bekend en een onbekend adres', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const t1 = await newTask(a); const t2 = await newTask(a);
    const known = await share(a, t1.id, b.email);
    const unknown = await share(a, t2.id, `niemand-${uniq()}@ex.test`);
    expect(known.status).toBe(201);
    expect(unknown.status).toBe(201);
    expect(await known.json()).toEqual(await unknown.json());
  });

  it('onbekend of onbevestigd adres → email_invites, geen task_shares', async () => {
    const a = await createUser();
    const ghost = await createUser({ verified: false });
    const t = await newTask(a);
    const nobody = ` Niemand-${uniq()}@Ex.test `;
    expect((await share(a, t.id, nobody)).status).toBe(201);
    expect((await share(a, t.id, ghost.email)).status).toBe(201);
    const inv = await env.DB.prepare('SELECT email FROM email_invites WHERE task_id = ? ORDER BY created_at').bind(t.id).all<{ email: string }>();
    expect(inv.results.map((r) => r.email.toLowerCase()).sort()).toEqual([nobody.trim().toLowerCase(), ghost.email.toLowerCase()].sort());
    const shares = await env.DB.prepare('SELECT COUNT(*) AS n FROM task_shares WHERE task_id = ?').bind(t.id).first<{ n: number }>();
    expect(shares!.n).toBe(0);
  });

  it('je eigen adres in hoofdletters → err.share_self', async () => {
    const a = await createUser();
    const t = await newTask(a);
    const res = await share(a, t.id, a.email.toUpperCase());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(err('err.share_self'));
  });

  it('hetzelfde onbekende adres twee keer → 409, net als bij een account', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const t = await newTask(a);
    const nobody = `twee-${uniq()}@ex.test`;
    await share(a, t.id, nobody);
    const again = await share(a, t.id, nobody.toUpperCase());
    expect(again.status).toBe(409);
    await share(a, t.id, b.email);
    const againKnown = await share(a, t.id, b.email);
    expect(again.status).toBe(againKnown.status);
    expect(await again.json()).toEqual(await againKnown.json());
  });

  it('een lijst delen met een onbekend adres maakt hem toch gedeeld', async () => {
    const a = await createUser();
    await newTask(a);
    const res = await as(a, '/api/shared-lists', { method: 'POST', json: { name: 'Thuis', to: `lijst-${uniq()}@ex.test` } });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare('SELECT 1 AS x FROM shared_lists WHERE owner_id = ?').bind(a.id).first();
    expect(row).toBeTruthy();
    const inv = await env.DB.prepare('SELECT list_id FROM email_invites WHERE from_user = ?').bind(a.id).first<{ list_id: string }>();
    expect(inv!.list_id).toBeTruthy();
  });

  it('de eigenaar ziet openstaande uitnodigingen als e-mailadres; na accepteren de naam', async () => {
    const [a, b] = [await createUser(), await createUser({ name: `Bas ${uniq()}` })];
    const t = await newTask(a);
    const nobody = `open-${uniq()}@ex.test`;
    await share(a, t.id, b.email);
    await share(a, t.id, nobody);
    const names = (await taskOf(a, t.id)).share!.members.map((m) => m.name).sort();
    expect(names).toEqual([b.email, nobody].sort());
    const inv = (await incoming(b)).find((i) => i.task.title === t.title)!;
    await as(b, `/api/shares/${inv.id}/accept`, { method: 'POST', json: {} });
    const after = (await taskOf(a, t.id)).share!.members;
    expect(after.find((m) => m.status === 'accepted')!.name).toMatch(/^Bas /);
    // b ziet de openstaande uitnodiging aan het onbekende adres niet.
    expect((await taskOf(b, t.id)).share!.members.some((m) => m.name === nobody)).toBe(false);
  });

  it('een uitnodiging aan een adres intrekken met mail:<id>; een ander kan dat niet', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const t = await newTask(a);
    await share(a, t.id, `weg-${uniq()}@ex.test`);
    const m = (await taskOf(a, t.id)).share!.members[0];
    expect(m.user_id).toMatch(/^mail:/);
    expect((await as(b, `/api/shares/${m.share_id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await as(a, `/api/shares/${m.share_id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await taskOf(a, t.id)).share).toBeNull();
    // Voor een lijst via de leden-route.
    await newTask(a);
    await as(a, '/api/shared-lists', { method: 'POST', json: { name: 'Thuis', to: `lid-${uniq()}@ex.test` } });
    const lists = (await (await as(a, '/api/lists')).json()) as { name: string; shared?: { id: string; members: Member[] } }[];
    const thuis = lists.find((l) => l.name === 'Thuis')!.shared!;
    const lid = thuis.members.find((x) => x.user_id.startsWith('mail:'))!;
    expect((await as(a, `/api/shared-lists/${thuis.id}/members/${lid.user_id}`, { method: 'DELETE' })).status).toBe(200);
  });

  it('een account verwijderen ruimt zijn uitnodigingen aan adressen op', async () => {
    const a = await createUser();
    const t = await newTask(a);
    await share(a, t.id, `opruim-${uniq()}@ex.test`);
    expect((await as(a, '/api/account/delete', { method: 'POST', json: { password: a.password } })).status).toBe(200);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM email_invites WHERE from_user = ?').bind(a.id).first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('zonder OPEN_SIGNUP: delen op naam en people zoals altijd', async () => {
    const [a, b] = [await createUser(), await createUser({ name: `Gewoon ${uniq()}` })];
    const t = await newTask(a);
    const people = (await (await as(a, '/api/shares/people', {}, env)).json()) as { id: string }[];
    expect(people.some((p) => p.id === b.id)).toBe(true);
    const byName = await share(a, t.id, (await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(b.id).first<{ name: string }>())!.name, 'shared', env);
    expect(byName.status).toBe(201);
    expect(await byName.json()).toMatchObject({ to_user: b.id });
  });
});
