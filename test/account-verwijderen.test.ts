import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ADMIN_ID, call, callAs, createUser, json, session } from './helpers';
import { translate } from '../public/i18n.js';

type User = Awaited<ReturnType<typeof createUser>>;

const count = async (sql: string, ...v: unknown[]) => (await env.DB.prepare(sql).bind(...v).first<{ n: number }>())!.n;
const del = (cookie: string, body: unknown) => callAs(cookie, '/api/account/delete', { method: 'POST', json: body });
const addTask = async (u: User, body: Record<string, unknown>) => {
  const res = await callAs(u.cookie, '/api/tasks', { method: 'POST', json: body });
  expect(res.status).toBe(201);
  return json<{ id: string }>(res);
};

describe('eigen account verwijderen', () => {
  it('zelf verwijderen wist alles, zet de cookie leeg en de oude sessie en sleutel werken niet meer', async () => {
    const b = await createUser();
    await addTask(b, { title: 'van B' });
    await callAs(b.cookie, '/api/places', { method: 'POST', json: { name: 'Thuis B', lat: 52, lng: 5, radius: 100 } });
    const key = await json<{ id: string; key: string }>(await callAs(b.cookie, '/api/keys', { method: 'POST', json: { name: 'Pixel', kind: 'full' } }));
    expect((await call('/api/device', { method: 'POST', auth: `Bearer ${key.key}`, json: { name: 'Pixel', notifications: true, location: 'off' } })).status).toBe(200);
    const endpoint = 'https://push.test/B-' + crypto.randomUUID();
    expect((await callAs(b.cookie, '/api/push/subscribe', { method: 'POST', json: { endpoint, keys: { p256dh: 'p', auth: 'a' } } })).status).toBe(200);
    expect((await callAs(b.cookie, '/api/pair', { method: 'POST' })).status).toBe(201);
    await env.DB.prepare('INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(b.id, 'week_start', '1').run();

    const res = await del(b.cookie, { password: b.password });
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie().filter((h) => h.startsWith('tick_session='));
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(/Max-Age=0/i);
    for (const t of ['tasks', 'places', 'api_keys', 'pair_codes', 'push_subscriptions', 'user_settings', 'account_links', 'lists']) {
      expect(await count(`SELECT COUNT(*) n FROM ${t} WHERE user_id = ?`, b.id), t).toBe(0);
    }
    expect(await count('SELECT COUNT(*) n FROM devices WHERE key_id = ?', key.id)).toBe(0);
    expect(await count('SELECT COUNT(*) n FROM users WHERE id = ?', b.id)).toBe(0);
    expect((await callAs(b.cookie, '/api/account')).status).toBe(401);
    expect((await call('/api/tasks', { auth: `Bearer ${key.key}` })).status).toBe(401);
  });

  it('een gedeelde lijst gaat over naar een ander lid', async () => {
    const b = await createUser();
    const c = await createUser();
    const name = `Boodschappen ${crypto.randomUUID().slice(0, 8)}`;
    const task = await addTask(b, { title: 'Melk', list: name });
    const shared = await callAs(b.cookie, '/api/shared-lists', { method: 'POST', json: { name, to_user: c.id } });
    expect(shared.status).toBe(201);
    const { list_id } = await json<{ list_id: string }>(shared);
    expect((await callAs(c.cookie, `/api/shared-lists/${list_id}/accept`, { method: 'POST', json: {} })).status).toBe(200);

    expect((await del(b.cookie, { password: b.password })).status).toBe(200);
    expect(await env.DB.prepare('SELECT owner_id FROM shared_lists WHERE id = ?').bind(list_id).first()).toEqual({ owner_id: c.id });
    expect(await env.DB.prepare('SELECT user_id FROM tasks WHERE id = ?').bind(task.id).first()).toEqual({ user_id: c.id });
  });

  it('fout wachtwoord → 403 en er is niets gewist', async () => {
    const b = await createUser();
    await addTask(b, { title: 'blijft' });
    const res = await del(b.cookie, { password: 'fout-wachtwoord' });
    expect(res.status).toBe(403);
    expect((await json<{ error: string }>(res)).error).toBe(translate('en', 'err.wrong_password'));
    expect(await count('SELECT COUNT(*) n FROM users WHERE id = ?', b.id)).toBe(1);
    expect(await count('SELECT COUNT(*) n FROM tasks WHERE user_id = ?', b.id)).toBe(1);
  });

  it('de enige beheerder kan zichzelf niet verwijderen → 409', async () => {
    const res = await del(await session(), { password: 'test-wachtwoord' });
    expect(res.status).toBe(409);
    expect((await json<{ error: string }>(res)).error).toBe(translate('en', 'err.last_admin'));
    expect(await count('SELECT COUNT(*) n FROM users WHERE id = ?', ADMIN_ID)).toBe(1);
  });

  it('een Bearer-sleutel mag niet verwijderen → 403', async () => {
    const b = await createUser();
    const key = await json<{ key: string }>(await callAs(b.cookie, '/api/keys', { method: 'POST', json: { name: 'Pixel', kind: 'full' } }));
    const res = await call('/api/account/delete', { method: 'POST', auth: `Bearer ${key.key}`, json: { password: b.password } });
    expect(res.status).toBe(403);
    expect(await count('SELECT COUNT(*) n FROM users WHERE id = ?', b.id)).toBe(1);
  });

  it('zonder wachtwoord → 400', async () => {
    const b = await createUser();
    expect((await del(b.cookie, {})).status).toBe(400);
    expect(await count('SELECT COUNT(*) n FROM users WHERE id = ?', b.id)).toBe(1);
  });
});
