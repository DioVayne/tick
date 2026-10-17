import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ADMIN_ID, call, callAs, createUser, json, session } from './helpers';
import { hashKey } from '../src/keys';
import { consumeLink, createLink, linkValid } from '../src/links';

describe('accountbeheer', () => {
  it('alleen de beheerder mag /api/users; een member en een Bearer-sleutel krijgen 403', async () => {
    const b = await createUser();
    for (const [m, p] of [['GET', '/api/users'], ['POST', '/api/users/invite'], ['POST', `/api/users/${b.id}/reset`], ['DELETE', `/api/users/${b.id}`]] as const) {
      expect((await callAs(b.cookie, p, { method: m })).status).toBe(403);
      expect((await call(p, { method: m })).status).toBe(403);
    }
  });

  it('de lijst toont naam, e-mailadres, aangemaakt en laatst gezien, maar geen hash', async () => {
    const b = await createUser({ name: 'Sanne' });
    await callAs(b.cookie, '/api/account'); // zet last_seen
    const list = await json<any[]>(await callAs(await session(), '/api/users'));
    expect(list.find((u) => u.id === b.id)).toEqual({ id: b.id, name: 'Sanne', email: b.email, role: 'member', created_at: expect.any(String), last_seen: expect.any(String) });
  });

  it('uitnodiging: 7 dagen, een link van 43 tekens, alleen de hash in de database', async () => {
    const r = await json<{ url: string; expires_at: string }>(await callAs(await session(), '/api/users/invite', { method: 'POST' }));
    expect(r.url).toMatch(/^https:\/\/tick\.test\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(Math.abs(Date.parse(r.expires_at) - Date.now() - 7 * 86_400_000)).toBeLessThan(60_000);
    const code = r.url.split('/').pop()!;
    expect(await env.DB.prepare('SELECT 1 FROM account_links WHERE hash = ?').bind(code).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM account_links WHERE hash = ?').bind(await hashKey(code)).first()).not.toBeNull();
  });

  it('resetlink: 1 uur; onbekend account geeft 404', async () => {
    const b = await createUser();
    const cookie = await session();
    const res = await callAs(cookie, `/api/users/${b.id}/reset`, { method: 'POST' });
    expect(res.status).toBe(201);
    const r = await json<{ url: string; expires_at: string }>(res);
    expect(r.url).toMatch(/^https:\/\/tick\.test\/reset\/[A-Za-z0-9_-]{43}$/);
    expect(Math.abs(Date.parse(r.expires_at) - Date.now() - 3_600_000)).toBeLessThan(60_000);
    const row = await env.DB.prepare('SELECT user_id, kind FROM account_links WHERE hash = ?').bind(await hashKey(r.url.split('/').pop()!)).first();
    expect(row).toEqual({ user_id: b.id, kind: 'reset' });
    expect((await callAs(cookie, '/api/users/onbekend/reset', { method: 'POST' })).status).toBe(404);
  });

  it('verwijderen wist alles van die persoon, en zijn sessie en sleutel werken niet meer', async () => {
    const b = await createUser();
    const admin = await session();
    await callAs(b.cookie, '/api/tasks', { method: 'POST', json: { title: 'van B' } });
    await callAs(b.cookie, '/api/places', { method: 'POST', json: { name: 'Thuis B', lat: 52, lng: 5, radius: 100 } });
    const key = await json<{ id: string; key: string }>(await callAs(b.cookie, '/api/keys', { method: 'POST', json: { name: 'Pixel', kind: 'full' } }));
    expect((await call('/api/device', { method: 'POST', auth: `Bearer ${key.key}`, json: { name: 'Pixel', notifications: true, location: 'off' } })).status).toBe(200);
    const endpoint = 'https://push.test/B-' + crypto.randomUUID();
    expect((await callAs(b.cookie, '/api/push/subscribe', { method: 'POST', json: { endpoint, keys: { p256dh: 'p', auth: 'a' } } })).status).toBe(200);
    expect((await callAs(b.cookie, '/api/pair', { method: 'POST' })).status).toBe(201);
    expect((await callAs(b.cookie, '/api/settings', { method: 'PATCH', json: { timezone: 'Europe/Lisbon' } })).status).toBeLessThan(300);
    await env.DB.prepare('INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(b.id, 'week_start', '1').run();
    expect((await callAs(admin, `/api/users/${b.id}/reset`, { method: 'POST' })).status).toBe(201);
    await createLink(env.DB, 'invite', b.id, null);

    const count = async (sql: string, ...v: unknown[]) => (await env.DB.prepare(sql).bind(...v).first<{ n: number }>())!.n;
    expect(await count('SELECT COUNT(*) n FROM tasks WHERE user_id = ?', b.id)).toBeGreaterThan(0);
    expect(await count('SELECT COUNT(*) n FROM devices WHERE key_id = ?', key.id)).toBe(1);

    expect((await callAs(admin, `/api/users/${b.id}`, { method: 'DELETE' })).status).toBe(200);
    for (const t of ['tasks', 'places', 'api_keys', 'pair_codes', 'push_subscriptions', 'user_settings', 'account_links']) {
      expect(await count(`SELECT COUNT(*) n FROM ${t} WHERE user_id = ?`, b.id), t).toBe(0);
    }
    expect(await count('SELECT COUNT(*) n FROM devices WHERE key_id = ?', key.id)).toBe(0);
    expect(await count('SELECT COUNT(*) n FROM users WHERE id = ?', b.id)).toBe(0);
    expect((await callAs(b.cookie, '/api/account')).status).toBe(401);
    expect((await call('/api/tasks', { auth: `Bearer ${key.key}` })).status).toBe(401);
    expect((await callAs(admin, `/api/users/${b.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('de beheerder kan zichzelf niet verwijderen', async () => {
    expect((await callAs(await session(), `/api/users/${ADMIN_ID}`, { method: 'DELETE' })).status).toBe(400);
  });

  it('profiel: naam en e-mailadres wijzigen; een bestaand adres geeft 409; leeg is ongeldig', async () => {
    const b = await createUser();
    const c = await createUser();
    expect((await callAs(b.cookie, '/api/account', { method: 'PATCH', json: { name: 'Bram', email: 'bram@example.test' } })).status).toBe(200);
    expect(await json(await callAs(b.cookie, '/api/account'))).toMatchObject({ name: 'Bram', email: 'bram@example.test', role: 'member' });
    expect((await callAs(c.cookie, '/api/account', { method: 'PATCH', json: { email: 'BRAM@example.test' } })).status).toBe(409);
    expect((await callAs(b.cookie, '/api/account', { method: 'PATCH', json: { email: '' } })).status).toBe(400);
    expect((await callAs(b.cookie, '/api/account', { method: 'PATCH', json: { email: 'geen-adres' } })).status).toBe(400);
    expect((await callAs(b.cookie, '/api/account', { method: 'PATCH', json: { name: '   ' } })).status).toBe(400);
    expect((await callAs(b.cookie, '/api/account', { method: 'PATCH', json: { name: 'x'.repeat(61) } })).status).toBe(400);
    expect((await callAs(b.cookie, '/api/account', { method: 'PATCH', json: { name: '  Bram ', email: ' bram@example.test ' } })).status).toBe(200);
    expect(await json(await callAs(b.cookie, '/api/account'))).toMatchObject({ name: 'Bram', email: 'bram@example.test' });
  });

  it('links: eenmalig verbruiken, de soort moet kloppen, verlopen telt niet', async () => {
    const { code } = await createLink(env.DB, 'invite', ADMIN_ID, null);
    expect(await linkValid(env.DB, 'reset', code)).toBe(false);
    expect(await linkValid(env.DB, 'invite', code)).toBe(true);
    expect(await consumeLink(env.DB, 'reset', code)).toBeNull();
    expect(await consumeLink(env.DB, 'invite', code)).toEqual({ user_id: null });
    expect(await consumeLink(env.DB, 'invite', code)).toBeNull();
    expect(await linkValid(env.DB, 'invite', code)).toBe(false);
    const old = await createLink(env.DB, 'invite', ADMIN_ID, null);
    await env.DB.prepare('UPDATE account_links SET expires_at = ? WHERE hash = ?').bind(new Date(Date.now() - 1000).toISOString(), await hashKey(old.code)).run();
    expect(await linkValid(env.DB, 'invite', old.code)).toBe(false);
    expect(await consumeLink(env.DB, 'invite', old.code)).toBeNull();
  });
});
