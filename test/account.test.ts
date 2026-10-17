import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { bumpSessionVersion, passwordOk, sessionVersion } from '../src/auth';
import { hashPassword, verifyPassword } from '../src/password';
import { loadPrefs, setSetting } from '../src/prefs';
import type { Env } from '../src/index';
import { call, login, randomIp, session } from './helpers';

afterEach(async () => {
  await env.DB.prepare("DELETE FROM settings WHERE key='password_hash'").run();
});

const post = (path: string, cookie: string, json?: unknown) =>
  call(path, { method: 'POST', auth: null, headers: { cookie, 'cf-connecting-ip': randomIp() }, json });
const tasks = (cookie: string) => call('/api/tasks', { auth: null, headers: { cookie } });

describe('account', () => {
  it('wachtwoord wijzigen: oud werkt niet meer, nieuw wel, andere sessies uitgelogd, deze blijft', async () => {
    const a = await session(); const b = await session();
    const res = await post('/api/account/password', a, { current: 'test-wachtwoord', next: 'nieuw-wachtwoord' });
    expect(res.status).toBe(200);
    const fresh = res.headers.get('set-cookie')!.split(';')[0];
    expect((await tasks(fresh)).status).toBe(200);
    expect((await tasks(b)).status).toBe(401);
    expect((await login('test-wachtwoord')).status).toBe(401);
    expect((await login('nieuw-wachtwoord')).status).toBe(200);
  });

  it('noodroute: password_hash wissen → LOGIN_PASSWORD geldt weer', async () => {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('password_hash', ?)").bind(await hashPassword('ander-wachtwoord')).run();
    expect((await login('test-wachtwoord')).status).toBe(401);
    expect((await login('ander-wachtwoord')).status).toBe(200);
    await env.DB.prepare("DELETE FROM settings WHERE key='password_hash'").run();
    expect((await login('test-wachtwoord')).status).toBe(200);
  });

  it('met password_hash werkt inloggen ook zonder LOGIN_PASSWORD', async () => {
    const prefs = await loadPrefs(env as Env);
    const e = { ...env, LOGIN_PASSWORD: '' } as Env;
    expect(await passwordOk(e, prefs, 'x')).toBe(false);
    expect(await passwordOk(e, { ...prefs, passwordHash: await hashPassword('x') }, 'x')).toBe(true);
  });

  it('fout huidig wachtwoord → 403; te kort → 400', async () => {
    const a = await session();
    expect((await post('/api/account/password', a, { current: 'fout', next: 'nieuw-wachtwoord' })).status).toBe(403);
    expect((await post('/api/account/password', a, { current: 'test-wachtwoord', next: 'kort' })).status).toBe(400);
    expect((await post('/api/account/password', a, { current: 1, next: 2 })).status).toBe(400);
    expect((await tasks(a)).status).toBe(200);
    expect((await login('test-wachtwoord')).status).toBe(200);
  });

  it('API-token mag niet bij het account', async () => {
    const res = await call('/api/account/logout-others', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('uitloggen op andere apparaten', async () => {
    const a = await session(); const b = await session();
    const res = await post('/api/account/logout-others', a);
    expect(res.status).toBe(200);
    const fresh = res.headers.get('set-cookie')!.split(';')[0];
    expect((await tasks(b)).status).toBe(401);
    expect((await tasks(a)).status).toBe(401);
    expect((await tasks(fresh)).status).toBe(200);
  });

  it('wachtwoord en sessieversie samen, of geen van beide', async () => {
    const a = await session();
    const db = env.DB;
    await db.batch([
      db.prepare("CREATE TRIGGER IF NOT EXISTS test_geen_versie_upd BEFORE UPDATE ON settings WHEN NEW.key = 'session_version' BEGIN SELECT RAISE(ABORT, 'test'); END"),
      db.prepare("CREATE TRIGGER IF NOT EXISTS test_geen_versie_ins BEFORE INSERT ON settings WHEN NEW.key = 'session_version' BEGIN SELECT RAISE(ABORT, 'test'); END"),
    ]);
    try {
      expect((await post('/api/account/password', a, { current: 'test-wachtwoord', next: 'nieuw-wachtwoord' })).status).toBe(500);
    } finally {
      await db.batch([db.prepare('DROP TRIGGER IF EXISTS test_geen_versie_upd'), db.prepare('DROP TRIGGER IF EXISTS test_geen_versie_ins')]);
    }
    expect(await db.prepare("SELECT value FROM settings WHERE key = 'password_hash'").first()).toBeNull();
    expect((await login('test-wachtwoord')).status).toBe(200);
  });

  it('sessieversie ophogen: zonder rij wordt het 2, daarna 3', async () => {
    const before = await env.DB.prepare("SELECT value FROM settings WHERE key = 'session_version'").first<{ value: string }>();
    await env.DB.prepare("DELETE FROM settings WHERE key = 'session_version'").run();
    try {
      await bumpSessionVersion(env.DB);
      expect(await sessionVersion(env.DB)).toBe('2');
      await bumpSessionVersion(env.DB);
      expect(await sessionVersion(env.DB)).toBe('3');
    } finally {
      await setSetting(env.DB, 'session_version', before?.value ?? null);
    }
  });

  it('verifyPassword weigert een ander wachtwoord en een kapotte hash', async () => {
    const h = await hashPassword('goed-wachtwoord');
    expect(h).toMatch(/^pbkdf2\$100000\$[^$]+\$[^$]+$/);
    expect(await verifyPassword('goed-wachtwoord', h)).toBe(true);
    expect(await verifyPassword('fout-wachtwoord', h)).toBe(false);
    for (const bad of ['', 'x', 'pbkdf2$100000$$', 'pbkdf2$1$AAAA$AAAA', 'pbkdf2$100000$!!!$???', h.replace('100000', '5'), `${h}$extra`]) {
      expect(await verifyPassword('goed-wachtwoord', bad)).toBe(false);
    }
  });
});
