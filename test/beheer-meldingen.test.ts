import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import { translate } from '../public/i18n.js';
import { BASE, callWith, createUser, openEnv, randomIp, session, TOKEN } from './helpers';

type User = Awaited<ReturnType<typeof createUser>>;
type Task = { id: string; title: string };

const e: Env = { ...openEnv, ADMIN_CONTACT: 'mailto:beheer@ex.test' };
const uniq = () => crypto.randomUUID().slice(0, 8);
const as = (u: User, path: string, o: { method?: string; json?: unknown } = {}) => callWith(e, path, { ...o, cookie: u.cookie });

/** Verzoek met eigen headers (cookie, Bearer, Origin) naar de Worker met de openbare env. */
async function raw(path: string, o: { method?: string; cookie?: string; auth?: string; origin?: string | null; accept?: string } = {}) {
  const headers = new Headers({ 'cf-connecting-ip': randomIp(), 'accept-language': 'nl', accept: o.accept ?? 'text/html' });
  if (o.cookie) headers.set('cookie', o.cookie);
  if (o.auth) headers.set('authorization', o.auth);
  if (o.origin !== null) headers.set('origin', o.origin ?? BASE);
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(BASE + path, { method: o.method ?? 'GET', headers, redirect: 'manual' }), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const act = (id: string, action: string, o: { cookie?: string; origin?: string | null } = {}) =>
  raw(`/admin/reports/${id}/${action}`, { method: 'POST', cookie: o.cookie ?? admin, origin: o.origin });

let admin: string;
beforeAll(async () => { admin = await session(); });
beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"id":"x"}', { status: 200 })); });
afterEach(() => vi.restoreAllMocks());

async function attach(taskId: string, by: User, name = 'foto.jpg', key = `a/${crypto.randomUUID()}`) {
  const id = crypto.randomUUID();
  await env.FILES!.put(key, new Uint8Array([1, 2, 3]));
  await env.DB.prepare("INSERT INTO attachments (id, task_id, user_id, name, mime, size, r2_key, status, created_at) VALUES (?, ?, ?, ?, 'image/jpeg', 3, ?, 'ready', ?)")
    .bind(id, taskId, by.id, name, key, new Date().toISOString()).run();
  return { id, key };
}

/** a deelt een taak (met bijlage) met b; b meldt hem. Geeft taak, bijlage en melding-id. */
async function reported(o: { attachment?: boolean } = {}) {
  const a = await createUser({ name: `Anna ${uniq()}` });
  const b = await createUser({ name: `Bram ${uniq()}` });
  const t = (await (await as(a, '/api/tasks', { method: 'POST', json: { title: `Taak ${uniq()}`, list: 'Thuis' } })).json()) as Task;
  const att = await attach(t.id, a);
  await as(a, '/api/shares', { method: 'POST', json: { task_id: t.id, mode: 'shared', to: b.email } });
  const inv = ((await (await as(b, '/api/shares/incoming')).json()) as { id: string }[])[0];
  await as(b, `/api/shares/${inv.id}/accept`, { method: 'POST', json: {} });
  await as(b, '/api/reports', { method: 'POST', json: o.attachment ? { attachment_id: att.id, reason: 'illegal' } : { task_id: t.id, reason: 'spam', note: 'Toelichting hier' } });
  const r = await env.DB.prepare('SELECT id FROM reports WHERE reporter_id = ?').bind(b.id).first<{ id: string }>();
  return { a, b, t, att, id: r!.id };
}

