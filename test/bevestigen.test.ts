import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callWith, createUser, openEnv, randomIp } from './helpers';
import { translate } from '../public/i18n.js';
import type { Env } from '../src/index';

/** Nagebootste Resend: geeft de verstuurde mails terug. */
function resend() {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"id":"x"}', { status: 200 }));
  return () => spy.mock.calls
    .filter(([url]) => String(url) === 'https://api.resend.com/emails')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as { to: string[]; subject: string; text: string; html: string });
}
const linkIn = (text: string, kind: string) => new RegExp(`https://tick\\.test(/${kind}/[A-Za-z0-9_-]+)`).exec(text)?.[1];
const verifiedAt = async (id: string) =>
  (await env.DB.prepare('SELECT email_verified_at AS v FROM users WHERE id = ?').bind(id).first<{ v: string | null }>())!.v;
const html = { accept: 'text/html' };

/** Meldt een nieuw account aan; geeft cookie, id en de verstuurde mails. */
async function signUp(e: Env = openEnv) {
  const sent = resend();
  const email = `b-${crypto.randomUUID()}@ex.test`;
  const res = await callWith(e, '/signup', { method: 'POST', json: { name: 'Bea', email, password: 'lang-genoeg-1' } });
  expect(res.status).toBe(201);
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  const row = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  return { cookie, id: row!.id, email, sent };
}

afterEach(() => vi.restoreAllMocks());

describe('bevestigen', () => {
  it('aanmelden stuurt één bevestigingsmail met een /verify/-link', async () => {
    const { sent, email } = await signUp();
    const mails = sent();
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toEqual([email]);
    expect(mails[0].subject).toBe(translate('en', 'mail.verify_subject'));
    expect(linkIn(mails[0].text, 'verify')).toBeTruthy();
  });

  it('de link werkt zonder inlog; een tweede keer of een onzincode geeft een nette melding', async () => {
    const { sent, id } = await signUp();
    const path = linkIn(sent()[0].text, 'verify')!;
    const first = await callWith(openEnv, path, html);
    expect(first.status).toBe(200);
    expect(await first.text()).toContain(translate('en', 'verify.done_title'));
    expect(await verifiedAt(id)).toBeTruthy();
    const again = await callWith(openEnv, path, html);
    expect(again.status).toBe(200);
    expect(await again.text()).toContain(translate('en', 'verify.invalid'));
    expect((await callWith(openEnv, '/verify/onzin', html)).status).toBe(200);
  });

  it('opnieuw sturen: één mail, niet twee binnen 5 minuten; al bevestigd → 400', async () => {
    const { cookie, sent } = await signUp();
    const first = await callWith(openEnv, '/api/account/verify', { method: 'POST', cookie });
    expect(first.status).toBe(200);
    await callWith(openEnv, '/api/account/verify', { method: 'POST', cookie });
    expect(sent()).toHaveLength(1); // de mail bij aanmelden; opnieuw sturen valt binnen de 5 minuten
    const u = await createUser();
    const done = await callWith(openEnv, '/api/account/verify', { method: 'POST', cookie: u.cookie });
    expect(done.status).toBe(400);
    expect(await done.json()).toEqual({ error: translate('en', 'err.already_verified') });
  });

  it('/config.js: verifyBy alleen voor een onbevestigd lid op een openbare Tick', async () => {
    const { cookie, id } = await signUp();
    const created = (await env.DB.prepare('SELECT created_at FROM users WHERE id = ?').bind(id).first<{ created_at: string }>())!.created_at;
    const cfg = await (await callWith(openEnv, '/config.js', { cookie })).text();
    expect(cfg).toContain('"openSignup":true');
    expect(cfg).toContain('"emailVerified":false');
    expect(cfg).toContain(`"verifyBy":"${new Date(Date.parse(created) + 30 * 86_400_000).toISOString()}"`);
    const u = await createUser();
    const other = await (await callWith(openEnv, '/config.js', { cookie: u.cookie })).text();
    expect(other).toContain('"emailVerified":true');
    expect(other).toContain('"verifyBy":null');
    expect(await (await callWith(env, '/config.js', { cookie: u.cookie })).text()).toContain('"openSignup":false');
  });

  it('herstel via /forgot bevestigt het adres; een resetlink van de beheerder niet', async () => {
    const { sent, id, email } = await signUp();
    await callWith(openEnv, '/forgot', { method: 'POST', json: { email } });
    const reset = linkIn(sent().at(-1)!.text, 'reset')!;
    expect((await callWith(openEnv, reset, { method: 'POST', json: { password: 'nieuw-wachtwoord-1' } })).status).toBe(200);
    expect(await verifiedAt(id)).toBeTruthy();

    const other = await signUp();
    const admin = await callWith(openEnv, `/api/users/${other.id}/reset`, { method: 'POST', cookie: await adminCookie() });
    const url = ((await admin.json()) as { url: string }).url;
    expect((await callWith(openEnv, new URL(url).pathname, { method: 'POST', json: { password: 'nieuw-wachtwoord-1' } })).status).toBe(200);
    expect(await verifiedAt(other.id)).toBeNull();
  });

  it('e-mail wijzigen op een openbare Tick maakt onbevestigd en stuurt een mail; zonder OPEN_SIGNUP niet', async () => {
    const sent = resend();
    const u = await createUser();
    const res = await callWith(openEnv, '/api/account', { method: 'PATCH', cookie: u.cookie, json: { email: `nieuw-${crypto.randomUUID()}@ex.test` } });
    expect(res.status).toBe(200);
    expect(await verifiedAt(u.id)).toBeNull();
    expect(sent()).toHaveLength(1);
    const v = await createUser();
    await callWith(env, '/api/account', { method: 'PATCH', cookie: v.cookie, json: { email: `nieuw-${crypto.randomUUID()}@ex.test` } });
    expect(await verifiedAt(v.id)).toBeTruthy();
    // Zelfde adres opnieuw opslaan (alleen de naam gewijzigd) laat de bevestiging staan.
    const w = await createUser();
    await callWith(openEnv, '/api/account', { method: 'PATCH', cookie: w.cookie, json: { name: 'Wim', email: w.email.toUpperCase() } });
    expect(await verifiedAt(w.id)).toBeTruthy();
  });
});

async function adminCookie(): Promise<string> {
  const res = await callWith(env, '/login', { method: 'POST', json: { email: '', password: 'test-wachtwoord' }, ip: randomIp() });
  return res.headers.get('set-cookie')!.split(';')[0];
}
