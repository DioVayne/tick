import { beforeAll, describe, expect, it } from 'vitest';
import { callAs, createUser, json, session } from './helpers';

type User = Awaited<ReturnType<typeof createUser>>;

const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);
const put = (cookie: string, body: BodyInit, type = 'image/jpeg') =>
  callAs(cookie, '/api/background', { method: 'PUT', body, headers: { 'content-type': type } });
const prefs = async (cookie: string) => (await json<{ background: string | null }>(await callAs(cookie, '/api/settings'))).background;

describe('achtergrondfoto', () => {
  let a: User;
  let b: User;
  beforeAll(async () => {
    a = await createUser({ name: 'Ada' });
    b = await createUser({ name: 'Bo' });
  });

  it('uploaden, ophalen, vervangen en verwijderen, per persoon', async () => {
    expect(await prefs(a.cookie)).toBeNull();
    expect((await callAs(a.cookie, '/api/background')).status).toBe(404);

    const res = await put(a.cookie, bytes(500));
    expect(res.status).toBe(200);
    const { version } = await json<{ version: string }>(res);
    expect(await prefs(a.cookie)).toBe(version);

    const get = await callAs(a.cookie, '/api/background');
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/jpeg');
    expect(get.headers.get('cache-control')).toBe('private, no-cache');
    expect(get.headers.get('content-security-policy')).toMatch(/; sandbox$/);
    expect((await get.arrayBuffer()).byteLength).toBe(500);
    expect((await callAs(a.cookie, '/api/background', { headers: { 'if-none-match': get.headers.get('etag')! } })).status).toBe(304);

    // Een ander ziet de foto niet.
    expect((await callAs(b.cookie, '/api/background')).status).toBe(404);
    expect(await prefs(b.cookie)).toBeNull();

    // Vervangen.
    await put(a.cookie, bytes(300, 9), 'image/webp');
    const again = await callAs(a.cookie, '/api/background');
    expect(again.headers.get('content-type')).toBe('image/webp');
    expect((await again.arrayBuffer()).byteLength).toBe(300);

    expect((await callAs(a.cookie, '/api/background', { method: 'DELETE' })).status).toBe(200);
    expect((await callAs(a.cookie, '/api/background')).status).toBe(404);
    expect(await prefs(a.cookie)).toBeNull();
  });

  it('weigert iets dat geen afbeelding is of te groot is', async () => {
    expect((await put(b.cookie, bytes(10), 'text/html')).status).toBe(400);
    expect((await put(b.cookie, bytes(10), 'image/svg+xml')).status).toBe(400);
    const big = await put(b.cookie, bytes(11 * 1024 * 1024));
    expect(big.status).toBe(413);
    expect(await prefs(b.cookie)).toBeNull();
  });

  it('is alleen voor een sessie, niet voor het API-token', async () => {
    const { call } = await import('./helpers');
    expect((await call('/api/background')).status).toBe(403);
    expect((await session()).startsWith('tick_session=')).toBe(true);
  });
});
