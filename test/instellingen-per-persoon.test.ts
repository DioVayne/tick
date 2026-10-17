import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadInstallPrefs, loadUserPrefs } from '../src/prefs';
import { runReminders } from '../src/push';
import { ADMIN_ID, call, callAs, createUser, json, session, type Task } from './helpers';

const ENV_HOOK = 'https://hook.invalid/env';

afterEach(async () => {
  vi.restoreAllMocks();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM user_settings WHERE user_id = ?').bind(ADMIN_ID),
    env.DB.prepare("DELETE FROM settings WHERE key = 'default_locale'"),
    env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint LIKE 'https://push.invalid/%'"),
  ]);
});

/** Taak met een verlopen herinnering, als de gebruiker achter de cookie (of de beheerder via het API-token). */
async function overdue(title: string, cookie?: string): Promise<Task> {
  const init = { method: 'POST', json: { title, remind_at: new Date(Date.now() - 20 * 60_000).toISOString() } };
  const res = cookie ? await callAs(cookie, '/api/tasks', init) : await call('/api/tasks', init);
  expect(res.status).toBe(201);
  return json<Task>(res);
}

/** Geldige VAPID-sleutel, anders stopt sendToAll vóór het versturen. */
async function vapidKey(): Promise<string> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  return JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
}

const b64u = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Abonnement met echte sleutels (anders faalt het versleutelen vóór de fetch) voor een gebruiker. */
async function subscribe(endpoint: string, userId: string) {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const p256dh = b64u((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const auth = b64u(crypto.getRandomValues(new Uint8Array(16)));
  await env.DB.prepare('INSERT INTO push_subscriptions (endpoint,p256dh,auth,user_agent,created_at,user_id) VALUES (?,?,?,?,?,?)')
    .bind(endpoint, p256dh, auth, 'test', new Date().toISOString(), userId).run();
}

/** De taak-ids die naar een webhook-URL zijn gepost. */
const posted = (spy: { mock: { calls: unknown[][] } }, url: string): string[] =>
  spy.mock.calls.filter((c) => String(c[0]) === url).map((c) => (JSON.parse((c[1] as RequestInit).body as string) as { taskId: string }).taskId);

describe('instellingen per persoon', () => {
  it('instellingen zijn per persoon, met terugval naar de config', async () => {
    const b = await createUser();
    const res = await callAs(b.cookie, '/api/settings', { method: 'PATCH', json: { timeZone: 'America/New_York', reminderTime: '07:00', weekStart: 'sun' } });
    expect(res.status).toBe(200);
    expect(await json(await callAs(b.cookie, '/api/settings'))).toMatchObject({ timeZone: 'America/New_York', reminderTime: '07:00', weekStart: 'sun' });
    expect(await json(await callAs(await session(), '/api/settings'))).toMatchObject({ timeZone: 'Europe/Amsterdam', reminderTime: '09:00', weekStart: 'mon' });
  });

  it('FALLBACK_WEBHOOK uit de config geldt alleen voor de beheerder', async () => {
    const e = { ...env, FALLBACK_WEBHOOK: ENV_HOOK };
    expect(await loadUserPrefs(e, { id: ADMIN_ID, role: 'admin' })).toMatchObject({ fallbackWebhook: ENV_HOOK, fallbackFromEnv: true, fallbackEnvSet: true });
    expect(await loadUserPrefs(e, { id: 'x', role: 'member' })).toMatchObject({ fallbackWebhook: null, fallbackFromEnv: false, fallbackEnvSet: false });
  });

  it('een herinnering van een member zonder eigen webhook gaat nooit naar FALLBACK_WEBHOOK', async () => {
    const b = await createUser();
    const tb = await overdue('van B', b.cookie);
    const ta = await overdue('van de beheerder');
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    await runReminders({ ...env, FALLBACK_WEBHOOK: ENV_HOOK }, await loadInstallPrefs(env));
    const ids = posted(spy, ENV_HOOK);
    expect(ids).toContain(ta.id);
    expect(ids).not.toContain(tb.id);
  });

  it('een member met een eigen webhook krijgt zijn herinnering daar', async () => {
    const b = await createUser();
    expect((await callAs(b.cookie, '/api/settings', { method: 'PATCH', json: { fallbackWebhook: 'https://hook.invalid/b' } })).status).toBe(200);
    const tb = await overdue('van B met webhook', b.cookie);
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    await runReminders({ ...env, FALLBACK_WEBHOOK: ENV_HOOK }, await loadInstallPrefs(env));
    expect(posted(spy, 'https://hook.invalid/b')).toEqual([tb.id]);
    expect(posted(spy, ENV_HOOK)).not.toContain(tb.id);
  });

  it('de cron stuurt de herinnering van A niet naar het abonnement van B', async () => {
    const b = await createUser();
    await subscribe('https://push.invalid/a', ADMIN_ID);
    await subscribe('https://push.invalid/b', b.id);
    await overdue('van A');
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await runReminders({ ...env, VAPID_PRIVATE_KEY: await vapidKey() }, await loadInstallPrefs(env));
    const urls = spy.mock.calls.map((c) => String(c[0] instanceof Request ? c[0].url : c[0]));
    expect(urls).toContain('https://push.invalid/a');
    expect(urls.some((u) => u.includes('push.invalid/b'))).toBe(false);
  });

  it('alleen de beheerder wijzigt de standaardtaal', async () => {
    const b = await createUser();
    const res = await callAs(b.cookie, '/api/settings', { method: 'PATCH', json: { defaultLocale: 'nl' } });
    expect(res.status).toBe(403);
    expect((await json<{ error: string }>(res)).error).toBe('Only the administrator can change this.');
    expect(await env.DB.prepare("SELECT value FROM settings WHERE key = 'default_locale'").first()).toBeNull();
    expect((await callAs(await session(), '/api/settings', { method: 'PATCH', json: { defaultLocale: 'nl' } })).status).toBe(200);
    expect(await json(await callAs(b.cookie, '/api/settings'))).toMatchObject({ defaultLocale: 'nl' });
  });

  it('een tijdzonewissel verschuift alleen de eigen open taken', async () => {
    const b = await createUser();
    const a = await call('/api/tasks', { method: 'POST', json: { title: 'van A', remind_at: '2030-01-07T09:00:00Z' } });
    const ta = await json<Task>(a);
    const tb = await json<Task>(await callAs(b.cookie, '/api/tasks', { method: 'POST', json: { title: 'van B', remind_at: '2030-01-07T09:00:00Z' } }));
    expect((await callAs(b.cookie, '/api/settings', { method: 'PATCH', json: { timeZone: 'Europe/London' } })).status).toBe(200);
    const remind = async (id: string) => (await env.DB.prepare('SELECT remind_at FROM tasks WHERE id = ?').bind(id).first<{ remind_at: string }>())!.remind_at;
    expect(await remind(ta.id)).toBe('2030-01-07T09:00:00.000Z');
    expect(await remind(tb.id)).toBe('2030-01-07T10:00:00.000Z');
    await env.DB.prepare('DELETE FROM tasks WHERE id IN (?, ?)').bind(ta.id, tb.id).run();
  });

  it('/config.js geeft userId, userName en isAdmin', async () => {
    const b = await createUser({ name: 'Sanne' });
    const text = await (await callAs(b.cookie, '/config.js')).text();
    expect(text).toContain(`"userId":"${b.id}"`);
    expect(text).toContain('"userName":"Sanne"');
    expect(text).toContain('"isAdmin":false');
    expect(await (await callAs(await session(), '/config.js')).text()).toContain('"isAdmin":true');
  });
});
