import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_ID, BASE, call, createTask as create, json, session } from './helpers';
import { getTimeZone, setTimeZone, zonedParts } from '../public/repeat.js';
import { shiftWallClock } from '../src/time';
import worker, { type Env } from '../src/index';
import { loadInstallPrefs, loadUserPrefs } from '../src/prefs';
import { runReminders } from '../src/push';

const made: string[] = [];
const createTask: typeof create = async (b) => {
  const t = await create(b);
  made.push(t.id);
  return t;
};

afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM user_settings WHERE user_id = ?').bind(ADMIN_ID),
    env.DB.prepare("DELETE FROM settings WHERE key = 'default_locale'"),
  ]);
  for (const id of made.splice(0)) await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
});

const patch = async (body: unknown) => {
  const cookie = await session();
  return call('/api/settings', { method: 'PATCH', auth: null, headers: { cookie }, json: body });
};

/** De wandklok van een ISO-moment in een zone. */
function wall(iso: string, tz: string) {
  const prev = getTimeZone();
  setTimeZone(tz);
  try {
    return zonedParts(Date.parse(iso));
  } finally {
    setTimeZone(prev);
  }
}

const row = (id: string) =>
  env.DB.prepare('SELECT remind_at, repeat_start, repeat_at, repeat_prev, done FROM tasks WHERE id = ?').bind(id)
    .first<{ remind_at: string | null; repeat_start: string | null; repeat_at: string | null; repeat_prev: string | null; done: number }>();

