import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ADMIN_ID, BASE, call, callAs, createUser, json, login, randomIp, session } from './helpers';
import { createLink, linkValid } from '../src/links';

// Wachtwoord wijzigen, elders uitloggen en een wachtwoord herstellen via een link trekken ook de openstaande
// toegang in: verhuiscodes (een volledige export zonder inlog) en ongebruikte herstellinks.
type User = Awaited<ReturnType<typeof createUser>>;

const post = (u: User, path: string, body: unknown = {}) => callAs(u.cookie, path, { method: 'POST', json: body });
const moveCode = async (u: User) => {
  const res = await post(u, '/api/move/code');
  expect(res.status).toBe(201);
  return (await json<{ code: string }>(res)).code.slice(BASE.length);
};
const moveOut = (path: string) => call(path, { auth: null, headers: { 'cf-connecting-ip': randomIp() } });
const resetLink = async (u: User) => (await createLink(env.DB, 'reset', ADMIN_ID, u.id)).code;
const version = async (id: string) => (await env.DB.prepare('SELECT session_version AS v FROM users WHERE id = ?').bind(id).first<{ v: number }>())!.v;

/** Maakt een verhuiscode en een herstellink, voert `act` uit en geeft terug of ze daarna nog werken. */
async function stillValid(u: User, act: () => Promise<Response>) {
  const code = await moveCode(u);
  const reset = await resetLink(u);
  expect((await moveOut(code)).status).toBe(200);
  expect(await linkValid(env.DB, 'reset', reset)).toBe(true);
  expect((await act()).status).toBe(200);
  return { move: (await moveOut(code)).status === 200, reset: await linkValid(env.DB, 'reset', reset) };
}

describe('toegang intrekken', () => {
  it('wachtwoord wijzigen: verhuiscode en herstellinks vervallen', async () => {
    const u = await createUser();
    expect(await stillValid(u, () => post(u, '/api/account/password', { current: u.password, next: 'nieuw-wachtwoord' })))
      .toEqual({ move: false, reset: false });
  });

  it('uitloggen op andere apparaten: verhuiscode en herstellinks vervallen', async () => {
    const u = await createUser();
    expect(await stillValid(u, () => post(u, '/api/account/logout-others'))).toEqual({ move: false, reset: false });
  });

  it('herstellen via een link: de andere herstellinks en de verhuiscode vervallen', async () => {
    const u = await createUser();
    const used = await resetLink(u);
    expect(await stillValid(u, () => call(`/reset/${used}`, { method: 'POST', auth: null, headers: { 'cf-connecting-ip': randomIp() }, json: { password: 'nieuw-wachtwoord' } })))
      .toEqual({ move: false, reset: false });
  });

  it('alleen van dit account: de verhuiscode en herstellink van een ander blijven geldig', async () => {
    const u = await createUser();
    const other = await createUser();
    const code = await moveCode(other);
    const reset = await resetLink(other);
    expect((await post(u, '/api/account/logout-others')).status).toBe(200);
    expect((await moveOut(code)).status).toBe(200);
    expect(await linkValid(env.DB, 'reset', reset)).toBe(true);
  });

  it('een bevestigingslink blijft geldig', async () => {
    const u = await createUser();
    const { code } = await createLink(env.DB, 'verify', u.id, u.id);
    expect((await post(u, '/api/account/logout-others')).status).toBe(200);
    expect(await linkValid(env.DB, 'verify', code)).toBe(true);
  });

  it('alles of niets: mislukt het intrekken, dan blijven wachtwoord en sessies zoals ze waren', async () => {
    const u = await createUser();
    const before = await version(u.id);
    const code = await moveCode(u);
    const db = env.DB;
    await db.prepare("CREATE TRIGGER IF NOT EXISTS test_geen_code_weg BEFORE DELETE ON move_codes BEGIN SELECT RAISE(ABORT, 'test'); END").run();
    try {
      expect((await post(u, '/api/account/password', { current: u.password, next: 'nieuw-wachtwoord' })).status).toBe(500);
      expect((await post(u, '/api/account/logout-others')).status).toBe(500);
    } finally {
      await db.prepare('DROP TRIGGER IF EXISTS test_geen_code_weg').run();
    }
    expect(await version(u.id)).toBe(before);
    expect((await login(u.password, randomIp(), u.email)).status).toBe(200);
    expect((await moveOut(code)).status).toBe(200);
  });
});

describe('e-mailadres wijzigen vraagt het huidige wachtwoord', () => {
  const patch = (cookie: string, body: unknown) => callAs(cookie, '/api/account', { method: 'PATCH', json: body });
  const emailOf = async (id: string) => (await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(id).first<{ email: string | null }>())!.email;

  it('zonder of met een fout wachtwoord: 403 err.wrong_password, adres ongewijzigd', async () => {
    const u = await createUser();
    const next = `nieuw-${crypto.randomUUID()}@example.test`;
    for (const body of [{ email: next }, { email: next, password: 'fout-wachtwoord' }, { email: next, password: 42 }]) {
      const res = await patch(u.cookie, body);
      expect(res.status).toBe(403);
      expect(await json(res)).toMatchObject({ key: 'err.wrong_password' });
    }
    expect(await emailOf(u.id)).toBe(u.email);
  });

  it('met het goede wachtwoord: gewijzigd', async () => {
    const u = await createUser();
    const next = `nieuw-${crypto.randomUUID()}@example.test`;
    expect((await patch(u.cookie, { name: 'Bram', email: next, password: u.password })).status).toBe(200);
    expect(await emailOf(u.id)).toBe(next);
  });

  it('naam wijzigen, hetzelfde adres opnieuw opslaan of alleen hoofdletters: geen wachtwoord nodig', async () => {
    const u = await createUser();
    expect((await patch(u.cookie, { name: 'Bram' })).status).toBe(200);
    expect((await patch(u.cookie, { name: 'Bram', email: ` ${u.email} ` })).status).toBe(200);
    expect((await patch(u.cookie, { email: u.email.toUpperCase() })).status).toBe(200);
    expect(await emailOf(u.id)).toBe(u.email.toUpperCase());
  });

  it('een ongeldig adres geeft eerst 400, ook zonder wachtwoord', async () => {
    const u = await createUser();
    expect((await patch(u.cookie, { email: 'geen-adres' })).status).toBe(400);
  });

  it('de beheerder zonder eigen wachtwoord gebruikt LOGIN_PASSWORD', async () => {
    const admin = await session();
    const next = `beheer-${crypto.randomUUID()}@example.test`;
    expect((await patch(admin, { email: next, password: 'fout' })).status).toBe(403);
    expect((await patch(admin, { email: next, password: 'test-wachtwoord' })).status).toBe(200);
    expect(await emailOf(ADMIN_ID)).toBe(next);
  });
});
