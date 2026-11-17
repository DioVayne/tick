import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { BASE, callWith, openEnv, randomIp } from './helpers';
import type { Env } from '../src/index';
import { cronSteps } from '../src/index';
import { buildQueued, deliverQueued, enqueueMail, mailBacklog } from '../src/mailqueue';
import { installPrefsFrom } from '../src/prefs';
import { deleteAccount } from '../src/users-api';
import { hashKey } from '../src/keys';

const MIN = 60_000;
const e: Env = openEnv;

type Sent = { to: string[]; subject: string; text: string };
/** Nagebootste Resend: elke aanroep neemt de volgende status uit `statuses` (de laatste blijft gelden). */
let statuses: number[] = [200];
let sent: Sent[] = [];
let fetchSpy: MockInstance<typeof fetch>;
let logSpy: MockInstance<typeof console.error>;
beforeEach(async () => {
  statuses = [200];
  sent = [];
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url) !== 'https://api.resend.com/emails') return new Response('{}', { status: 200 });
    const status = statuses.length > 1 ? statuses.shift()! : statuses[0];
    if (status === 200) sent.push(JSON.parse(String((init as RequestInit).body)) as Sent);
    return new Response('{"id":"x"}', { status });
  });
  logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  await env.DB.prepare('DELETE FROM mail_queue').run();
});
afterEach(() => vi.restoreAllMocks());

const resendCalls = () => fetchSpy.mock.calls.filter(([url]) => String(url) === 'https://api.resend.com/emails').length;
const rows = () => env.DB.prepare('SELECT * FROM mail_queue ORDER BY created_at, id')
  .all<{ id: string; kind: string; attempts: number; created_at: string; next_try_at: string; last_status: string | null }>().then((r) => r.results);

/** Een lid direct in `users` (zonder inloggen, dus snel). */
async function member(o: { verified?: boolean; email?: string } = {}): Promise<{ id: string; email: string }> {
  const id = crypto.randomUUID();
  const email = o.email ?? `w-${id}@example.test`;
  const ts = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users (id, name, email, password_hash, role, created_at, email_verified_at) VALUES (?, 'Lid', ?, 'x', 'member', ?, ?)")
    .bind(id, email, ts, o.verified === false ? null : ts).run();
  return { id, email };
}

