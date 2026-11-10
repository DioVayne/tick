import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callWith, createUser, openEnv } from './helpers';
import { purgeUnverified } from '../src/signup';
import type { Env } from '../src/index';

// Bevindingen uit de review van de hele branch (openbare Tick).
type User = Awaited<ReturnType<typeof createUser>>;
type Member = { share_id: string; user_id: string; name: string; status: string };
type Mail = { to: string[]; subject: string; text: string };

const DAY = 86_400_000;
const uniq = () => crypto.randomUUID().slice(0, 8);
let sent: () => Mail[];
beforeEach(() => {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"id":"x"}', { status: 200 }));
  sent = () => spy.mock.calls.filter(([url]) => String(url) === 'https://api.resend.com/emails')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Mail);
});
afterEach(() => vi.restoreAllMocks());

const as = (u: { cookie: string }, path: string, o: { method?: string; json?: unknown } = {}, e: Env = openEnv) => callWith(e, path, { ...o, cookie: u.cookie });
const newTask = async (u: User) => (await (await as(u, '/api/tasks', { method: 'POST', json: { title: `T ${uniq()}`, list: 'Thuis' } })).json()) as { id: string; title: string };
const share = (u: User, taskId: string, to: string, mode = 'shared') => as(u, '/api/shares', { method: 'POST', json: { task_id: taskId, mode, to } });
const linkIn = (text: string, kind: string) => new RegExp(`https://tick\\.test(/${kind}/[A-Za-z0-9_-]+)`).exec(text)![1];
const verified = async (id: string) => (await env.DB.prepare('SELECT email_verified_at AS v FROM users WHERE id = ?').bind(id).first<{ v: string | null }>())!.v;
const exists = async (id: string) => !!(await env.DB.prepare('SELECT 1 AS x FROM users WHERE id = ?').bind(id).first());

async function signUp(email = `s-${uniq()}@ex.test`, e: Env = openEnv) {
  const res = await callWith(e, '/signup', { method: 'POST', json: { name: 'Sam', email, password: 'lang-genoeg-1' } });
  expect(res.status).toBe(201);
  const id = (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>())!.id;
  return { cookie: res.headers.get('set-cookie')!.split(';')[0], id, email, password: 'lang-genoeg-1' };
}

