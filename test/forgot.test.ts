import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { ADMIN_ID, BASE, createUser, randomIp, untilRateLimited } from './helpers';
import { translate } from '../public/i18n.js';
import type { Env } from '../src/index';

const mailEnv: Env = { ...env, RESEND_API_KEY: 'test-resend', MAIL_FROM: 'Tick <noreply@ticktodo.nl>' };

/** Een verzoek met eigen env; wacht ook op het werk op de achtergrond (waitUntil). */
async function req(path: string, o: { method?: string; json?: unknown; lang?: string; ip?: string; e?: Env } = {}) {
  const headers = new Headers({ 'cf-connecting-ip': o.ip ?? randomIp(), 'accept-language': o.lang ?? 'en', accept: 'text/html' });
  if (o.json !== undefined) headers.set('content-type', 'application/json');
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(BASE + path, { method: o.method ?? 'GET', headers, body: o.json === undefined ? undefined : JSON.stringify(o.json) }), o.e ?? mailEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const forgot = (email: unknown, o: { lang?: string; ip?: string; e?: Env } = {}) => req('/forgot', { ...o, method: 'POST', json: { email } });

/** Nagebootste Resend: geeft de verstuurde mails terug. */
function resend(status = 200) {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"id":"x"}', { status }));
  return () => spy.mock.calls
    .filter(([url]) => String(url) === 'https://api.resend.com/emails')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as { to: string[]; subject: string; text: string; html: string });
}

afterEach(() => vi.restoreAllMocks());

describe('zonder mailinstellingen', () => {
  it('geen link op de inlogpagina en /forgot bestaat niet', async () => {
    expect(await (await req('/login', { e: env })).text()).not.toContain('href="/forgot"');
    expect((await req('/forgot', { e: env })).status).toBe(404);
    expect((await forgot('a@example.test', { e: env })).status).toBe(404);
  });
});

describe('wachtwoord vergeten', () => {
  it('link op de inlogpagina en een pagina in de taal van het verzoek', async () => {
    expect(await (await req('/login')).text()).toContain('href="/forgot"');
    const page = await req('/forgot', { lang: 'nl' });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(translate('nl', 'forgot.title'));
    expect(html).toContain('src="/forgot.js"');
    // De melding na verzenden zegt (voor ieder adres gelijk) dat een nieuwe link pas na 5 minuten kan.
    expect(translate('nl', 'forgot.sent')).toContain('5 minuten');
    expect(translate('en', 'forgot.sent')).toContain('5 minutes');
  });

  it('een lid krijgt een werkende herstellink, ook met hoofdletters en spaties in het adres', async () => {
    const sent = resend(); const u = await createUser();
    const res = await forgot(` ${u.email.toUpperCase()} `);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const mails = sent();
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toEqual([u.email]);
    const path = /https:\/\/tick\.test(\/reset\/[A-Za-z0-9_-]+)/.exec(mails[0].text)?.[1];
    expect(path).toBeTruthy();
    vi.restoreAllMocks();
    expect((await req(path!, { method: 'POST', json: { password: 'nieuw12345' } })).status).toBe(200);
  });

  it('een adres met een plusteken werkt ook', async () => {
    const sent = resend(); const u = await createUser({ email: `ik+${crypto.randomUUID().slice(0, 8)}@example.test` });
    expect((await forgot(u.email)).status).toBe(200);
    expect(sent().map((m) => m.to[0])).toEqual([u.email]);
  });

  it('onbekend adres en het adres van een beheerder: zelfde antwoord, geen mail', async () => {
    const sent = resend();
    await env.DB.prepare("UPDATE users SET email = 'baas@example.test' WHERE id = ?").bind(ADMIN_ID).run();
    try {
      for (const email of ['niemand@example.test', 'baas@example.test']) {
        const res = await forgot(email);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
      }
      expect(sent()).toHaveLength(0);
    } finally {
      await env.DB.prepare('UPDATE users SET email = NULL WHERE id = ?').bind(ADMIN_ID).run();
    }
  });

  it('een ongeldig adres geeft 400', async () => {
    expect((await forgot('geen-adres')).status).toBe(400);
  });

  it('een tweede aanvraag binnen 5 minuten mailt niet nog eens', async () => {
    const sent = resend(); const u = await createUser();
    expect((await forgot(u.email)).status).toBe(200);
    expect((await forgot(u.email)).status).toBe(200);
    expect(sent()).toHaveLength(1);
  });

  it('mislukt Resend, dan telt de aanvraag niet mee', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const u = await createUser();
    resend(500);
    expect((await forgot(u.email)).status).toBe(200);
    vi.restoreAllMocks();
    const sent = resend();
    await forgot(u.email);
    expect(sent()).toHaveLength(1);
  });

  it('de mail is in de taal van het verzoek', async () => {
    const sent = resend(); const u = await createUser();
    await forgot(u.email, { lang: 'nl' });
    expect(sent()[0].subject).toBe(translate('nl', 'mail.reset_subject'));
  });

  it('daggrens: geen mail meer en één melding aan de beheerder', async () => {
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE kind <> 'cap_notice' AND sent_at >= ?")
      .bind(start.toISOString()).first<{ n: number }>();
    const e: Env = { ...mailEnv, MAIL_DAILY_LIMIT: String(today!.n + 1) };
    await env.DB.prepare("INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, 'fallback_webhook', 'https://hook.invalid/beheer')").bind(ADMIN_ID).run();
    const sent = resend(); const spy = vi.mocked(globalThis.fetch);
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    await forgot(a.email, { e });
    await forgot(b.email, { e });
    await forgot(c.email, { e });
    expect(sent().map((m) => m.to[0])).toEqual([a.email]);
    const notices = await env.DB.prepare("SELECT COUNT(*) AS n FROM mail_log WHERE kind = 'cap_notice' AND sent_at >= ?")
      .bind(start.toISOString()).first<{ n: number }>();
    expect(notices!.n).toBe(1);
    // De beheerder kreeg de melding (zonder pushabonnement via zijn fallback-webhook), precies één keer.
    const hooks = spy.mock.calls.filter(([url]) => String(url) === 'https://hook.invalid/beheer');
    expect(hooks).toHaveLength(1);
    expect(JSON.parse(String((hooks[0][1] as RequestInit).body))).toMatchObject({ title: translate('en', 'mail.cap_title') });
    await env.DB.prepare("DELETE FROM user_settings WHERE user_id = ? AND key = 'fallback_webhook'").bind(ADMIN_ID).run();
  });

  it('rem per IP', async () => {
    resend();
    const ip = randomIp();
    const tries = await untilRateLimited(() => forgot('niemand@example.test', { ip }));
    expect(tries.at(-1)!.status).toBe(429);
  });
});
