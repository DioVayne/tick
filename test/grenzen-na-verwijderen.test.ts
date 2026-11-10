import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callWith, createUser, openEnv, randomIp } from './helpers';
import type { Env } from '../src/index';
import { reserveMail } from '../src/mail';
import { sendVerifyMail } from '../src/signup';
import { deleteAccount } from '../src/users-api';

// Elke test een eigen (verre) UTC-dag, zodat de daggrenzen van de ene test de andere niet raken.
let day = Date.UTC(2032, 0, 1, 12);
const freshDay = () => { day += 10 * 86_400_000; vi.setSystemTime(day); return day; };

/** Telt de mails die naar Resend gaan. */
let mails: string[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  mails = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url) === 'https://api.resend.com/emails') mails.push(JSON.parse(String((init as RequestInit).body)).to[0]);
    return new Response('{"id":"x"}', { status: 200 });
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const signup = (e: Env, email: string) => callWith(e, '/signup', { method: 'POST', json: { name: 'A', email, password: 'lang-genoeg-1' }, ip: randomIp() });
const idOf = async (email: string) => (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>())!.id;

describe('account verwijderen zet de daggrenzen niet terug', () => {
  it('aanmeldgrens: aanmelden en verwijderen telt nog steeds mee', async () => {
    freshDay();
    const lim: Env = { ...openEnv, SIGNUP_DAILY_LIMIT: '2' };
    for (let i = 0; i < 2; i++) {
      const email = `weg-${i}-${day}@ex.test`;
      expect((await signup(lim, email)).status).toBe(201);
      await deleteAccount(lim, await idOf(email));
    }
    expect((await signup(lim, `derde-${day}@ex.test`)).status).toBe(429);
  });

  it('een geweigerde aanmelding (bestaand adres) telt niet mee', async () => {
    freshDay();
    const lim: Env = { ...openEnv, SIGNUP_DAILY_LIMIT: '1' };
    const u = await createUser();
    expect((await signup(lim, u.email)).status).toBe(409);
    expect((await signup(lim, `nieuw-${day}@ex.test`)).status).toBe(201);
  });

  it('maildaggrens: de mails van een verwijderd account tellen nog mee', async () => {
    const t = freshDay();
    const lim: Env = { ...env, MAIL_DAILY_LIMIT: '1' };
    const a = await createUser();
    expect(await reserveMail(env.DB, lim, 'reset', a.id, t)).toHaveProperty('id');
    await deleteAccount(lim, a.id);
    const row = await env.DB.prepare("SELECT user_id FROM mail_log WHERE kind = 'reset' AND sent_at = ?").bind(new Date(t).toISOString()).first();
    expect(row).toEqual({ user_id: null });
    expect(await reserveMail(env.DB, lim, 'reset', (await createUser()).id, t)).toBe('daily_limit');
  });

  it('aanmeldingen tellen niet als mail', async () => {
    const t = freshDay();
    const noMail: Env = { ...openEnv, RESEND_API_KEY: '' };
    expect((await signup(noMail, `zonder-mail-${day}@ex.test`)).status).toBe(201);
    expect(await reserveMail(env.DB, { ...env, MAIL_DAILY_LIMIT: '1' }, 'reset', (await createUser()).id, t)).toHaveProperty('id');
  });
});

describe('bevestigingsmails', () => {
  it('hooguit de helft van de maildaggrens, zodat herstelmails ruimte houden', async () => {
    const t = freshDay();
    const lim: Env = { ...openEnv, MAIL_DAILY_LIMIT: '4' };
    for (let i = 0; i < 3; i++) await sendVerifyMail(lim, (await createUser({ verified: false })).id, 'https://tick.test', 'en');
    expect(mails).toHaveLength(2);
    expect(await reserveMail(env.DB, lim, 'reset', (await createUser()).id, t)).toHaveProperty('id');
  });

  it('hooguit één per adres per 24 uur, ook na verwijderen en opnieuw aanmelden', async () => {
    freshDay();
    const email = `slachtoffer-${day}@ex.test`;
    expect((await signup(openEnv, email)).status).toBe(201);
    await deleteAccount(openEnv, await idOf(email));
    expect((await signup(openEnv, email)).status).toBe(201);
    expect(mails).toEqual([email]);
  });
});
