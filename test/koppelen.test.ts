import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, json, randomIp, session } from './helpers';

const pair = async (cookie: string) => json<{ id: string; code: string; expires_at: string }>(
  await call('/api/pair', { method: 'POST', auth: null, headers: { cookie } }));
const redeem = (code: string, name?: string, ip = randomIp()) =>
  call('/api/pair/redeem', { method: 'POST', auth: null, json: { code, name }, headers: { 'cf-connecting-ip': ip } });
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
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await redeem('x', undefined, ip)).status);
    expect(statuses.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(statuses[5]).toBe(429);
  });
});
