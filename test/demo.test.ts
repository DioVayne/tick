import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callWith, createUser, json, openEnv, randomIp, session, untilRateLimited } from './helpers';
import type { Env } from '../src/index';
import { STRINGS, translate } from '../public/i18n.js';
import { DEMO_HARD_HOURS, DEMO_SHARED, DEMO_TASKS, demoMayDo, purgeDemos, slideUntil } from '../src/demo';
import { WELCOME_TEMPLATE } from '../src/welcome';

const demoEnv: Env = { ...env, DEMO: 'true' };
const openDemoEnv: Env = { ...openEnv, DEMO: 'true' };
const html = 'text/html';
const blocked = { error: translate('en', 'err.demo_blocked'), key: 'err.demo_blocked', vars: {} };

/** Start een demo en geeft de cookie en het account. */
async function startDemo(e: Env = demoEnv, lang = 'en') {
  const res = await callWith(e, '/demo', { method: 'POST', json: { timeZone: 'Europe/Amsterdam' }, lang });
  expect(res.status, await res.clone().text()).toBe(201);
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  const id = cookie.split('=')[1].split('.')[1];
  return { cookie, id };
}

const user = (id: string) => env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<Record<string, string | null>>();
const samOf = async (id: string) => (await env.DB.prepare('SELECT id FROM users WHERE demo_of = ?').bind(id).first<{ id: string }>())?.id;
const taskCount = async (id: string) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM tasks WHERE user_id = ?').bind(id).first<{ n: number }>())!.n;

beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"id":"x"}', { status: 200 })); });
afterEach(() => vi.restoreAllMocks());

describe('demo uit (standaard)', () => {
  it('/demo en /api/demo bestaan niet', async () => {
    expect((await callWith(env, '/demo', { accept: html })).status).toBe(404);
    expect((await callWith(env, '/demo', { method: 'POST', json: {} })).status).toBe(404);
    expect((await callWith(env, '/api/demo/admin', { cookie: await session() })).status).toBe(404);
  });

  it('de beheerder kan hem uitzetten: dan ook 404', async () => {
    const admin = await session();
    const off = await callWith(demoEnv, '/api/demo/admin', { method: 'PATCH', json: { on: false }, cookie: admin });
    expect(await json(off)).toEqual({ on: false, minutes: 60 });
    expect((await callWith(demoEnv, '/demo', { method: 'POST', json: {} })).status).toBe(404);
    await callWith(demoEnv, '/api/demo/admin', { method: 'PATCH', json: { on: true }, cookie: admin });
    expect((await callWith(demoEnv, '/demo', { accept: html })).status).toBe(200);
  });
});

