import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { bumpSessionVersion, dummyVerify, passwordOk } from '../src/auth';
import { hashPassword, verifyPassword } from '../src/password';
import type { Env } from '../src/index';
import type { User } from '../src/users';
import { ADMIN_ID, call, login, randomIp, session } from './helpers';

const setAdminHash = (hash: string | null) => env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, ADMIN_ID).run();
const adminVersion = async () => (await env.DB.prepare('SELECT session_version FROM users WHERE id = ?').bind(ADMIN_ID).first<{ session_version: number }>())!.session_version;

afterEach(async () => {
  await env.DB.prepare('UPDATE users SET password_hash = NULL, session_version = 1 WHERE id = ?').bind(ADMIN_ID).run();
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
    await setAdminHash(await hashPassword('ander-wachtwoord'));
    expect((await login('test-wachtwoord')).status).toBe(401);
    expect((await login('ander-wachtwoord')).status).toBe(200);
    await setAdminHash(null);
    expect((await login('test-wachtwoord')).status).toBe(200);
  });

  it('met password_hash werkt inloggen ook zonder LOGIN_PASSWORD', async () => {
    const admin: Pick<User, 'role' | 'password_hash'> = { role: 'admin', password_hash: null };
    const e = { ...env, LOGIN_PASSWORD: '' } as Env;
    expect(await passwordOk(e, admin, 'x')).toBe(false);
    expect(await passwordOk(e, { ...admin, password_hash: await hashPassword('x') }, 'x')).toBe(true);
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
      db.prepare("CREATE TRIGGER IF NOT EXISTS test_geen_versie_upd BEFORE UPDATE OF session_version ON users BEGIN SELECT RAISE(ABORT, 'test'); END"),
    ]);
    try {
      expect((await post('/api/account/password', a, { current: 'test-wachtwoord', next: 'nieuw-wachtwoord' })).status).toBe(500);
    } finally {
      await db.prepare('DROP TRIGGER IF EXISTS test_geen_versie_upd').run();
    }
    expect(await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(ADMIN_ID).first()).toEqual({ password_hash: null });
    expect((await login('test-wachtwoord')).status).toBe(200);
  });

  it('sessieversie ophogen: users.session_version van de beheerder gaat met 1 omhoog', async () => {
    const before = await adminVersion();
    await bumpSessionVersion(env.DB, ADMIN_ID);
    expect(await adminVersion()).toBe(before + 1);
    await bumpSessionVersion(env.DB, ADMIN_ID);
    expect(await adminVersion()).toBe(before + 2);
    // terugzetten gebeurt in afterEach
  });

  it('een verlengbare sessie houdt na elders uitloggen en wachtwoord wijzigen de verse cookie', async () => {
    // Nog 10 dagen geldig: de middleware wil verlengen, maar de route zet zelf al een cookie met de nieuwe versie.
    const renewable = async () => {
      const exp = Date.now() + 10 * 86_400_000;
      const payload = `${exp}.${ADMIN_ID}.${await adminVersion()}`;
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey('raw', enc.encode('test-sessie-geheim'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
      return `tick_session=${payload}.${[...sig].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    };
    const lastCookie = (res: Response) => res.headers.getSetCookie().filter((h) => h.startsWith('tick_session=')).at(-1)!.split(';')[0];
    expect((await tasks(await renewable())).headers.get('set-cookie')).toContain('tick_session='); // controle: hij verlengt wel

    const out = await post('/api/account/logout-others', await renewable());
    expect(out.status).toBe(200);
    expect(out.headers.getSetCookie().filter((h) => h.startsWith('tick_session='))).toHaveLength(1);
    expect((await tasks(lastCookie(out))).status).toBe(200);

    const pw = await post('/api/account/password', await renewable(), { current: 'test-wachtwoord', next: 'nieuw-wachtwoord' });
    expect(pw.status).toBe(200);
    expect((await tasks(lastCookie(pw))).status).toBe(200);
  });

  it('dummyVerify geeft altijd false', async () => {
    expect(await dummyVerify('tick-dummy-wachtwoord')).toBe(false);
    expect(await dummyVerify('iets-anders')).toBe(false);
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