describe('instellingen-API', () => {
  it('vereist een sessie: een Bearer-sleutel krijgt 403', async () => {
    expect((await call('/api/settings')).status).toBe(403);
    expect((await call('/api/settings', { method: 'PATCH', json: {} })).status).toBe(403);
    expect((await call('/api/settings/webhook-test', { method: 'POST' })).status).toBe(403);
  });

  it('PATCH bewaart en GET geeft terug', async () => {
    const cookie = await session();
    const res = await call('/api/settings', { method: 'PATCH', auth: null, headers: { cookie }, json: { reminderTime: '08:15', weekStart: 'sun' } });
    expect(await json(res)).toMatchObject({ reminderTime: '08:15', weekStart: 'sun', timeZone: 'Europe/Amsterdam' });
    const get = await call('/api/settings', { auth: null, headers: { cookie } });
    expect(await json(get)).toMatchObject({ reminderTime: '08:15', weekStart: 'sun', defaultLocale: 'en', fallbackWebhook: null, fallbackFromEnv: false });
  });

  it.each([
    [{ timeZone: 'Mars/Olympus' }], [{ reminderTime: '25:00' }], [{ weekStart: 'tue' }], [{ defaultLocale: 'de' }],
    [{ fallbackWebhook: 'http://x' }], [{ fallbackWebhook: `https://x.nl/${'a'.repeat(2000)}` }],
  ])('weigert %o met 400', async (body) => {
    expect((await patch(body)).status).toBe(400);
  });

  it('webhook: een BOM en witruimte aan begin en eind gaan eraf vóór het opslaan', async () => {
    const bom = String.fromCharCode(0xfeff);
    const res = await json(await patch({ fallbackWebhook: `${bom}  https://example.invalid/hook \r\n` }));
    expect(res.fallbackWebhook).toBe('https://example.invalid/hook');
    const row = await env.DB.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'fallback_webhook'").bind(ADMIN_ID).first<{ value: string }>();
    expect(row?.value).toBe('https://example.invalid/hook');
    expect((await patch({ fallbackWebhook: `${bom} ` })).status).toBe(200); // alleen een BOM telt als leeg: uit
  });

  it('webhook: wissen, uitzetten en testen zonder webhook', async () => {
    expect((await json(await patch({ fallbackWebhook: 'https://example.invalid/hook' }))).fallbackWebhook).toBe('https://example.invalid/hook');
    expect(await json(await patch({ fallbackWebhook: '' }))).toMatchObject({ fallbackWebhook: null });
    expect(await json(await patch({ fallbackWebhook: null }))).toMatchObject({ fallbackWebhook: null, fallbackFromEnv: false });
    const cookie = await session();
    const res = await call('/api/settings/webhook-test', { method: 'POST', auth: null, headers: { cookie } });
    expect(res.status).toBe(400);
  });

  it('tijdzonewissel houdt de kloktijd vast', async () => {
    const open = await createTask({ title: 'open', remind_at: '2030-01-07T09:00:00Z' }); // 10:00 CET
    const weekly = await createTask({ title: 'weekly', remind_at: '2030-01-08T22:30:00Z', repeat: 'FREQ=WEEKLY;BYDAY=TU' }); // di 23:30 CET
    const done = await createTask({ title: 'klaar', remind_at: '2030-01-07T09:00:00Z' });
    await env.DB.prepare('UPDATE tasks SET done = 1 WHERE id = ?').bind(done.id).run();
    const plain = await createTask({ title: 'zonder' });

    const before = {
      open: await row(open.id), weekly: await row(weekly.id), done: await row(done.id), plain: await row(plain.id),
    };
    const res = await patch({ timeZone: 'Europe/London' });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ timeZone: 'Europe/London' });

    const o = (await row(open.id))!;
    expect(o.remind_at).toBe('2030-01-07T10:00:00.000Z');
    expect(wall(o.remind_at!, 'Europe/London')).toMatchObject({ h: 10, mi: 0 });

    const w = (await row(weekly.id))!;
    for (const [after, was] of [[w.remind_at, before.weekly!.remind_at], [w.repeat_start, before.weekly!.repeat_start], [w.repeat_at, before.weekly!.repeat_at]] as const) {
      const a = wall(after!, 'Europe/London');
      const b = wall(was!, 'Europe/Amsterdam');
      expect(a).toEqual(b);
      expect(a).toMatchObject({ h: 23, mi: 30, wd: 1 });
    }
    expect(w.repeat_prev).toBeNull();

    expect(await row(done.id)).toEqual(before.done);
    expect(await row(plain.id)).toEqual(before.plain);
    expect((await row(plain.id))!.remind_at).toBeNull();

    // Latere requests gebruiken de nieuwe zone.
    const cookie = await session();
    expect(await json(await call('/api/settings', { auth: null, headers: { cookie } }))).toMatchObject({ timeZone: 'Europe/London' });
  });

  it('shiftWallClock: een wandklok die in de nieuwe zone niet bestaat geeft een geldig moment', () => {
    // 2030-03-31 01:30 in Amsterdam bestaat wel (gat is 02:00-03:00 CET); in London is 01:30 het gat (01:00-02:00 GMT).
    const zone = getTimeZone();
    const iso = shiftWallClock('2030-03-31T00:30:00.000Z', 'Europe/Amsterdam', 'Europe/London');
    expect(Number.isNaN(Date.parse(iso))).toBe(false);
    // Amsterdam 02:30 bestaat niet; vanuit London 02:30 BST (01:30Z) naar Amsterdam is een gat.
    const gap = shiftWallClock('2030-03-31T01:30:00.000Z', 'Europe/London', 'Europe/Amsterdam');
    expect(Number.isNaN(Date.parse(gap))).toBe(false);
    expect(getTimeZone()).toBe(zone);
  });

  it('een reminder in het DST-gat van de nieuwe zone geeft geen fout', async () => {
    // 2030-03-31 00:30Z = 01:30 CET in Amsterdam; in London is 01:30 op die datum een gat.
    const t = await createTask({ title: 'gat', remind_at: '2030-03-31T00:30:00Z' });
    expect(wall(t.remind_at!, 'Europe/Amsterdam')).toMatchObject({ h: 1, mi: 30 });
    const res = await patch({ timeZone: 'Europe/London' });
    expect(res.status).toBe(200);
    const r = (await row(t.id))!;
    expect(Number.isNaN(Date.parse(r.remind_at!))).toBe(false);
  });

  it('een tweede gelijke tijdzonewissel verschuift niet nog eens', async () => {
    const t = await createTask({ title: 'twee keer', remind_at: '2030-01-07T09:00:00Z' });
    expect((await patch({ timeZone: 'Europe/London' })).status).toBe(200);
    expect((await row(t.id))!.remind_at).toBe('2030-01-07T10:00:00.000Z');
    expect((await patch({ timeZone: 'Europe/London' })).status).toBe(200);
    expect((await row(t.id))!.remind_at).toBe('2030-01-07T10:00:00.000Z');
  });

  it('tijdzonewissel: omzetten en instelling samen, of geen van beide', async () => {
    const t = await createTask({ title: 'alles of niets', remind_at: '2030-01-07T09:00:00Z' });
    await env.DB.prepare("CREATE TRIGGER IF NOT EXISTS test_geen_zone BEFORE INSERT ON user_settings WHEN NEW.key = 'timezone' BEGIN SELECT RAISE(ABORT, 'test'); END").run();
    try {
      expect((await patch({ timeZone: 'Europe/London' })).status).toBe(500);
    } finally {
      await env.DB.prepare('DROP TRIGGER IF EXISTS test_geen_zone').run();
    }
    expect((await row(t.id))!.remind_at).toBe('2030-01-07T09:00:00.000Z');
    expect(await env.DB.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'timezone'").bind(ADMIN_ID).first()).toBeNull();
  });
});

