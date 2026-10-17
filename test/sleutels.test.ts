import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, INBOX, json, session } from './helpers';

type Made = { id: string; name: string; kind: string; hint: string; created_at: string; key: string };

async function make(cookie: string, name: string, kind: string): Promise<Made> {
  const res = await call('/api/keys', { method: 'POST', auth: null, headers: { cookie }, json: { name, kind } });
  expect(res.status).toBe(201);
  return json<Made>(res);
}

afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM api_keys'),
    env.DB.prepare('DELETE FROM devices'),
    env.DB.prepare("DELETE FROM settings WHERE key IN ('env_api_token_off','env_inbox_token_off','env_api_token_used','env_inbox_token_used')"),
  ]);
});

describe('sleutels in de app', () => {
  it('een nieuwe full-sleutel werkt voor de API, niet voor de inbox; ingetrokken geeft 401', async () => {
    const cookie = await session();
    const made = await make(cookie, 'Pixel', 'full');
    expect(made.key).toMatch(/^tick_[A-Za-z0-9_-]{43}$/);
    expect(made.key.endsWith(made.hint)).toBe(true);
    expect((await call('/api/tasks', { auth: `Bearer ${made.key}` })).status).toBe(200);
    expect((await call('/api/inbox', { method: 'POST', auth: `Bearer ${made.key}`, json: { title: 'x' } })).status).toBe(403);
    const del = await call(`/api/keys/${made.id}`, { method: 'DELETE', auth: null, headers: { cookie } });
    expect(await json(del)).toEqual({ ok: true });
    expect((await call('/api/tasks', { auth: `Bearer ${made.key}` })).status).toBe(401);
  });

  it('een inbox-sleutel mag alleen POST /api/inbox', async () => {
    const cookie = await session();
    const made = await make(cookie, 'Snelkoppeling', 'inbox');
    expect((await call('/api/inbox', { method: 'POST', auth: `Bearer ${made.key}`, json: { title: 'via sleutel' } })).status).toBe(201);
    expect((await call('/api/tasks', { auth: `Bearer ${made.key}` })).status).toBe(403);
  });

  it('de lijst toont nooit de sleutel of de hash', async () => {
    const cookie = await session();
    const made = await make(cookie, 'Pixel', 'full');
    const text = await (await call('/api/keys', { auth: null, headers: { cookie } })).text();
    expect(text).not.toContain('tick_');
    expect(text).not.toContain(made.key);
    expect(text).not.toContain('hash');
    const list = JSON.parse(text) as { keys: { id: string }[]; env: { id: string; off: boolean }[] };
    expect(list.keys.map((k) => k.id)).toEqual([made.id]);
    expect(list.env.map((e) => e.id).sort()).toEqual(['env-api', 'env-inbox']);
  });

  it('de hash staat in de database, de sleutel zelf niet', async () => {
    const cookie = await session();
    const made = await make(cookie, 'Pixel', 'full');
    const row = await env.DB.prepare('SELECT hash FROM api_keys WHERE id = ?').bind(made.id).first<{ hash: string }>();
    expect(row!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.hash).not.toContain(made.key);
  });

  it('gebruik wordt bijgehouden, hoogstens eens per uur', async () => {
    const cookie = await session();
    const made = await make(cookie, 'Pixel', 'full');
    const last = () => env.DB.prepare('SELECT last_used_at AS t FROM api_keys WHERE id = ?').bind(made.id).first<{ t: string | null }>().then((r) => r!.t);
    expect(await last()).toBeNull();
    await call('/api/tasks', { auth: `Bearer ${made.key}` });
    const first = await last();
    expect(first).not.toBeNull();
    await call('/api/tasks', { auth: `Bearer ${made.key}` });
    expect(await last()).toBe(first);
    const old = new Date(Date.now() - 2 * 3_600_000).toISOString();
    await env.DB.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').bind(old, made.id).run();
    await call('/api/tasks', { auth: `Bearer ${made.key}` });
    expect(await last()).not.toBe(old);
  });

  it('binnen het uur schrijft een tweede request niets naar api_keys', async () => {
    const cookie = await session();
    const made = await make(cookie, 'Pixel', 'full');
    await call('/api/tasks', { auth: `Bearer ${made.key}` });
    const spy = vi.spyOn(env.DB, 'prepare');
    try {
      await call('/api/tasks', { auth: `Bearer ${made.key}` });
      expect(spy.mock.calls.some(([sql]) => /UPDATE api_keys/i.test(sql))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('verwijderen haalt ook de apparaatrij weg; onbekend id geeft 404', async () => {
    const cookie = await session();
    const made = await make(cookie, 'Pixel', 'full');
    await env.DB.prepare("INSERT INTO devices (key_id, name, notifications, location, seen_at) VALUES (?, 'Pixel', 1, 'off', ?)").bind(made.id, new Date().toISOString()).run();
    await call(`/api/keys/${made.id}`, { method: 'DELETE', auth: null, headers: { cookie } });
    expect(await env.DB.prepare('SELECT 1 FROM devices WHERE key_id = ?').bind(made.id).first()).toBeNull();
    expect((await call(`/api/keys/${made.id}`, { method: 'DELETE', auth: null, headers: { cookie } })).status).toBe(404);
  });

  it('oude API_TOKEN uitschakelen geeft 401, weer inschakelen 200; het inbox-token idem', async () => {
    const cookie = await session();
    const patch = (id: string, off: boolean) => call(`/api/keys/${id}`, { method: 'PATCH', auth: null, headers: { cookie }, json: { off } });
    expect((await call('/api/tasks')).status).toBe(200);
    expect(await json(await patch('env-api', true))).toEqual({ ok: true });
    expect((await call('/api/tasks')).status).toBe(401);
    const list = await json<{ env: { id: string; off: boolean }[] }>(await call('/api/keys', { auth: null, headers: { cookie } }));
    expect(list.env.find((e) => e.id === 'env-api')!.off).toBe(true);
    await patch('env-api', false);
    expect((await call('/api/tasks')).status).toBe(200);

    await patch('env-inbox', true);
    expect((await call('/api/inbox', { method: 'POST', auth: INBOX, json: { title: 'x' } })).status).toBe(401);
    await patch('env-inbox', false);
    expect((await call('/api/inbox', { method: 'POST', auth: INBOX, json: { title: 'x' } })).status).toBe(201);
  });

  it('gebruik van een oude secret komt in de instellingen', async () => {
    await call('/api/tasks');
    const r = await env.DB.prepare("SELECT value FROM settings WHERE key = 'env_api_token_used'").first<{ value: string }>();
    expect(r?.value).toMatch(/^\d{4}-/);
  });

  it('een Bearer-sleutel kan geen sleutels beheren', async () => {
    expect((await call('/api/keys')).status).toBe(403);
    const cookie = await session();
    const made = await make(cookie, 'Pixel', 'full');
    expect((await call('/api/keys', { auth: `Bearer ${made.key}` })).status).toBe(403);
    expect((await call('/api/keys', { method: 'POST', json: { name: 'x', kind: 'full' } })).status).toBe(403);
  });

  it('naam leeg of te lang geeft 400; kind onbekend geeft 400; PATCH met een ander id geeft 404', async () => {
    const cookie = await session();
    const post = (b: unknown) => call('/api/keys', { method: 'POST', auth: null, headers: { cookie }, json: b });
    expect((await post({ name: '', kind: 'full' })).status).toBe(400);
    expect((await post({ name: '   ', kind: 'full' })).status).toBe(400);
    expect((await post({ name: 'x'.repeat(61), kind: 'full' })).status).toBe(400);
    expect((await post({ name: 'ok', kind: 'admin' })).status).toBe(400);
    expect((await post({ kind: 'full' })).status).toBe(400);
    const patch = (id: string, b: unknown) => call(`/api/keys/${id}`, { method: 'PATCH', auth: null, headers: { cookie }, json: b });
    expect((await patch('env-api', { off: 'ja' })).status).toBe(400);
    expect((await patch('abc', { off: true })).status).toBe(404);
  });
});
