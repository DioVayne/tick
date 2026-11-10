import { applyD1Migrations, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import { translate } from '../public/i18n.js';
import { sendReportMail } from '../src/reports';
import { deleteUserStmts } from '../src/users';
import { BASE, createUser, openEnv, randomIp, session } from './helpers';

type User = Awaited<ReturnType<typeof createUser>> & { name: string };
const mk = async (name: string): Promise<User> => ({ ...await createUser({ name }), name });
type Row = {
  reporter_id: string | null; reported_id: string | null; reason: string; note: string; task_id: string | null; list_id: string | null;
  attachment_id: string | null; title: string; attachment_name: string | null; status: string; created_at: string; handled_at: string | null;
};

const NOW = '2026-01-01T00:00:00.000Z';
const e: Env = { ...openEnv, ADMIN_CONTACT: 'mailto:beheer@ex.test' };
const uniq = () => crypto.randomUUID().slice(0, 8);
const nl = (k: string) => translate('nl', k);

async function raw(path: string, o: { method?: string; cookie?: string } = {}) {
  const headers = new Headers({ 'cf-connecting-ip': randomIp(), 'accept-language': 'nl', accept: 'text/html', origin: BASE });
  if (o.cookie) headers.set('cookie', o.cookie);
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(BASE + path, { method: o.method ?? 'GET', headers, redirect: 'manual' }), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** Een melding van `by` over `about`, met alle kolommen gevuld. */
async function report(by: User, about: User) {
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO reports (id, reporter_id, reported_id, reason, note, task_id, list_id, attachment_id, title, attachment_name, status, created_at, handled_at) ' +
    "VALUES (?, ?, ?, 'illegal', ?, 'taak-x', 'lijst-x', 'bijlage-x', ?, 'paspoort.jpg', 'dismissed', ?, ?)")
    .bind(id, by.id, about.id, `Over ${about.name}`, `Titel van ${about.name}`, NOW, NOW).run();
  return id;
}
const rowOf = async (id: string) => (await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first<Row>())!;

describe('migratie 0026 (meldingen blijven na verwijderen)', () => {
  it('bestaande meldingen blijven; melder en gemelde mogen NULL zijn', async () => {
    const db = env.MIGRATE_DB;
    await applyD1Migrations(db, env.TEST_MIGRATIONS.filter((m) => m.name < '0026'));
    await db.prepare("INSERT INTO reports (id, reporter_id, reported_id, reason, note, title, status, created_at) VALUES ('r1', 'a', 'b', 'spam', 'n', 'T', 'removed', ?)").bind(NOW).run();
    await expect(db.prepare("INSERT INTO reports (id, reporter_id, reported_id, reason, title, created_at) VALUES ('r0', NULL, 'b', 'spam', 'T', ?)").bind(NOW).run()).rejects.toThrow();
    await applyD1Migrations(db, env.TEST_MIGRATIONS);
    expect(await db.prepare("SELECT reporter_id, reported_id, reason, note, title, status, created_at FROM reports WHERE id = 'r1'").first())
      .toEqual({ reporter_id: 'a', reported_id: 'b', reason: 'spam', note: 'n', title: 'T', status: 'removed', created_at: NOW });
    await db.prepare("INSERT INTO reports (id, reporter_id, reported_id, reason, title, created_at) VALUES ('r2', NULL, NULL, 'spam', '', ?)").bind(NOW).run();
    await expect(db.prepare("INSERT INTO reports (id, reporter_id, reported_id, reason, title, created_at) VALUES ('r3', NULL, NULL, 'boos', '', ?)").bind(NOW).run()).rejects.toThrow();
    const idx = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'reports' AND name LIKE 'reports_%' ORDER BY name").all<{ name: string }>();
    expect(idx.results.map((x) => x.name)).toEqual(['reports_reported', 'reports_reporter', 'reports_status']);
  });
});

describe('melding na het verwijderen van een account', () => {
  let admin: string;
  beforeAll(async () => { admin = await session(); });
  beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"id":"x"}', { status: 200 })); });
  afterEach(() => vi.restoreAllMocks());

  it('gemelde verwijderd: rij blijft, zonder id, toelichting, titel, bestandsnaam en lijst', async () => {
    const [a, b] = [await mk(`Anna ${uniq()}`), await mk(`Bram ${uniq()}`)];
    const id = await report(b, a);
    await env.DB.batch(deleteUserStmts(env.DB, a.id));
    expect(await rowOf(id)).toEqual({
      id, reporter_id: b.id, reported_id: null, reason: 'illegal', note: '', task_id: 'taak-x', list_id: null, attachment_id: 'bijlage-x',
      title: '', attachment_name: null, status: 'dismissed', created_at: NOW, handled_at: NOW,
    });
  });

  it('melder verwijderd: rij blijft, zonder id en toelichting; titel en verwijzingen blijven', async () => {
    const [a, b] = [await mk(`Anna ${uniq()}`), await mk(`Bram ${uniq()}`)];
    const id = await report(b, a);
    await env.DB.batch(deleteUserStmts(env.DB, b.id));
    expect(await rowOf(id)).toMatchObject({
      reporter_id: null, reported_id: a.id, note: '', title: `Titel van ${a.name}`, attachment_name: 'paspoort.jpg',
      task_id: 'taak-x', list_id: 'lijst-x', attachment_id: 'bijlage-x', reason: 'illegal', status: 'dismissed',
    });
  });

  it('beheerpagina: "verwijderd account", geen persoonsgegevens, geen schorsknop; schorsen geeft 410', async () => {
    const [a, b] = [await mk(`Anna ${uniq()}`), await mk(`Bram ${uniq()}`)];
    const id = await report(b, a);
    await env.DB.prepare("UPDATE reports SET status = 'open', created_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
    await env.DB.batch(deleteUserStmts(env.DB, a.id));
    const page = await raw(`/admin/reports/${id}`, { cookie: admin });
    expect(page.status).toBe(200);
    const html = await page.text();
    for (const part of [nl('admin.anonymised'), nl('admin.account_gone'), nl('admin.title_removed'), b.name, nl('report.reason_illegal')]) expect(html).toContain(part);
    for (const part of [a.name, a.email, 'paspoort.jpg', `Over ${a.name}`, '/suspend', '/unsuspend']) expect(html).not.toContain(part);
    const list = await (await raw('/admin/reports', { cookie: admin })).text();
    expect(list).toContain(`/admin/reports/${id}`);
    expect(list).toContain(nl('admin.account_deleted'));
    expect(list).not.toContain(a.name);
    for (const action of ['suspend', 'unsuspend']) {
      const res = await raw(`/admin/reports/${id}/${action}`, { method: 'POST', cookie: admin });
      expect(res.status).toBe(410);
      expect(await res.text()).toContain(nl('err.account_deleted'));
    }
    // Afhandelen kan nog.
    expect((await raw(`/admin/reports/${id}/dismiss`, { method: 'POST', cookie: admin })).status).toBe(303);
    expect((await rowOf(id)).status).toBe('dismissed');
  });

  it('melder verwijderd: zijn account toont als verwijderd, schorsen van de gemelde kan nog', async () => {
    const [a, b] = [await mk(`Anna ${uniq()}`), await mk(`Bram ${uniq()}`)];
    const id = await report(b, a);
    await env.DB.batch(deleteUserStmts(env.DB, b.id));
    const html = await (await raw(`/admin/reports/${id}`, { cookie: admin })).text();
    expect(html).toContain(nl('admin.anonymised'));
    expect(html).not.toContain(b.name);
    expect(html).toContain(`/admin/reports/${id}/suspend`);
    expect((await raw(`/admin/reports/${id}/suspend`, { method: 'POST', cookie: admin })).status).toBe(303);
    await env.DB.prepare('UPDATE users SET suspended_at = NULL WHERE id = ?').bind(a.id).run();
  });

  it('mail aan de beheerder: gemelde weg → "verwijderd account" en de link; melder weg → geen mail', async () => {
    const [a, b] = [await mk(`Anna ${uniq()}`), await mk(`Bram ${uniq()}`)];
    const id = await report(b, a);
    await env.DB.batch(deleteUserStmts(env.DB, a.id));
    await sendReportMail(e, id, BASE, 'nl');
    const sent = vi.mocked(globalThis.fetch).mock.calls.filter(([u]) => String(u).includes('resend'));
    expect(sent).toHaveLength(1);
    const body = String((sent[0][1] as RequestInit).body);
    expect(body).toContain(`/admin/reports/${id}`);
    expect(body).toContain(nl('admin.account_deleted'));
    expect(body).not.toContain(a.name);

    const [c, d] = [await mk(`Cor ${uniq()}`), await mk(`Dirk ${uniq()}`)];
    const id2 = await report(d, c);
    await env.DB.batch(deleteUserStmts(env.DB, d.id));
    vi.mocked(globalThis.fetch).mockClear();
    await sendReportMail(e, id2, BASE, 'nl');
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(([u]) => String(u).includes('resend'))).toHaveLength(0);
  });

  it('daggrens per melder telt een verwijderde melder niet mee bij een ander', async () => {
    const [a, b] = [await mk(`Cor ${uniq()}`), await mk(`Dirk ${uniq()}`)];
    for (let i = 0; i < 3; i++) await report(b, a);
    await env.DB.batch(deleteUserStmts(env.DB, b.id));
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE reporter_id IS NULL AND reported_id = ?').bind(a.id).first<{ n: number }>();
    expect(n!.n).toBe(3);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ?').bind(a.id).first<{ n: number }>())!.n).toBe(0);
  });
});