describe('review: openbare Tick', () => {
  it('1. een gevestigd account dat zijn adres wijzigt, wordt niet opgeruimd', async () => {
    const u = await createUser({ createdAt: new Date(Date.now() - 60 * DAY).toISOString() });
    expect((await as(u, '/api/account', { method: 'PATCH', json: { email: `nieuw-${uniq()}@ex.test`, password: u.password } })).status).toBe(200);
    await purgeUnverified(openEnv, Date.now());
    expect(await exists(u.id)).toBe(true);
    const cfg = await (await as(u, '/config.js')).text();
    expect(cfg).toContain('"verifyBy":null');
  });

  it('2. een oude bevestigingslink bevestigt na een adreswijziging het nieuwe adres niet', async () => {
    const s = await signUp();
    const old = linkIn(sent().at(-1)!.text, 'verify');
    const victim = `slachtoffer-${uniq()}@ex.test`;
    expect((await as(s, '/api/account', { method: 'PATCH', json: { email: victim, password: s.password } })).status).toBe(200);
    await callWith(openEnv, old, { accept: 'text/html' });
    expect(await verified(s.id)).toBeNull();
  });

  it('2b. ook een oude herstellink uit /forgot bevestigt het nieuwe adres niet', async () => {
    const s = await signUp();
    await callWith(openEnv, '/forgot', { method: 'POST', json: { email: s.email } });
    const reset = linkIn(sent().at(-1)!.text, 'reset');
    expect((await as(s, '/api/account', { method: 'PATCH', json: { email: `ander-${uniq()}@ex.test`, password: s.password } })).status).toBe(200);
    await callWith(openEnv, reset, { method: 'POST', json: { password: 'nieuw-wachtwoord-1' } });
    expect(await verified(s.id)).toBeNull();
  });

  it('3. openstaande uitnodigingen hebben dezelfde vorm, met of zonder account', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const t = await newTask(a);
    await share(a, t.id, b.email);
    await share(a, t.id, `geen-${uniq()}@ex.test`);
    const tasks = (await (await as(a, '/api/tasks')).json()) as { id: string; share: { members: Member[] } | null }[];
    const members = tasks.find((x) => x.id === t.id)!.share!.members;
    const shape = (m: Member) => [m.user_id.replace(/[0-9a-f]/g, 'x'), m.share_id.replace(/[0-9a-f]/g, 'x')];
    expect(shape(members[0])).toEqual(shape(members[1]));
    // Lijsten: idem.
    await as(a, '/api/shared-lists', { method: 'POST', json: { name: 'Thuis', to: b.email } });
    await as(a, '/api/shared-lists', { method: 'POST', json: { name: 'Thuis', to: `lijst-${uniq()}@ex.test` } });
    const lists = (await (await as(a, '/api/lists')).json()) as { name: string; shared: { id: string; members: Member[] } | null }[];
    const thuis = lists.find((l) => l.name === 'Thuis')!.shared!;
    const ids = thuis.members.map((m) => m.user_id.replace(/[0-9a-f]/g, 'x'));
    expect(ids[0]).toBe(ids[1]);
    // Intrekken werkt voor beide.
    for (const m of thuis.members) expect((await as(a, `/api/shared-lists/${thuis.id}/members/${m.user_id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM list_members WHERE list_id = ? AND role = 'member'").bind(thuis.id).first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('3b. na omzetten houdt een taakuitnodiging dezelfde share_id', async () => {
    const a = await createUser();
    const email = `om-${uniq()}@ex.test`;
    const t = await newTask(a);
    await share(a, t.id, email);
    const before = ((await (await as(a, '/api/tasks')).json()) as { id: string; share: { members: Member[] } }[]).find((x) => x.id === t.id)!.share.members[0];
    await signUp(email);
    await callWith(openEnv, linkIn(sent().at(-1)!.text, 'verify'), { accept: 'text/html' });
    const after = ((await (await as(a, '/api/tasks')).json()) as { id: string; share: { members: Member[] } }[]).find((x) => x.id === t.id)!.share.members[0];
    expect(after.share_id).toBe(before.share_id);
    expect(after.user_id).toBe(before.user_id);
  });

  it('4. bevestigen via de herstelmail zet uitnodigingen ook om', async () => {
    const a = await createUser();
    const email = `herstel-${uniq()}@ex.test`;
    const t = await newTask(a);
    const s = await signUp(email);
    await share(a, t.id, email); // nog onbevestigd: een uitnodiging aan het adres
    await callWith(openEnv, '/forgot', { method: 'POST', json: { email } });
    const reset = await callWith(openEnv, linkIn(sent().at(-1)!.text, 'reset'), { method: 'POST', json: { password: 'nieuw-wachtwoord-1' } });
    const cookie = reset.headers.get('set-cookie')!.split(';')[0]; // herstellen logt andere sessies uit
    expect(s.id).toBeTruthy();
    const incoming = (await (await callWith(openEnv, '/api/shares/incoming', { cookie })).json()) as { task: { title: string } }[];
    expect(incoming.map((i) => i.task.title)).toContain(t.title);
  });

  it('5. een account van vóór mail aan wordt niet opgeruimd als mail later aangaat', async () => {
    const noMail: Env = { ...openEnv, RESEND_API_KEY: undefined };
    const s = await signUp(`zonder-${uniq()}@ex.test`, noMail);
    await env.DB.prepare('UPDATE users SET created_at = ? WHERE id = ?').bind(new Date(Date.now() - 40 * DAY).toISOString(), s.id).run();
    await purgeUnverified(openEnv, Date.now());
    expect(await exists(s.id)).toBe(true);
    await env.DB.prepare('UPDATE users SET email_verified_at = created_at WHERE id = ?').bind(s.id).run();
  });

  it('6. een kopie aan iemand die al in de groep zit: hetzelfde antwoord als aan een onbekend adres', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const t = await newTask(a);
    await share(a, t.id, b.email, 'copy');
    const inv = ((await (await as(b, '/api/shares/incoming')).json()) as { id: string; task: { title: string } }[]).find((i) => i.task.title === t.title)!;
    expect((await as(b, `/api/shares/${inv.id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
    const t2 = await newTask(a);
    void t2;
    // a stuurt dezelfde taak nog eens als kopie aan b (zit al in de groep) en aan een onbekend adres.
    const again = await share(a, t.id, b.email, 'copy');
    const unknown = await share(a, t.id, `kopie-${uniq()}@ex.test`, 'copy');
    expect(again.status).toBe(unknown.status);
    expect(await again.json()).toEqual(await unknown.json());
  });
});
