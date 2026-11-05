import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_ID, callWith, createUser, openEnv, randomIp, untilRateLimited } from './helpers';
import type { Env } from '../src/index';
import { translate } from '../public/i18n.js';
import { MIN_PASSWORD } from '../src/account';

const err = (key: string, vars: Record<string, string | number> = {}) => ({ error: translate('en', key, vars) });

const html = { accept: 'text/html' };
const signup = (body: unknown, e: Env = openEnv, ip = randomIp()) => callWith(e, '/signup', { method: 'POST', json: body, ip });
const fresh = () => `nieuw-${crypto.randomUUID()}@Ex.test`;

// Resend nabootsen: aanmelden stuurt op de achtergrond een bevestigingsmail.
beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"id":"x"}', { status: 200 })); });
afterEach(() => vi.restoreAllMocks());

describe('zonder OPEN_SIGNUP', () => {
  it('geen knop op de inlogpagina en /signup bestaat niet', async () => {
    expect(await (await callWith(env, '/login', html)).text()).not.toContain('href="/signup"');
    expect((await callWith(env, '/signup', html)).status).toBe(404);
    expect((await signup({ name: 'A', email: fresh(), password: 'lang-genoeg-1' }, env)).status).toBe(404);
  });
});

describe('met OPEN_SIGNUP', () => {
  it('welkomstscherm: logo en Account aanmaken', async () => {
    const page = await (await callWith(openEnv, '/login', html)).text();
    expect(page).toContain('href="/signup"');
    expect(page).toContain('/icon.svg');
    expect((await callWith(openEnv, '/icon.svg')).status).toBe(200);
  });

  it('geen beheerdershint op het welkomstscherm (wel op een gewone Tick zonder beheerdersadres)', async () => {
    const hint = translate('en', 'login.empty_email_hint');
    expect(await (await callWith(env, '/login', html)).text()).toContain(hint);
    expect(await (await callWith(openEnv, '/login', html)).text()).not.toContain(hint);
  });

  it('de aanmeldpagina met script en link naar de privacypagina', async () => {
    const res = await callWith(openEnv, '/signup', { ...html, lang: 'nl' });
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain('src="/signup.js"');
    expect(page).toContain('href="/privacy"');
    expect((await callWith(openEnv, '/signup.js')).status).toBe(200);
  });

  it('aanmelden maakt een onbevestigd lid en logt in', async () => {
    const email = fresh();
    const res = await signup({ name: ' An ', email: ` ${email} `, password: 'lang-genoeg-1' });
    expect(res.status).toBe(201);
    const cookie = res.headers.get('set-cookie')!.split(';')[0];
    expect(cookie).toMatch(/^tick_session=/);
    const row = await env.DB.prepare('SELECT name, email, role, email_verified_at FROM users WHERE email = ?').bind(email).first();
    expect(row).toEqual({ name: 'An', email, role: 'member', email_verified_at: null });
    const me = await callWith(openEnv, '/api/account', { cookie });
    expect(me.status).toBe(200);
  });

  it('bestaand adres (ook in andere hoofdletters) → 409 en geen tweede account', async () => {
    const u = await createUser();
    const res = await signup({ name: 'B', email: u.email.toUpperCase(), password: 'lang-genoeg-1' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(err('err.email_taken'));
    expect(res.headers.get('set-cookie')).toBeNull();
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').bind(u.email).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it('te kort wachtwoord en ongeldig adres', async () => {
    expect(await (await signup({ name: 'C', email: fresh(), password: 'kort' })).json()).toEqual(err('err.password_short', { min: MIN_PASSWORD }));
    expect(await (await signup({ name: 'C', email: 'geen-adres', password: 'lang-genoeg-1' })).json()).toEqual(err('err.invalid_email'));
  });

  it('daggrens: bij de grens 429 en één melding aan de beheerder', async () => {
    const lim: Env = { ...openEnv, SIGNUP_DAILY_LIMIT: '1' };
    await createUser(); // vandaag al een lid erbij: de grens van 1 is bereikt
    const res = await signup({ name: 'D', email: fresh(), password: 'lang-genoeg-1' }, lim);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual(err('err.signup_full'));
    await signup({ name: 'D', email: fresh(), password: 'lang-genoeg-1' }, lim);
    const flags = await env.DB.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE kind = 'signup_cap'").first<{ n: number }>();
    expect(flags!.n).toBe(1);
    expect(ADMIN_ID).toBeTruthy();
  });

  it('rem per IP', async () => {
    const ip = randomIp();
    const out = await untilRateLimited(() => signup({ name: 'E', email: 'geen-adres', password: 'x' }, openEnv, ip));
    expect(out.at(-1)!.status).toBe(429);
  });
});
