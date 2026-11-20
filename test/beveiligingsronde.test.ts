import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE, call, callWith, createUser, json, openEnv } from './helpers';
import { crossSite, type Env } from '../src/index';
import { addEmailInvite, claimInvites, inviteByCode } from '../src/invites';
import { hashKey } from '../src/keys';
import { MAIL_KINDS, mailDailyMax, reserveMail } from '../src/mail';
import { MAX_PUSH_SUBS, validPushEndpoint } from '../src/push';
import { MAX_REPEAT_STEPS, parseIcs } from '../src/ics';
import { OFFICIAL_PACKAGE, PLAY_PACKAGE, trustedPackage } from '../public/applink.js';

// Reparaties na de beveiligingscontrole van november 2026; per onderwerp één describe.

type User = Awaited<ReturnType<typeof createUser>>;
type Member = { share_id: string; user_id: string; name: string; status: string };
type Task = { id: string; title: string; share: { members: Member[] } | null };

const uniq = () => crypto.randomUUID().slice(0, 8);
const as = (u: User, path: string, o: { method?: string; json?: unknown } = {}, e: Env = openEnv) => callWith(e, path, { ...o, cookie: u.cookie });
const newTask = async (u: User, e: Env = openEnv) =>
  (await (await as(u, '/api/tasks', { method: 'POST', json: { title: `Taak ${uniq()}`, list: 'Thuis' } }, e)).json()) as Task;

beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"id":"x"}', { status: 200 })); });
afterEach(() => vi.restoreAllMocks());