describe('instellingen-API met FALLBACK_WEBHOOK', () => {
  const ENV_URL = 'https://env.invalid/hook';
  const withEnv = { ...env, FALLBACK_WEBHOOK: ENV_URL } as Env;
  const adminPrefs = () => loadUserPrefs(withEnv, { id: ADMIN_ID, role: 'admin' });
  const send = async (method: string, body?: unknown) => {
    const cookie = await session();
    const init: RequestInit = { method, headers: { cookie, 'content-type': 'application/json' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await worker.fetch!(new Request(`${BASE}/api/settings`, init) as never, withEnv, {} as ExecutionContext);
    return res.text();
  };
  afterEach(() => vi.restoreAllMocks());

  it('zonder rij geldt de secret, maar de URL komt niet in het antwoord', async () => {
    const text = await send('GET');
    expect(text).not.toContain(ENV_URL);
    expect(JSON.parse(text)).toMatchObject({ fallbackWebhook: null, fallbackFromEnv: true, fallbackOverride: false, fallbackEnvSet: true });
    expect((await adminPrefs()).fallbackWebhook).toBe(ENV_URL);
  });

  it("uitzetten ('') blijft uit, ook met de secret; Herstellen (null) maakt de secret weer geldig", async () => {
    expect(JSON.parse(await send('PATCH', { fallbackWebhook: '' }))).toMatchObject({ fallbackWebhook: null, fallbackFromEnv: false, fallbackOverride: true, fallbackEnvSet: true });
    expect(JSON.parse(await send('GET'))).toMatchObject({ fallbackWebhook: null, fallbackFromEnv: false, fallbackOverride: true });
    const prefs = await adminPrefs();
    expect(prefs).toMatchObject({ fallbackWebhook: null, fallbackFromEnv: false });

    const t = await createTask({ title: 'uit', remind_at: new Date(Date.now() - 60_000).toISOString() });
    const spy = vi.spyOn(globalThis, 'fetch');
    await runReminders(withEnv, await loadInstallPrefs(withEnv));
    expect(spy).not.toHaveBeenCalled();
    await env.DB.prepare('UPDATE tasks SET notified = 1 WHERE id = ?').bind(t.id).run();

    const reset = await send('PATCH', { fallbackWebhook: null });
    expect(reset).not.toContain(ENV_URL);
    expect(JSON.parse(reset)).toMatchObject({ fallbackFromEnv: true, fallbackOverride: false });
    expect((await adminPrefs()).fallbackWebhook).toBe(ENV_URL);
  });

  it('een eigen adres gaat voor de secret en wordt wel getoond', async () => {
    expect(JSON.parse(await send('PATCH', { fallbackWebhook: 'https://eigen.invalid/x' }))).toMatchObject({
      fallbackWebhook: 'https://eigen.invalid/x', fallbackFromEnv: false, fallbackOverride: true, fallbackEnvSet: true,
    });
  });
});
