import { describe, expect, it } from 'vitest';
import { call, login } from './helpers';

describe('auth', () => {
  it('weigert de API zonder inlog', async () => {
    expect((await call('/api/tasks', { auth: null })).status).toBe(401);
  });

  it('weigert een onjuist token', async () => {
    expect((await call('/api/tasks', { auth: 'Bearer fout' })).status).toBe(401);
  });

  it('accepteert het API-token', async () => {
    expect((await call('/api/tasks')).status).toBe(200);
  });

  it('stuurt een browser zonder inlog naar /login', async () => {
    const res = await call('/', { auth: null, headers: { accept: 'text/html' } });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/\/login$/);
  });

  it('toont de loginpagina zonder inlog', async () => {
    const res = await call('/login', { auth: null });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Password');
  });

  it('weigert een onjuist wachtwoord', async () => {
    const res = await login('fout');
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('geeft bij het juiste wachtwoord een werkende sessiecookie', async () => {
    const res = await login('test-wachtwoord');
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    const session = cookie.split(';')[0];
    expect((await call('/api/tasks', { auth: null, headers: { cookie: session } })).status).toBe(200);
  });

  it('weigert een vervalste sessiecookie', async () => {
    const exp = Date.now() + 86_400_000;
    const res = await call('/api/tasks', { auth: null, headers: { cookie: `tick_session=${exp}.1.${'0'.repeat(64)}` } });
    expect(res.status).toBe(401);
  });

  it('wist de cookie bij uitloggen', async () => {
    const res = await call('/logout', { method: 'POST', auth: null });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });
});