describe('mailwachtrij', () => {
  it('gewone aanmelding: de bevestigingsmail gaat direct weg en de rij is weg', async () => {
    const email = `nieuw-${crypto.randomUUID()}@example.test`;
    const res = await callWith(e, '/signup', { method: 'POST', json: { name: 'A', email, password: 'lang-genoeg-1' }, ip: randomIp() });
    expect(res.status).toBe(201);
    expect(sent.map((m) => m.to[0])).toEqual([email]);
    expect(await rows()).toEqual([]);
  });

  it('429: de rij blijft (1 poging, 5 minuten later); daarna verstuurt de cron hem en werkt de link', async () => {
    statuses = [429, 200];
    const email = `wacht-${crypto.randomUUID()}@example.test`;
    expect((await callWith(e, '/signup', { method: 'POST', json: { name: 'A', email, password: 'lang-genoeg-1' }, ip: randomIp() })).status).toBe(201);
    const [row] = await rows();
    expect(row).toMatchObject({ kind: 'verify', attempts: 1, last_status: '429' });
    expect(Date.parse(row.next_try_at) - Date.parse(row.created_at)).toBe(5 * MIN);
    expect(await mailBacklog(env.DB)).toBe(true);
    // Vóór de wachttijd om is: niets.
    expect(await deliverQueued(e, Date.parse(row.next_try_at) - 1)).toEqual({ sent: 0, waiting: 1 });
    expect(await deliverQueued(e, Date.parse(row.next_try_at))).toEqual({ sent: 1, waiting: 0 });
    expect(await rows()).toEqual([]);
    expect(await mailBacklog(env.DB)).toBe(false);
    expect(sent).toHaveLength(1);
    const path = /https:\/\/tick\.test(\/verify\/[A-Za-z0-9_-]+)/.exec(sent[0].text)?.[1];
    expect(path).toBeTruthy();
    expect((await callWith(e, path!, { accept: 'text/html' })).status).toBe(200);
    const u = await env.DB.prepare('SELECT email_verified_at FROM users WHERE email = ?').bind(email).first<{ email_verified_at: string | null }>();
    expect(u!.email_verified_at).not.toBeNull();
  });

  it('een herstelmail die 3 uur wachtte krijgt bij versturen een verse link (nog 1 uur geldig)', async () => {
    const u = await member();
    await enqueueMail(e, { kind: 'reset', userId: u.id, ref: null, lang: 'nl', origin: BASE }, Date.now() - 3 * 60 * MIN);
    const before = Date.now();
    expect(await deliverQueued(e)).toEqual({ sent: 1, waiting: 0 });
    expect(sent.map((m) => m.to[0])).toEqual([u.email]);
    const code = /\/reset\/([A-Za-z0-9_-]+)/.exec(sent[0].text)![1];
    const link = await env.DB.prepare('SELECT expires_at FROM account_links WHERE hash = ?').bind(await hashKey(code)).first<{ expires_at: string }>();
    expect(Date.parse(link!.expires_at)).toBeGreaterThanOrEqual(before + 60 * MIN);
    expect(Date.parse(link!.expires_at)).toBeLessThanOrEqual(Date.now() + 60 * MIN);
    vi.mocked(globalThis.fetch).mockRestore();
    expect((await callWith(e, `/reset/${code}`, { method: 'POST', json: { password: 'nieuw-wachtwoord-1' } })).status).toBe(200);
  });

  it('Review 1: twee runs tegelijk op één rij versturen hem precies één keer', async () => {
    const u = await member({ verified: false });
    const id = await enqueueMail(e, { kind: 'verify', userId: u.id, ref: null, lang: 'en', origin: BASE });
    const now = Date.now();
    await Promise.all([deliverQueued(e, now), deliverQueued(e, now)]);
    expect(resendCalls()).toBe(1);
    // Ook de directe poging en de cron samen.
    const v = await member({ verified: false });
    const id2 = await enqueueMail(e, { kind: 'verify', userId: v.id, ref: null, lang: 'en', origin: BASE });
    await Promise.all([deliverQueued(e, Date.now(), { id: id2 }), deliverQueued(e, Date.now())]);
    expect(resendCalls()).toBe(2);
    expect(id).not.toBe(id2);
    expect(await rows()).toEqual([]);
  });

  it('Review 2: account weg → geen mail en de rij is weg; adres gewijzigd → mail naar het nieuwe adres', async () => {
    const gone = await member({ verified: false });
    await enqueueMail(e, { kind: 'verify', userId: gone.id, ref: null, lang: 'en', origin: BASE });
    await deleteAccount(e, gone.id);
    expect(await deliverQueued(e)).toEqual({ sent: 0, waiting: 0 });
    expect(resendCalls()).toBe(0);
    expect(await rows()).toEqual([]);

    const moved = await member();
    await enqueueMail(e, { kind: 'reset', userId: moved.id, ref: null, lang: 'en', origin: BASE });
    const fresh = `nieuw-${crypto.randomUUID()}@example.test`;
    await env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind(fresh, moved.id).run();
    await deliverQueued(e);
    expect(sent.map((m) => m.to[0])).toEqual([fresh]);
  });

  it('een bevestigingsmail voor een adres dat intussen bevestigd is, vervalt', async () => {
    const u = await member({ verified: false });
    await enqueueMail(e, { kind: 'verify', userId: u.id, ref: null, lang: 'en', origin: BASE });
    await env.DB.prepare('UPDATE users SET email_verified_at = ? WHERE id = ?').bind(new Date().toISOString(), u.id).run();
    await deliverQueued(e);
    expect(resendCalls()).toBe(0);
    expect(await rows()).toEqual([]);
  });

  it('Review 3: de wachttijd groeit 5, 10, 20, 40 en blijft dan op 60 minuten', async () => {
    statuses = [429];
    const u = await member();
    await enqueueMail(e, { kind: 'reset', userId: u.id, ref: null, lang: 'en', origin: BASE });
    const waits: number[] = [];
    let at = Date.now();
    for (let i = 0; i < 7; i++) {
      await deliverQueued(e, at);
      const [row] = await rows();
      waits.push((Date.parse(row.next_try_at) - at) / MIN);
      at = Date.parse(row.next_try_at);
    }
    expect(waits).toEqual([5, 10, 20, 40, 60, 60, 60]);
    expect((await rows())[0].attempts).toBe(7);
  });

  it('Review 4: 60 rijen klaar → één run verstuurt de oudste 50', async () => {
    const now = Date.now();
    const users: string[] = [];
    for (let i = 0; i < 60; i++) {
      const u = await member();
      users.push(u.email);
      await enqueueMail(e, { kind: 'reset', userId: u.id, ref: null, lang: 'en', origin: BASE }, now - (60 - i) * MIN);
    }
    expect(await deliverQueued(e, now)).toEqual({ sent: 50, waiting: 10 });
    expect(sent.map((m) => m.to[0])).toEqual(users.slice(0, 50));
    expect(await rows()).toHaveLength(10);
  });

  it('422: de rij gaat weg zonder nieuwe poging, en de log noemt geen adres', async () => {
    statuses = [422];
    const u = await member();
    await enqueueMail(e, { kind: 'reset', userId: u.id, ref: null, lang: 'en', origin: BASE });
    expect(await deliverQueued(e)).toEqual({ sent: 0, waiting: 0 });
    expect(await rows()).toEqual([]);
    await deliverQueued(e, Date.now() + 120 * MIN);
    expect(resendCalls()).toBe(1);
    expect(logSpy).toHaveBeenCalledWith('mail: reset definitief niet bezorgd (422)');
    for (const args of logSpy.mock.calls) expect(args.join(' ')).not.toContain(u.email);
  });

  it('uitnodiging of melding die weg is: geen mail, rij weg', async () => {
    const u = await member();
    await enqueueMail(e, { kind: 'invite', userId: u.id, ref: 'bestaat-niet', lang: 'en', origin: BASE });
    await enqueueMail(e, { kind: 'report', userId: u.id, ref: 'bestaat-niet', lang: 'en', origin: BASE });
    await deliverQueued(e);
    expect(resendCalls()).toBe(0);
    expect(await rows()).toEqual([]);
  });

  it('melding: één mail per beheerdersadres', async () => {
    const a = await member(); const b = await member();
    const reportId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO reports (id, reporter_id, reported_id, reason, note, title, created_at) VALUES (?, ?, ?, 'spam', '', 'T', ?)")
      .bind(reportId, a.id, b.id, new Date().toISOString()).run();
    const id = await enqueueMail(e, { kind: 'report', userId: a.id, ref: reportId, lang: 'nl', origin: BASE });
    const row = await env.DB.prepare('SELECT * FROM mail_queue WHERE id = ?').bind(id).first();
    // Twee beheerders met een adres.
    const admins = [await member(), await member()];
    for (const x of admins) await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(x.id).run();
    try {
      const mails = await buildQueued(e, row as never);
      expect(mails!.map((m) => m.to).sort()).toEqual(admins.map((x) => x.email).sort());
      expect(mails![0].text).toContain(`${BASE}/admin/reports/${reportId}`);
      // Eén rij, beide adressen.
      await deliverQueued(e);
      expect(sent.map((m) => m.to[0]).sort()).toEqual(admins.map((x) => x.email).sort());
      expect(await rows()).toEqual([]);
    } finally {
      for (const x of admins) await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(x.id).run();
    }
  });

  it('mail uit: de wachtrij doet niets; de cron draait de stap alleen met mail', async () => {
    const u = await member();
    await enqueueMail(e, { kind: 'reset', userId: u.id, ref: null, lang: 'en', origin: BASE });
    const off: Env = { ...e, RESEND_API_KEY: '' };
    expect(await deliverQueued(off)).toMatchObject({ sent: 0 });
    expect(await rows()).toHaveLength(1);
    const names = (x: Env) => cronSteps(x, installPrefsFrom(x), Date.parse('2031-01-01T10:03:00Z')).map(([n]) => n);
    expect(names(e)).toContain('mailwachtrij');
    expect(names(off)).not.toContain('mailwachtrij');
  });
});
