import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { hashKey } from '../src/keys';
import { call, callAs, createUser, json, randomIp, session, untilRateLimited } from './helpers';

const pair = async (cookie: string) => json<{ id: string; code: string; expires_at: string }>(
  await call('/api/pair', { method: 'POST', auth: null, headers: { cookie } }));
const redeem = (code: string, name?: string, ip = randomIp(), old_key?: unknown) =>
  call('/api/pair/redeem', { method: 'POST', auth: null, json: { code, name, old_key }, headers: { 'cf-connecting-ip': ip } });
const keysOf = async (cookie: string) =>
  (await json<{ keys: { name: string; kind: string }[] }>(await call('/api/keys', { auth: null, headers: { cookie } }))).keys;

describe('koppelcodes', () => {
  it('alleen met een sessie: Bearer of niets geeft 401/403', async () => {
    expect((await call('/api/pair', { method: 'POST' })).status).toBe(403);
    expect((await call('/api/pair', { method: 'POST', auth: null })).status).toBe(401);
  });
  it('inwisselen geeft een werkende full-sleutel met de naam, en de code is daarna op', async () => {
    const cookie = await session();
    const { id, code } = await pair(cookie);
    const res = await redeem(code, 'Pixel 9');
    expect(res.status).toBe(201);
    const { key } = await json<{ key: string }>(res);
    expect((await call('/api/tasks', { auth: `Bearer ${key}` })).status).toBe(200);
    expect(await keysOf(cookie)).toContainEqual(expect.objectContaining({ name: 'Pixel 9', kind: 'full' }));
    expect(await json(await call(`/api/pair/${id}`, { auth: null, headers: { cookie } }))).toEqual({ used: true });
    expect((await redeem(code)).status).toBe(400);
  });
  it('een verlopen of verzonnen code werkt niet', async () => {
    const { id, code } = await pair(await session());
    await env.DB.prepare('UPDATE pair_codes SET expires_at = ? WHERE id = ?').bind('2000-01-01T00:00:00.000Z', id).run();
    expect((await redeem(code)).status).toBe(400);
    expect((await redeem('verzonnen')).status).toBe(400);
  });
  it('zonder naam heet de sleutel "Android"', async () => {
    const cookie = await session();
    const { code } = await pair(cookie);
    expect((await redeem(code)).status).toBe(201);
    expect(await keysOf(cookie)).toContainEqual(expect.objectContaining({ name: 'Android', kind: 'full' }));
  });
  it('de database bewaart alleen de hash van de code', async () => {
    const { id, code } = await pair(await session());
    const row = await env.DB.prepare('SELECT hash FROM pair_codes WHERE id = ?').bind(id).first<{ hash: string }>();
    expect(row!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.hash).not.toBe(code);
  });
  it('de code verloopt na twee minuten', async () => {
    const { code, expires_at } = await pair(await session());
    expect(code.startsWith('tick_')).toBe(false);
    const ms = new Date(expires_at).getTime() - Date.now();
    expect(ms).toBeGreaterThan(100_000);
    expect(ms).toBeLessThanOrEqual(120_000);
  });
  it('een onbekend id geeft 404', async () => {
    expect((await call('/api/pair/bestaat-niet', { auth: null, headers: { cookie: await session() } })).status).toBe(404);
  });
  it('een nieuwe aanvraag ruimt verlopen en gebruikte codes op', async () => {
    const cookie = await session();
    const old = await pair(cookie);
    await redeem(old.code);
    await pair(cookie);
    expect((await call(`/api/pair/${old.id}`, { auth: null, headers: { cookie } })).status).toBe(404);
  });
  it('te veel inwisselpogingen vanaf één IP geeft 429', async () => {
    const ip = randomIp();
    const statuses = (await untilRateLimited(() => redeem('x', undefined, ip))).map((r) => r.status);
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.slice(0, -1).every((s) => s === 400)).toBe(true);
  });
});

describe('koppelen per gebruiker', () => {
  it('een koppelcode van B geeft een sleutel van B, met user_id in het antwoord', async () => {
    const b = await createUser();
    const { code } = await pair(b.cookie);
    const r = await json<{ key: string; user_id: string }>(await redeem(code));
    expect(r.user_id).toBe(b.id);
    expect(await env.DB.prepare('SELECT user_id FROM api_keys WHERE hash = ?').bind(await hashKey(r.key)).first()).toEqual({ user_id: b.id });
  });
  it('redeem met old_key trekt die oude sleutel in, ook de status van de telefoon', async () => {
    const cookie = await session();
    const old = await json<{ id: string; key: string }>(await callAs(cookie, '/api/keys', { method: 'POST', json: { name: 'oud', kind: 'full' } }));
    await call('/api/device', { method: 'POST', auth: `Bearer ${old.key}`, json: { name: 'Pixel', notifications: true, location: 'off' } });
    expect(await env.DB.prepare('SELECT key_id FROM devices WHERE key_id = ?').bind(old.id).first()).not.toBeNull();
    const { code } = await pair(cookie);
    const res = await redeem(code, undefined, randomIp(), old.key);
    expect(res.status).toBe(201);
    expect((await call('/api/tasks', { auth: `Bearer ${old.key}` })).status).toBe(401);
    expect(await env.DB.prepare('SELECT key_id FROM devices WHERE key_id = ?').bind(old.id).first()).toBeNull();
  });
  it('old_key van een ander account wordt ook ingetrokken', async () => {
    const b = await createUser();
    const old = await json<{ key: string }>(await callAs(b.cookie, '/api/keys', { method: 'POST', json: { name: 'oudB', kind: 'full' } }));
    const { code } = await pair(await session());
    expect((await redeem(code, undefined, randomIp(), old.key)).status).toBe(201);
    expect((await call('/api/tasks', { auth: `Bearer ${old.key}` })).status).toBe(401);
  });
  it('een ongeldige old_key of een inbox-sleutel als old_key wordt genegeerd', async () => {
    const cookie = await session();
    const inbox = await json<{ key: string }>(await callAs(cookie, '/api/keys', { method: 'POST', json: { name: 'inb', kind: 'inbox' } }));
    for (const bad of [inbox.key, 'tick_bestaatniet', 'geen-tick', 12]) {
      const { code } = await pair(cookie);
      expect((await redeem(code, undefined, randomIp(), bad)).status).toBe(201);
    }
    expect((await call('/api/inbox', { method: 'POST', auth: `Bearer ${inbox.key}`, json: { title: 'nog' } })).status).toBe(201);
  });
  it("B kan A's koppelcode niet opvragen", async () => {
    const b = await createUser();
    const { id } = await pair(await session());
    expect((await callAs(b.cookie, `/api/pair/${id}`)).status).toBe(404);
  });
  it("A's gebruikte code blijft zichtbaar als B daarna een code aanvraagt", async () => {
    const cookieA = await session(); const b = await createUser();
    const { id, code } = await pair(cookieA);
    expect((await redeem(code)).status).toBe(201);
    await pair(b.cookie);
    expect(await json(await callAs(cookieA, `/api/pair/${id}`))).toEqual({ used: true });
  });
});