describe('beheerpagina meldingen', () => {
  it('alleen de beheerder met een sessie; niet ingelogd → naar /login', async () => {
    const { b, id } = await reported();
    expect((await raw(`/admin/reports/${id}`, { cookie: b.cookie })).status).toBe(403);
    expect((await raw(`/admin/reports/${id}`, { auth: `Bearer ${TOKEN}` })).status).toBe(403);
    const anon = await raw(`/admin/reports/${id}`);
    expect(anon.status).toBe(302);
    expect(anon.headers.get('location')).toBe(`/login?next=${encodeURIComponent(`/admin/reports/${id}`)}`);
    expect((await raw('/admin/reports', { cookie: admin })).status).toBe(200);
  });

  it('zonder OPEN_SIGNUP: 404', async () => {
    const res = await callWith(env, '/admin/reports', { cookie: admin, accept: 'text/html' });
    expect(res.status).toBe(404);
  });

  it('de pagina toont titel, reden, toelichting, namen en adressen, en de bijlage', async () => {
    const { a, b, t, att, id } = await reported();
    const html = await (await raw(`/admin/reports/${id}`, { cookie: admin })).text();
    for (const part of [t.title, 'Toelichting hier', a.email, b.email, translate('nl', 'report.reason_spam'), `/admin/reports/${id}/files/${att.id}`]) expect(html).toContain(part);
    const list = await (await raw('/admin/reports', { cookie: admin })).text();
    expect(list).toContain(t.title);
  });

  it('de bestandsroute geeft alleen bijlagen van de gemelde inhoud', async () => {
    const { a, att, id } = await reported();
    const other = (await (await as(a, '/api/tasks', { method: 'POST', json: { title: 'ander', list: 'Thuis' } })).json()) as Task;
    const elsewhere = await attach(other.id, a);
    const file = await raw(`/admin/reports/${id}/files/${att.id}`, { cookie: admin });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-security-policy')).toContain('sandbox');
    expect((await raw(`/admin/reports/${id}/files/${elsewhere.id}`, { cookie: admin })).status).toBe(404);
  });

  it('inhoud die intussen weg is: "bestaat niet meer", bestand 404', async () => {
    const { a, t, att, id } = await reported();
    await as(a, `/api/tasks/${t.id}?purge=1`, { method: 'DELETE' });
    await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(t.id).run();
    await env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(att.id).run();
    const html = await (await raw(`/admin/reports/${id}`, { cookie: admin })).text();
    expect(html).toContain(translate('nl', 'admin.gone'));
    expect(html).toContain(t.title);
    expect((await raw(`/admin/reports/${id}/files/${att.id}`, { cookie: admin })).status).toBe(404);
  });

  it('niets aan de hand: status dismissed', async () => {
    const { id } = await reported();
    const res = await act(id, 'dismiss');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/admin/reports/${id}`);
    expect((await env.DB.prepare('SELECT status FROM reports WHERE id = ?').bind(id).first<{ status: string }>())!.status).toBe('dismissed');
  });

  it('een andere Origin: 403 en er verandert niets', async () => {
    const { id } = await reported();
    expect((await act(id, 'dismiss', { origin: 'https://kwaad.example' })).status).toBe(403);
    expect((await act(id, 'dismiss', { origin: null })).status).toBe(403);
    expect((await env.DB.prepare('SELECT status FROM reports WHERE id = ?').bind(id).first<{ status: string }>())!.status).toBe('open');
  });

  it('inhoud verwijderen: taak definitief weg, het bestand ook uit kopieën, de tekst van de kopie blijft', async () => {
    const { a, t, att, id } = await reported();
    const c = await createUser();
    await as(a, '/api/shares', { method: 'POST', json: { task_id: t.id, mode: 'copy', to: c.email } });
    const inv = ((await (await as(c, '/api/shares/incoming')).json()) as { id: string }[])[0];
    await as(c, `/api/shares/${inv.id}/accept`, { method: 'POST', json: {} });
    const copy = await env.DB.prepare('SELECT id FROM tasks WHERE user_id = ? AND title = ?').bind(c.id, t.title).first<{ id: string }>();
    expect(copy).toBeTruthy();
    expect((await act(id, 'remove')).status).toBe(303);
    expect(await env.DB.prepare('SELECT 1 AS x FROM tasks WHERE id = ?').bind(t.id).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 AS x FROM attachments WHERE r2_key = ?').bind(att.key).first()).toBeNull();
    expect(await env.FILES!.head(att.key)).toBeNull();
    expect(await env.DB.prepare('SELECT 1 AS x FROM tasks WHERE id = ?').bind(copy!.id).first()).toBeTruthy();
    expect((await env.DB.prepare('SELECT status FROM reports WHERE id = ?').bind(id).first<{ status: string }>())!.status).toBe('removed');
  });

  it('een gemelde bijlage verwijderen: alleen die bijlage, de taak blijft', async () => {
    const { t, att, id } = await reported({ attachment: true });
    expect((await act(id, 'remove')).status).toBe(303);
    expect(await env.DB.prepare('SELECT 1 AS x FROM attachments WHERE id = ?').bind(att.id).first()).toBeNull();
    expect(await env.FILES!.head(att.key)).toBeNull();
    expect(await env.DB.prepare('SELECT 1 AS x FROM tasks WHERE id = ?').bind(t.id).first()).toBeTruthy();
  });

  it('schorsen: uitgelogd, sleutel werkt niet, inloggen geweigerd, delen weg; opheffen laat weer inloggen', async () => {
    const { a, id } = await reported();
    const c = await createUser();
    const t2 = (await (await as(a, '/api/tasks', { method: 'POST', json: { title: 'nog een', list: 'Thuis' } })).json()) as Task;
    await as(a, '/api/shares', { method: 'POST', json: { task_id: t2.id, mode: 'shared', to: c.email } });
    const key = ((await (await callWith(e, '/api/keys', { method: 'POST', cookie: a.cookie, json: { name: 'k', kind: 'full' } })).json()) as { key: string }).key;
    expect(key).toBeTruthy();
    expect((await act(id, 'suspend')).status).toBe(303);
    expect((await as(a, '/api/tasks')).status).toBe(401);
    expect((await raw('/api/tasks', { auth: `Bearer ${key}`, accept: 'application/json' })).status).toBe(401);
    const res = await callWith(e, '/login', { method: 'POST', json: { email: a.email, password: a.password } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe(translate('en', 'err.account_suspended', { email: 'beheer@ex.test' }));
    const wrong = await callWith(e, '/login', { method: 'POST', json: { email: a.email, password: 'fout-fout-fout' } });
    expect(wrong.status).toBe(401);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM task_shares WHERE from_user = ?').bind(a.id).first<{ n: number }>()).toEqual({ n: 0 });
    expect((await act(id, 'unsuspend')).status).toBe(303);
    expect((await callWith(e, '/login', { method: 'POST', json: { email: a.email, password: a.password } })).status).toBe(200);
  });

  it('namen en bestandsnamen staan ge-escaped op de pagina', async () => {
    const { a, att, id } = await reported({ attachment: true });
    await env.DB.prepare("UPDATE users SET name = '<b>Kwaad</b>' WHERE id = ?").bind(a.id).run();
    await env.DB.prepare("UPDATE reports SET attachment_name = '<i>raar</i>' WHERE id = ?").bind(id).run();
    await env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(att.id).run();
    const html = await (await raw(`/admin/reports/${id}`, { cookie: admin })).text();
    expect(html).not.toContain('<b>Kwaad</b>');
    expect(html).not.toContain('<i>raar</i>');
    expect(html).toContain('&#60;b&#62;Kwaad');
  });

  it('schorsen werkt ook met veel gedeelde lijsten, met een vast aantal statements', async () => {
    const { suspendStmts } = await import('../src/admin');
    const [a, b] = [await createUser(), await createUser()];
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const name = `Lijst ${uniq()}`;
      await as(a, '/api/lists', { method: 'POST', json: { name } });
      const { list_id } = (await (await as(a, '/api/shared-lists', { method: 'POST', json: { name, to: b.email } })).json()) as { list_id: string };
      await as(b, `/api/shared-lists/${list_id}/accept`, { method: 'POST', json: {} });
      await as(a, '/api/tasks', { method: 'POST', json: { title: `T ${i}`, list: name } });
      ids.push(list_id);
    }
    const other = `Van B ${uniq()}`;
    await as(b, '/api/lists', { method: 'POST', json: { name: other } });
    const { list_id: bList } = (await (await as(b, '/api/shared-lists', { method: 'POST', json: { name: other, to: a.email } })).json()) as { list_id: string };
    await as(a, `/api/shared-lists/${bList}/accept`, { method: 'POST', json: {} });
    const fresh = await createUser();
    expect(suspendStmts(env.DB, a.id).length).toBe(suspendStmts(env.DB, fresh.id).length);
    await env.DB.batch(suspendStmts(env.DB, a.id));
    const n = async (sql: string, ...v: string[]) => (await env.DB.prepare(sql).bind(...v).first<{ n: number }>())!.n;
    expect(await n('SELECT COUNT(*) AS n FROM shared_lists WHERE owner_id = ?', a.id)).toBe(0);
    expect(await n('SELECT COUNT(*) AS n FROM list_members WHERE user_id = ?', a.id)).toBe(0);
    expect(await n('SELECT COUNT(*) AS n FROM list_members WHERE user_id = ? AND list_id != ?', b.id, bList)).toBe(0);
    expect(await n('SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND shared_list IS NOT NULL', a.id)).toBe(0);
    expect(await n('SELECT COUNT(*) AS n FROM tasks WHERE user_id = ?', a.id)).toBeGreaterThanOrEqual(12);
    expect(await n('SELECT COUNT(*) AS n FROM task_shares WHERE to_user = ?', b.id)).toBe(0);
    expect(ids).toHaveLength(12);
  });

  it('een beheerder schorsen kan niet', async () => {
    const b = await createUser();
    const rid = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO reports (id, reporter_id, reported_id, reason, title, created_at) VALUES (?, ?, '00000000-0000-4000-8000-000000000001', 'spam', 'x', ?)")
      .bind(rid, b.id, new Date().toISOString()).run();
    expect((await act(rid, 'suspend')).status).toBe(400);
  });
});