describe('schrijfverzoeken van een andere site', () => {
  it('crossSite: alleen een vreemde Origin of Sec-Fetch-Site cross-site bij een schrijfverzoek', () => {
    expect(crossSite('POST', 'https://evil.example', undefined, BASE)).toBe(true);
    expect(crossSite('POST', undefined, 'cross-site', BASE)).toBe(true);
    expect(crossSite('POST', 'null', undefined, BASE)).toBe(true);
    expect(crossSite('POST', BASE, 'same-origin', BASE)).toBe(false);
    expect(crossSite('POST', undefined, undefined, BASE)).toBe(false); // de app, Home Assistant, curl
    expect(crossSite('GET', 'https://evil.example', 'cross-site', BASE)).toBe(false);
  });

  it('POST /login vanaf een andere site (ook text/plain) geeft 403 en geen cookie', async () => {
    const res = await call('/login', {
      method: 'POST', auth: null,
      headers: { origin: 'https://evil.example', 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ email: '', password: 'test-wachtwoord', x: '=' }),
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('POST /login van de eigen site werkt gewoon', async () => {
    const res = await call('/login', { method: 'POST', auth: null, headers: { origin: BASE }, json: { email: '', password: 'test-wachtwoord' } });
    expect(res.status).toBe(200);
  });

  it('een API-wijziging met een vreemde Origin wordt geweigerd, zonder Origin niet', async () => {
    const evil = await call('/api/tasks', { method: 'POST', headers: { origin: 'https://evil.example' }, json: { title: 'x' } });
    expect(evil.status).toBe(403);
    const plain = await call('/api/tasks', { method: 'POST', json: { title: 'x' } });
    expect(plain.status).toBe(201);
  });
});

describe('openstaande uitnodiging op een openbare Tick', () => {
  async function known() {
    const [a, c] = [await createUser({ name: 'An' }), await createUser({ name: `Cor ${uniq()}` })];
    const t = await newTask(a);
    expect((await as(a, '/api/shares', { method: 'POST', json: { task_id: t.id, mode: 'shared', to: c.email } })).status).toBe(201);
    const inc = (await (await as(c, '/api/shares/incoming')).json()) as { id: string }[];
    expect((await as(c, `/api/shares/${inc[0].id}/accept`, { method: 'POST', json: {} })).status).toBe(200);
    const cName = ((await (await as(a, '/api/shares/people')).json()) as { id: string; name: string }[])[0].name;
    return { a, c, cName };
  }
  const memberName = async (a: User, id: string) =>
    ((await (await as(a, '/api/tasks')).json()) as Task[]).find((t) => t.id === id)!.share!.members[0].name;

  it('gekozen op naam: de eigenaar ziet de naam, niet het e-mailadres', async () => {
    const { a, c, cName } = await known();
    const t = await newTask(a);
    expect((await as(a, '/api/shares', { method: 'POST', json: { task_id: t.id, mode: 'shared', to_user: c.id } })).status).toBe(201);
    const name = await memberName(a, t.id);
    expect(name).toBe(cName);
    expect(name).not.toBe(c.email);
  });

  it('met een getypt adres: de eigenaar ziet dat adres (zoals altijd)', async () => {
    const { a, c } = await known();
    const t = await newTask(a);
    expect((await as(a, '/api/shares', { method: 'POST', json: { task_id: t.id, mode: 'shared', to: c.email } })).status).toBe(201);
    expect(await memberName(a, t.id)).toBe(c.email);
  });

  it('een gedeelde lijst op naam: ook daar de naam', async () => {
    const { a, c, cName } = await known();
    const list = `Lijst ${uniq()}`;
    await as(a, '/api/tasks', { method: 'POST', json: { title: 'iets', list } });
    expect((await as(a, '/api/shared-lists', { method: 'POST', json: { name: list, to_user: c.id } })).status).toBe(201);
    const lists = (await (await as(a, '/api/lists')).json()) as { name: string; shared?: { members: { name: string; status: string }[] } }[];
    const pending = lists.find((l) => l.name === list)!.shared!.members.find((m) => m.status === 'pending')!;
    expect(pending.name).toBe(cName);
  });
});

describe('uitnodiging aan een adres na een andere eigenaar', () => {
  it('geldt niet meer als de taak van een ander is geworden', async () => {
    const [a, x] = [await createUser(), await createUser()];
    const t = await newTask(a);
    const z = `z-${uniq()}@example.test`;
    const inv = await addEmailInvite(env.DB, a.id, z, { kind: 'task', taskId: t.id, mode: 'copy' });
    const code = `code${uniq()}`;
    await env.DB.prepare('UPDATE email_invites SET join_hash = ? WHERE id = ?').bind(await hashKey(code), inv.id).run();
    expect(await inviteByCode(env.DB, code)).not.toBeNull();
    // Zoals na uit een gedeelde lijst slepen: de taak is nu van x.
    await env.DB.prepare('UPDATE tasks SET user_id = ? WHERE id = ?').bind(x.id, t.id).run();
    expect(await inviteByCode(env.DB, code)).toBeNull();
    const zUser = await createUser({ email: z });
    await claimInvites(openEnv, zUser.id, { email: z });
    expect(await env.DB.prepare('SELECT 1 FROM task_shares WHERE task_id = ? AND to_user = ?').bind(t.id, zUser.id).first()).toBeNull();
  });

  it('werkt nog als de taak van de deler is', async () => {
    const a = await createUser();
    const t = await newTask(a);
    const z = `z-${uniq()}@example.test`;
    await addEmailInvite(env.DB, a.id, z, { kind: 'task', taskId: t.id, mode: 'copy' });
    const zUser = await createUser({ email: z });
    await claimInvites(openEnv, zUser.id, { email: z });
    expect(await env.DB.prepare('SELECT 1 FROM task_shares WHERE task_id = ? AND to_user = ?').bind(t.id, zUser.id).first()).not.toBeNull();
  });
});

describe('push-abonnementen', () => {
  it('validPushEndpoint: alleen https zonder inloggegevens', () => {
    expect(validPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(validPushEndpoint('http://example.test/x')).toBe(false);
    expect(validPushEndpoint('https://u:p@example.test/x')).toBe(false);
    expect(validPushEndpoint('geen url')).toBe(false);
    expect(validPushEndpoint('https://x.test/' + 'a'.repeat(1000))).toBe(false);
  });

  it('weigert een http-adres', async () => {
    const res = await call('/api/push/subscribe', { method: 'POST', json: { endpoint: 'http://example.test/push', keys: { p256dh: 'p', auth: 'a' } } });
    expect(res.status).toBe(400);
  });

  it(`houdt per persoon hoogstens ${MAX_PUSH_SUBS} abonnementen`, async () => {
    const u = await createUser();
    for (let i = 0; i < MAX_PUSH_SUBS + 5; i++) {
      const res = await as(u, '/api/push/subscribe', { method: 'POST', json: { endpoint: `https://push.example.test/${uniq()}-${i}`, keys: { p256dh: 'p', auth: 'a' } } }, env);
      expect(res.status).toBe(200);
    }
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').bind(u.id).first<{ n: number }>();
    expect(row!.n).toBe(MAX_PUSH_SUBS);
  });
});

describe('agenda: rekenbudget per feed', () => {
  it('stopt met herhalingen uitrekenen als het budget op is', () => {
    const from = Date.parse('2030-01-10T00:00:00Z');
    const to = from + 15 * 86_400_000;
    const events = Array.from({ length: 400 }, (_, i) =>
      `BEGIN:VEVENT\r\nUID:e${i}\r\nSUMMARY:E${i}\r\nDTSTART:20300101T090000Z\r\nDTEND:20300101T100000Z\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT`);
    const text = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
    const out = parseIcs(text, { from, to, zone: 'UTC', max: 1_000_000 });
    const titles = new Set(out.map((e) => e.title));
    expect(out.length).toBeLessThanOrEqual(MAX_REPEAT_STEPS);
    expect(titles.size).toBeGreaterThan(100);
    expect(titles.size).toBeLessThan(400); // de laatste reeksen vallen buiten het budget
  });

  it('een DTEND ver weg laat niet elke keer meetellen', () => {
    const from = Date.parse('2030-01-10T00:00:00Z');
    const text = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:lang\r\nSUMMARY:Lang\r\nDTSTART:20300101T090000Z\r\n' +
      'DTEND:99991231T000000Z\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    expect(parseIcs(text, { from, to: from + 15 * 86_400_000, zone: 'UTC', max: 1_000_000 }).length).toBeLessThanOrEqual(60);
  });
});

describe('mail: grens voor heel Tick', () => {
  it('mailDailyMax: standaard 90, 0 = geen grens', () => {
    expect(mailDailyMax({})).toBe(90);
    expect(mailDailyMax({ MAIL_DAILY_MAX: '0' })).toBe(0);
    expect(mailDailyMax({ MAIL_DAILY_MAX: '250' })).toBe(250);
    expect(mailDailyMax({ MAIL_DAILY_MAX: 'veel' })).toBe(90);
  });

  it('weigert een mail als het aantal van de laatste 24 uur op de grens zit', async () => {
    const now = Date.now();
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM mail_log WHERE kind IN (SELECT value FROM json_each(?)) AND sent_at > ?')
      .bind(JSON.stringify(MAIL_KINDS), new Date(now - 86_400_000).toISOString()).first<{ n: number }>();
    const e = { ...env, MAIL_DAILY_MAX: String(row!.n + 1) } as Env;
    const [u1, u2] = [await createUser(), await createUser()];
    expect(typeof await reserveMail(env.DB, e, 'reset', u1.id, now)).toBe('object');
    expect(await reserveMail(env.DB, e, 'reset', u2.id, now)).toBe('account_limit');
    // Zonder grens gaat hij wel.
    expect(typeof await reserveMail(env.DB, { ...e, MAIL_DAILY_MAX: '0' } as Env, 'reset', u2.id, now)).toBe('object');
  });
});

describe('adres zoeken: grens per persoon', () => {
  it('geeft 429 als de persoon zijn eigen deel op heeft, zonder Nominatim te vragen', async () => {
    const u = await createUser();
    const e = { ...env, GEOCODE_USER_LIMITER: { limit: async () => ({ success: false }) } } as unknown as Env;
    const res = await callWith(e, '/api/geocode?q=Utrecht', { cookie: u.cookie });
    expect(res.status).toBe(429);
    expect((await json<{ key: string }>(res)).key).toBe('err.geocode_busy');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('telt per persoon met een eigen sleutel', async () => {
    const u = await createUser();
    const keys: string[] = [];
    const e = { ...env, GEOCODE_USER_LIMITER: { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: true }; } } } as unknown as Env;
    await callWith(e, '/api/geocode?q=Utrecht', { cookie: u.cookie });
    expect(keys).toEqual([`geocode:${u.id}`]);
  });
});

describe('koppelcode alleen naar een bekende app', () => {
  it('trustedPackage', () => {
    expect(trustedPackage(OFFICIAL_PACKAGE, '')).toBe(true);
    expect(trustedPackage(PLAY_PACKAGE, undefined)).toBe(true);
    expect(trustedPackage('com.example.eigen', 'com.example.eigen')).toBe(true);
    expect(trustedPackage('com.evil.app', 'com.example.eigen')).toBe(false);
    expect(trustedPackage('com.evil.app', '')).toBe(false);
    expect(trustedPackage(null, '')).toBe(false);
  });
});