describe('demo starten', () => {
  it('de startpagina laadt het script, ook zonder inlog', async () => {
    const page = await (await callWith(demoEnv, '/demo', { accept: html, lang: 'nl' })).text();
    expect(page).toContain('src="/demo.js"');
    expect(page).toContain(translate('nl', 'demo.starting'));
    expect((await callWith(demoEnv, '/demo.js')).status).toBe(200);
  });

  it('ingelogd: /demo gaat naar de app', async () => {
    const res = await callWith(demoEnv, '/demo', { accept: html, cookie: (await createUser()).cookie });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });

  it('maakt een tijdelijk account met de welkomsttaak, voorbeeldtaken en de gedeelde lijst van Sam', async () => {
    const before = Date.now();
    const { cookie, id } = await startDemo(demoEnv, 'nl');
    const u = (await user(id))!;
    expect(u).toMatchObject({ email: null, password_hash: null, role: 'member', demo_of: null });
    expect(Date.parse(u.demo_until!) - before).toBeGreaterThan(59 * 60_000);
    expect(Date.parse(u.demo_until!) - before).toBeLessThan(61 * 60_000);
    const sam = (await user((await samOf(id))!))!;
    expect(sam.name).toBe('Sam');

    const tasks = await json<{ title: string; list: string; done: boolean; pinned: boolean; repeat: unknown; subtasks?: unknown[] }[]>(
      await callWith(demoEnv, '/api/tasks?all=1', { cookie }));
    const titles = tasks.map((t) => t.title);
    expect(titles).toContain(translate('nl', WELCOME_TEMPLATE.title));
    for (const s of DEMO_TASKS.filter((x) => !x.done)) expect(titles).toContain(translate('nl', s.title));
    expect(tasks.find((t) => t.title === translate('nl', 'demo.t_bins'))!.repeat).toBeTruthy();
    expect(tasks.find((t) => t.title === translate('nl', 'demo.t_passport'))!.pinned).toBe(true);
    // De lijst van Sam staat erbij, met zijn taken.
    const trip = tasks.filter((t) => t.list === translate('nl', 'demo.l_trip'));
    expect(trip.length).toBeGreaterThanOrEqual(DEMO_SHARED.filter((x) => !x.done).length);
    const lists = await json<{ name: string }[]>(await callWith(demoEnv, '/api/lists', { cookie }));
    expect(lists.map((l) => l.name)).toEqual(expect.arrayContaining([translate('nl', 'demo.l_trip'), translate('nl', 'demo.l_work'), translate('nl', 'demo.l_groceries')]));
    // Geen aanmelding geteld.
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE kind = 'signup' AND sent_at >= ?").bind(new Date(before).toISOString()).first()).toEqual({ n: 0 });
  });

  it('elke voorbeeldtekst bestaat in en en nl', () => {
    const keys = [...DEMO_TASKS, ...DEMO_SHARED].flatMap((s) => [s.title, s.list, s.note, ...(s.subs ?? [])]).filter(Boolean) as string[];
    for (const k of [...keys, 'demo.l_trip', 'demo.name', 'demo.sam']) {
      expect(STRINGS.en[k as keyof typeof STRINGS.en], k).toBeTruthy();
      expect(STRINGS.nl[k as keyof typeof STRINGS.nl], k).toBeTruthy();
    }
  });

  it('rate limit per IP', async () => {
    const ip = randomIp();
    await untilRateLimited(() => callWith(demoEnv, '/demo', { method: 'POST', json: {}, ip }));
  });

  it('hooguit DEMO_MAX tegelijk', async () => {
    const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE demo_until > ? AND demo_of IS NULL').bind(new Date().toISOString()).first<{ n: number }>())!.n;
    const e = { ...demoEnv, DEMO_MAX: String(n + 1) };
    await startDemo(e);
    const res = await callWith(e, '/demo', { method: 'POST', json: {} });
    expect(res.status).toBe(503);
    expect((await json<{ key: string }>(res)).key).toBe('err.demo_full');
  });

  it('niet op de accountpagina en niet te vinden om mee te delen', async () => {
    const { id } = await startDemo();
    const admin = await session();
    const users = await json<{ id: string }[]>(await callWith(demoEnv, '/api/users', { cookie: admin }));
    expect(users.some((u) => u.id === id)).toBe(false);
    const people = await json<{ id: string }[]>(await callWith(demoEnv, '/api/shares/people', { cookie: (await createUser()).cookie }));
    expect(people.some((u) => u.id === id)).toBe(false);
  });
});

