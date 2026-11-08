import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callWith, createUser, openEnv } from './helpers';
import { translate } from '../public/i18n.js';
import type { Env } from '../src/index';

type User = Awaited<ReturnType<typeof createUser>>;
type Task = { id: string; title: string; list: string };
type Mail = { to: string[]; subject: string; text: string; html: string };

const ADMIN_MAIL = 'beheer@ex.test';
const e: Env = { ...openEnv, ADMIN_CONTACT: `mailto:${ADMIN_MAIL}` };
const uniq = () => crypto.randomUUID().slice(0, 8);
const as = (u: User, path: string, o: { method?: string; json?: unknown } = {}, en: Env = e) => callWith(en, path, { ...o, cookie: u.cookie });
const newTask = async (u: User, list = 'Thuis') =>
  (await (await as(u, '/api/tasks', { method: 'POST', json: { title: `Taak ${uniq()}`, list } })).json()) as Task;
const share = (u: User, taskId: string, to: string, mode = 'shared') => as(u, '/api/shares', { method: 'POST', json: { task_id: taskId, mode, to } });
const tasksOf = async (u: User) => ((await (await as(u, '/api/tasks')).json()) as Task[]).map((t) => t.id);
const incoming = async (u: User) => (await (await as(u, '/api/shares/incoming')).json()) as { id: string; task: { title: string } }[];
const report = (u: User, body: Record<string, unknown>) => as(u, '/api/reports', { method: 'POST', json: { reason: 'spam', ...body } });
const reportsBy = async (u: User) => (await env.DB.prepare('SELECT * FROM reports WHERE reporter_id = ? ORDER BY created_at').bind(u.id)
  .all<{ reported_id: string; title: string; reason: string; note: string; task_id: string | null; list_id: string | null; attachment_id: string | null; attachment_name: string | null }>()).results;

let sent: () => Mail[];
beforeEach(() => {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"id":"x"}', { status: 200 }));
  sent = () => spy.mock.calls.filter(([url]) => String(url) === 'https://api.resend.com/emails')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Mail);
});
afterEach(() => vi.restoreAllMocks());
const reportMails = () => sent().filter((m) => m.to[0] === ADMIN_MAIL);

