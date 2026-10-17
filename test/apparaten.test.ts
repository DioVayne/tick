import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { call, INBOX, json, session } from './helpers';

afterEach(async () => {
  await env.DB.prepare('DELETE FROM devices').run();
  await env.DB.prepare('DELETE FROM push_subscriptions').run();
  await env.DB.prepare('DELETE FROM api_keys').run();
});

const device = { name: 'Pixel 8', notifications: true, location: 'foreground', app_version: '1.2' };

describe('apparaten', () => {
  it('een telefoon meldt zijn status en die verschijnt bij de apparaten', async () => {
    expect((await call('/api/device', { method: 'POST', json: device })).status).toBe(200);
    const d = await json<any>(await call('/api/devices', { auth: null, headers: { cookie: await session() } }));
    expect(d.phones.find((p: any) => p.key_id === 'env-api').status).toMatchObject({ name: 'Pixel 8', location: 'foreground', notifications: true, app_version: '1.2' });
  });

  it('een tweede melding overschrijft de eerste', async () => {
    await call('/api/device', { method: 'POST', json: device });
    await call('/api/device', { method: 'POST', json: { ...device, name: 'Pixel 9', notifications: false, location: 'off' } });
    const d = await json<any>(await call('/api/devices', { auth: null, headers: { cookie: await session() } }));
    expect(d.phones.find((p: any) => p.key_id === 'env-api').status).toMatchObject({ name: 'Pixel 9', notifications: false, location: 'off' });
  });

  it('toont alle volledige sleutels, ook zonder status, en geen inbox-sleutels', async () => {
    const cookie = await session();
    const full = await json<any>(await call('/api/keys', { auth: null, headers: { cookie }, method: 'POST', json: { name: 'Mijn telefoon', kind: 'full' } }));
    await call('/api/keys', { auth: null, headers: { cookie }, method: 'POST', json: { name: 'Bookmarklet', kind: 'inbox' } });
    const d = await json<any>(await call('/api/devices', { auth: null, headers: { cookie } }));
    expect(d.phones.map((p: any) => p.key_id).sort()).toEqual(['env-api', full.id].sort());
    expect(d.phones.find((p: any) => p.key_id === full.id)).toMatchObject({ name: 'Mijn telefoon', status: null });
  });

  it('een eigen sleutel meldt onder zijn eigen id', async () => {
    const cookie = await session();
    const full = await json<any>(await call('/api/keys', { auth: null, headers: { cookie }, method: 'POST', json: { name: 'Tel', kind: 'full' } }));
    await call('/api/device', { method: 'POST', auth: `Bearer ${full.key}`, json: device });
    const d = await json<any>(await call('/api/devices', { auth: null, headers: { cookie } }));
    expect(d.phones.find((p: any) => p.key_id === full.id).status).toMatchObject({ name: 'Pixel 8' });
    expect(d.phones.find((p: any) => p.key_id === 'env-api').status).toBeNull();
  });

  it('geeft de browsers met taal', async () => {
    await env.DB.prepare('INSERT INTO push_subscriptions (endpoint,p256dh,auth,user_agent,created_at,locale) VALUES (?,?,?,?,?,?)')
      .bind('https://push.invalid/a', 'p', 'a', 'UA', '2026-01-01T00:00:00.000Z', 'nl').run();
    const d = await json<any>(await call('/api/devices', { auth: null, headers: { cookie: await session() } }));
    expect(d.browsers).toEqual([{ endpoint: 'https://push.invalid/a', user_agent: 'UA', created_at: '2026-01-01T00:00:00.000Z', locale: 'nl' }]);
  });

  it('een abonnement bewaart zijn taal en een onbekende taal wordt leeg', async () => {
    const sub = (locale?: string) => call('/api/push/subscribe', { method: 'POST', json: { endpoint: 'https://push.invalid/z', keys: { p256dh: 'p', auth: 'a' }, locale } });
    await sub('nl');
    const get = () => env.DB.prepare('SELECT locale FROM push_subscriptions WHERE endpoint = ?').bind('https://push.invalid/z').first<{ locale: string | null }>();
    expect((await get())!.locale).toBe('nl');
    await sub('fr');
    expect((await get())!.locale).toBe('nl');
    await sub('en');
    expect((await get())!.locale).toBe('en');
  });

  it('POST /api/device weigert een sessie en een inbox-sleutel (403)', async () => {
    expect((await call('/api/device', { method: 'POST', auth: null, headers: { cookie: await session() }, json: device })).status).toBe(403);
    expect((await call('/api/device', { method: 'POST', auth: INBOX, json: device })).status).toBe(403);
  });

  it('GET /api/devices is alleen voor een sessie', async () => {
    expect((await call('/api/devices')).status).toBe(403);
  });

  it('POST /api/device weigert onzin (400)', async () => {
    for (const bad of [{ ...device, name: '' }, { ...device, name: 'x'.repeat(101) }, { ...device, notifications: 'ja' }, { ...device, location: 'altijd' }, { ...device, app_version: 5 }]) {
      expect((await call('/api/device', { method: 'POST', json: bad })).status).toBe(400);
    }
    const res = await call('/api/device', { method: 'POST', body: 'geen json', headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(400);
  });
});