describe('grenzen van een demo', () => {
  it('taken en lijsten werken', async () => {
    const { cookie } = await startDemo();
    const res = await callWith(demoEnv, '/api/tasks', { method: 'POST', json: { title: 'Zelf gemaakt' }, cookie });
    expect(res.status).toBe(201);
    const t = await json<{ id: string }>(res);
    expect((await callWith(demoEnv, `/api/tasks/${t.id}`, { method: 'PATCH', json: { done: true }, cookie })).status).toBe(200);
    expect((await callWith(demoEnv, '/api/settings', { method: 'PATCH', json: { weekStart: 'sun' }, cookie })).status).toBe(200);
  });

  it('delen, mail, push, sleutels, koppelen, bijlagen, verhuizen, agenda en webhook zijn dicht', async () => {
    const { cookie } = await startDemo();
    const t = await json<{ id: string }>(await callWith(demoEnv, '/api/tasks', { method: 'POST', json: { title: 'x' }, cookie }));
    const tries: [string, string, unknown][] = [
      ['POST', '/api/shares', { task_id: t.id, to: 'iemand@example.test' }],
      ['POST', '/api/shared-lists', { name: 'Inbox', to: 'iemand@example.test' }],
      ['POST', '/api/push/subscribe', { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } }],
      ['POST', '/api/push/test', {}],
      ['POST', '/api/keys', { name: 'x' }],
      ['POST', '/api/pair', {}],
      ['POST', '/api/device', {}],
      ['POST', `/api/tasks/${t.id}/attachments`, {}],
      ['POST', '/api/move/code', {}],
      ['POST', '/api/import/backup', {}],
      ['POST', '/api/calendar/feeds', { url: 'https://example.test/a.ics' }],
      ['PATCH', '/api/account', { email: 'iemand@example.test' }],
      ['POST', '/api/account/verify', {}],
      ['POST', '/api/settings/webhook-test', {}],
      ['PATCH', '/api/settings', { fallbackWebhook: 'https://example.test/hook' }],
      ['POST', '/api/reports', {}],
      ['PUT', '/api/background', {}],
      ['GET', '/api/geocode?q=Utrecht', undefined],
      ['POST', '/mcp', {}],
    ];
    for (const [method, path, body] of tries) {
      const res = await callWith(demoEnv, path, { method, json: body, cookie });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(await json(res), `${method} ${path}`).toEqual(blocked);
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('demoMayDo: lezen wel, schrijven alleen aan taken en lijsten', () => {
    expect(demoMayDo('GET', '/api/tasks')).toBe(true);
    expect(demoMayDo('DELETE', '/api/tasks/abc')).toBe(true);
    expect(demoMayDo('POST', '/api/lists/rename')).toBe(true);
    expect(demoMayDo('POST', '/api/shared-lists/abc/accept')).toBe(true);
    expect(demoMayDo('POST', '/api/shared-lists/abc/members')).toBe(false);
    expect(demoMayDo('DELETE', '/api/attachments/abc')).toBe(false);
    expect(demoMayDo('POST', '/api/somethingnew')).toBe(false);
    expect(demoMayDo('PATCH', '/api/settings', null)).toBe(false);
  });

  it('gebruik verlengt de demo, tot hooguit het harde einde', () => {
    const created = '2026-01-01T10:00:00.000Z';
    expect(slideUntil(created, 60, Date.parse('2026-01-01T10:30:00Z'))).toBe('2026-01-01T11:30:00.000Z');
    expect(slideUntil(created, 60, Date.parse('2026-01-01T12:45:00Z'))).toBe(new Date(Date.parse(created) + DEMO_HARD_HOURS * 3_600_000).toISOString());
  });

  it('een verzoek schuift demo_until op', async () => {
    const { cookie, id } = await startDemo();
    await env.DB.prepare('UPDATE users SET demo_until = ? WHERE id = ?').bind(new Date(Date.now() + 10 * 60_000).toISOString(), id).run();
    expect((await callWith(demoEnv, '/api/tasks', { cookie })).status).toBe(200);
    expect(Date.parse((await user(id))!.demo_until!) - Date.now()).toBeGreaterThan(55 * 60_000);
  });

  it('verlopen = uitgelogd', async () => {
    const { cookie, id } = await startDemo();
    await env.DB.prepare('UPDATE users SET demo_until = ? WHERE id = ?').bind(new Date(Date.now() - 1000).toISOString(), id).run();
    expect((await callWith(demoEnv, '/api/tasks', { cookie })).status).toBe(401);
  });
});

describe('opruimen', () => {
  it('verlopen demo weg, met Sam, taken en de gedeelde lijst; een lopende blijft', async () => {
    const old = await startDemo();
    const live = await startDemo();
    const oldSam = (await samOf(old.id))!;
    await env.DB.prepare('UPDATE users SET demo_until = ? WHERE id = ?').bind(new Date(Date.now() - 1000).toISOString(), old.id).run();
    expect(await taskCount(old.id)).toBeGreaterThan(0);
    await purgeDemos(demoEnv, Date.now());
    expect(await user(old.id)).toBeNull();
    expect(await user(oldSam)).toBeNull();
    expect(await taskCount(old.id)).toBe(0);
    expect(await taskCount(oldSam)).toBe(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM shared_lists WHERE owner_id IN (?, ?)').bind(old.id, oldSam).first()).toEqual({ n: 0 });
    expect(await user(live.id)).not.toBeNull();
    expect(await user((await samOf(live.id))!)).not.toBeNull();
  });

  it('een gewoon account blijft altijd staan', async () => {
    const u = await createUser();
    await purgeDemos(demoEnv, Date.now() + 365 * 86_400_000);
    expect(await user(u.id)).not.toBeNull();
  });
});

describe('demo omzetten naar een account', () => {
  it('alleen op een openbare Tick', async () => {
    const { cookie } = await startDemo();
    expect((await callWith(demoEnv, '/api/demo', { cookie }).then((r) => json<{ canKeep: boolean }>(r))).canKeep).toBe(false);
    const res = await callWith(demoEnv, '/api/demo/keep', { method: 'POST', json: { name: 'A', email: 'a@example.test', password: 'lang-genoeg-1' }, cookie });
    expect(res.status).toBe(404);
  });

  it('taken blijven, Sam verdwijnt en zijn lijst wordt van jou', async () => {
    const { cookie, id } = await startDemo(openDemoEnv);
    const sam = (await samOf(id))!;
    const before = await taskCount(id);
    const email = `demo-${crypto.randomUUID()}@example.test`;
    const res = await callWith(openDemoEnv, '/api/demo/keep', { method: 'POST', json: { name: 'Nieuw', email, password: 'lang-genoeg-1' }, cookie });
    expect(res.status, await res.clone().text()).toBe(200);
    const fresh = res.headers.get('set-cookie')!.split(';')[0];
    const u = (await user(id))!;
    expect(u).toMatchObject({ name: 'Nieuw', email, demo_until: null, email_verified_at: null });
    expect(await user(sam)).toBeNull();
    expect(await taskCount(id)).toBeGreaterThanOrEqual(before);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM shared_lists WHERE owner_id = ?').bind(id).first()).toEqual({ n: 1 });
    // De oude demo-cookie werkt niet meer, de nieuwe wel; opruimen laat het account staan.
    expect((await callWith(openDemoEnv, '/api/tasks', { cookie })).status).toBe(401);
    expect((await callWith(openDemoEnv, '/api/tasks', { cookie: fresh })).status).toBe(200);
    await purgeDemos(openDemoEnv, Date.now() + 365 * 86_400_000);
    expect(await user(id)).not.toBeNull();
  });

  it('een bestaand adres geeft 409 en de demo blijft een demo', async () => {
    const other = await createUser();
    const { cookie, id } = await startDemo(openDemoEnv);
    const res = await callWith(openDemoEnv, '/api/demo/keep', { method: 'POST', json: { name: 'X', email: other.email, password: 'lang-genoeg-1' }, cookie });
    expect(res.status).toBe(409);
    expect((await user(id))!.demo_until).not.toBeNull();
  });
});

describe('beheerder', () => {
  it('duur kiezen en het aantal lopende demo\'s zien; een lid niet', async () => {
    const admin = await session();
    expect((await callWith(demoEnv, '/api/demo/admin', { method: 'PATCH', json: { minutes: 45 }, cookie: admin })).status).toBe(400);
    expect(await json(await callWith(demoEnv, '/api/demo/admin', { method: 'PATCH', json: { minutes: 30 }, cookie: admin }))).toEqual({ on: true, minutes: 30 });
    const before = Date.now();
    const { id } = await startDemo();
    expect(Date.parse((await user(id))!.demo_until!) - before).toBeLessThan(31 * 60_000);
    const s = await json<{ active: number; choices: number[] }>(await callWith(demoEnv, '/api/demo/admin', { cookie: admin }));
    expect(s.active).toBeGreaterThanOrEqual(1);
    expect(s.choices).toEqual([30, 60, 120]);
    expect((await callWith(demoEnv, '/api/demo/admin', { cookie: (await createUser()).cookie })).status).toBe(403);
    await callWith(demoEnv, '/api/demo/admin', { method: 'PATCH', json: { minutes: 60 }, cookie: admin });
  });

  it('config.js: demo voor de demo, demoAdmin voor de beheerder', async () => {
    const { cookie } = await startDemo();
    expect(await (await callWith(demoEnv, '/config.js', { cookie })).text()).toContain('"demo":true');
    expect(await (await callWith(demoEnv, '/config.js', { cookie: await session() })).text()).toContain('"demoAdmin":true');
    expect(await (await callWith(env, '/config.js', { cookie: await session() })).text()).toContain('"demoAdmin":false');
  });
});