async function acceptedShare(a: User, b: User) {
  const t = await newTask(a);
  expect((await share(a, t.id, b.email)).status).toBe(201);
  const inv = (await incoming(b)).find((i) => i.task.title === t.title)!;
  expect((await as(b, `/api/shares/${inv.id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
  return t;
}

async function sharedList(owner: User, members: User[]) {
  const name = `Lijst ${uniq()}`;
  await as(owner, '/api/lists', { method: 'POST', json: { name } });
  let id = '';
  for (const m of members) {
    id = ((await (await as(owner, '/api/shared-lists', { method: 'POST', json: { name, to: m.email } })).json()) as { list_id: string }).list_id;
    expect((await as(m, `/api/shared-lists/${id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
  }
  return { name, id };
}

/** Een bijlage van `by` aan taak `taskId`, rechtstreeks in D1 en R2. */
async function attach(taskId: string, by: User, name = 'foto.jpg') {
  const id = crypto.randomUUID();
  const key = `a/${crypto.randomUUID()}`;
  await env.FILES!.put(key, new Uint8Array([1, 2, 3]));
  await env.DB.prepare("INSERT INTO attachments (id, task_id, user_id, name, mime, size, r2_key, status, created_at) VALUES (?, ?, ?, ?, 'image/jpeg', 3, ?, 'ready', ?)")
    .bind(id, taskId, by.id, name, key, new Date().toISOString()).run();
  return { id, key };
}

describe('melden', () => {
  it('een gedeelde taak: melding, de melder stopt, mail aan de beheerder zonder adressen of bestand', async () => {
    const [a, b] = [await createUser({ name: 'Anna' }), await createUser({ name: 'Bram' })];
    const t = await acceptedShare(a, b);
    const res = await report(b, { task_id: t.id, reason: 'illegal', note: 'Dit klopt niet' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(await tasksOf(b)).not.toContain(t.id);
    expect(await tasksOf(a)).toContain(t.id);
    const [r] = await reportsBy(b);
    expect(r).toMatchObject({ reported_id: a.id, title: t.title, reason: 'illegal', note: 'Dit klopt niet', task_id: t.id });
    const mails = reportMails();
    expect(mails).toHaveLength(1);
    const m = mails[0];
    expect(m.text).toContain(t.title);
    expect(m.text).toContain('Dit klopt niet');
    expect(m.text).toContain('Anna');
    expect(m.text).toMatch(/\/admin\/reports\/[0-9a-f-]{36}/);
    for (const part of [m.text, m.html]) {
      expect(part).not.toContain(a.email);
      expect(part).not.toContain(b.email);
      expect(part).not.toContain('/api/attachments');
    }
  });

  it('een openstaande uitnodiging: gemeld en geweigerd; met block ook geblokkeerd', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const t = await newTask(a);
    await share(a, t.id, b.email, 'copy');
    const inv = (await incoming(b))[0];
    expect((await report(b, { share_id: inv.id, block: true })).status).toBe(201);
    expect(await incoming(b)).toEqual([]);
    expect((await reportsBy(b))[0]).toMatchObject({ reported_id: a.id, title: t.title });
    expect(await env.DB.prepare('SELECT 1 AS x FROM blocks WHERE user_id = ? AND blocked_id = ?').bind(b.id, a.id).first()).toBeTruthy();
  });

  it('een lijstuitnodiging en een geaccepteerde lijst: gemeld is de eigenaar; de melder vertrekt', async () => {
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    const name = `Lijst ${uniq()}`;
    await as(a, '/api/lists', { method: 'POST', json: { name } });
    const { list_id } = (await (await as(a, '/api/shared-lists', { method: 'POST', json: { name, to: b.email } })).json()) as { list_id: string };
    expect((await report(b, { list_id })).status).toBe(201);
    expect(await (await as(b, '/api/shared-lists/incoming')).json()).toEqual([]);
    expect((await reportsBy(b))[0]).toMatchObject({ reported_id: a.id, list_id, title: name });
    const list = await sharedList(a, [c]);
    expect((await report(c, { list_id: list.id })).status).toBe(201);
    expect(await env.DB.prepare('SELECT 1 AS x FROM list_members WHERE list_id = ? AND user_id = ?').bind(list.id, c.id).first()).toBeNull();
    expect((await report(a, { list_id: list.id })).status).toBe(400); // je eigen lijst
  });

  it('een taak in een gedeelde lijst: gemeld is wie hem erin zette; als eigenaar gaat die uit de lijst', async () => {
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    const list = await sharedList(a, [b, c]);
    const byB = await (await as(b, '/api/tasks', { method: 'POST', json: { title: 'van B', list: list.name } })).json() as Task;
    expect((await report(c, { task_id: byB.id })).status).toBe(201);
    expect((await reportsBy(c))[0].reported_id).toBe(b.id);
    expect(await env.DB.prepare('SELECT 1 AS x FROM list_members WHERE list_id = ? AND user_id = ?').bind(list.id, c.id).first()).toBeNull();
    expect((await report(a, { task_id: byB.id })).status).toBe(201);
    expect((await reportsBy(a))[0].reported_id).toBe(b.id);
    expect(await env.DB.prepare('SELECT 1 AS x FROM list_members WHERE list_id = ? AND user_id = ?').bind(list.id, b.id).first()).toBeNull();
    expect((await report(b, { task_id: byB.id })).status).toBe(404); // b zit er niet meer in
  });

  it('dezelfde lijsttaak twee keer melden als eigenaar: de tweede keer 404', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const list = await sharedList(a, [b]);
    const byB = await (await as(b, '/api/tasks', { method: 'POST', json: { title: 'van B', list: list.name } })).json() as Task;
    expect((await report(a, { task_id: byB.id })).status).toBe(201);
    expect((await report(a, { task_id: byB.id })).status).toBe(404);
    expect(await reportsBy(a)).toHaveLength(1);
  });

  it('een bijlage van een deelnemer: gemeld is de uploader, de eigenaar haalt hem eraf, de bijlage blijft', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const t = await acceptedShare(a, b);
    const att = await attach(t.id, b, 'raar.jpg');
    expect((await report(a, { attachment_id: att.id })).status).toBe(201);
    expect((await reportsBy(a))[0]).toMatchObject({ reported_id: b.id, attachment_id: att.id, attachment_name: 'raar.jpg', task_id: t.id });
    expect(await tasksOf(b)).not.toContain(t.id);
    expect(await env.DB.prepare('SELECT 1 AS x FROM attachments WHERE id = ?').bind(att.id).first()).toBeTruthy();
    expect(await env.FILES!.head(att.key)).toBeTruthy();
  });

  it('een bijlage van de eigenaar: de ontvanger meldt en vertrekt', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const t = await acceptedShare(a, b);
    const att = await attach(t.id, a);
    expect((await report(b, { attachment_id: att.id })).status).toBe(201);
    expect((await reportsBy(b))[0].reported_id).toBe(a.id);
    expect(await tasksOf(b)).not.toContain(t.id);
  });

  it('eigen inhoud → 400; geen toegang → 404; ongeldige reden → 400', async () => {
    const [a, b, x] = [await createUser(), await createUser(), await createUser()];
    const t = await acceptedShare(a, b);
    const mine = await attach(t.id, b);
    const own = await report(a, { task_id: t.id });
    expect(own.status).toBe(400);
    expect(await own.json()).toEqual({ error: translate('en', 'err.report_own') });
    expect((await report(b, { attachment_id: mine.id })).status).toBe(400);
    expect((await report(x, { task_id: t.id })).status).toBe(404);
    expect((await report(x, {})).status).toBe(404);
    const bad = await report(b, { task_id: t.id, reason: 'boos' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: translate('en', 'err.report_reason') });
    expect(await reportsBy(b)).toEqual([]);
  });

  it('een bijlage in je eigen kopie meld je niet', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const t = await newTask(a);
    await attach(t.id, a);
    await share(a, t.id, b.email, 'copy');
    const inv = (await incoming(b))[0];
    await as(b, `/api/shares/${inv.id}/accept`, { method: 'POST', json: {} });
    const copy = await env.DB.prepare("SELECT a.id FROM attachments a JOIN tasks t ON t.id = a.task_id WHERE t.user_id = ?").bind(b.id).first<{ id: string }>();
    expect((await report(b, { attachment_id: copy!.id })).status).toBe(404);
  });

  it('de elfde melding binnen een dag: wel opgezegd, geen rij en geen mail', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const ts = new Date().toISOString();
    await env.DB.batch(Array.from({ length: 10 }, () => env.DB.prepare(
      "INSERT INTO reports (id, reporter_id, reported_id, reason, title, created_at) VALUES (?, ?, ?, 'spam', 'x', ?)").bind(crypto.randomUUID(), b.id, a.id, ts)));
    const t = await acceptedShare(a, b);
    expect((await report(b, { task_id: t.id })).status).toBe(201);
    expect(await tasksOf(b)).not.toContain(t.id);
    expect(await reportsBy(b)).toHaveLength(10);
    expect(reportMails()).toEqual([]);
  });

  it('een bijlage zegt wie hem uploadde (voor de meldknop)', async () => {
    const [a, b] = [await createUser(), await createUser()];
    const t = await acceptedShare(a, b);
    const att = await attach(t.id, b);
    const list = (await (await as(a, `/api/tasks/${t.id}/attachments`)).json()) as { id: string; user_id: string }[];
    expect(list.find((x) => x.id === att.id)!.user_id).toBe(b.id);
  });

  it('zonder OPEN_SIGNUP: 404', async () => {
    const [a, b] = [await createUser(), await createUser()];
    expect((await as(a, '/api/reports', { method: 'POST', json: { reason: 'spam', task_id: 'x' } }, env)).status).toBe(404);
    expect(b).toBeTruthy();
  });
});
