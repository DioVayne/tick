import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ADMIN_ID, callWith, openEnv, randomIp } from './helpers';
import type { Env } from '../src/index';
import { reserveMail } from '../src/mail';
import { deliverQueued, enqueueMail } from '../src/mailqueue';
import { tellOwner } from '../src/telegram';
import type { Sender } from '../src/push';

const tg: Env = { ...openEnv, TELEGRAM_BOT_TOKEN: 'geheim-token-123', TELEGRAM_CHAT_ID: '4242' };

let fetchSpy: MockInstance<typeof fetch>;
let errSpy: MockInstance<typeof console.error>;
let resendStatus = 200;
beforeEach(async () => {
  resendStatus = 200;
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (String(url) === 'https://api.resend.com/emails') return new Response('{"id":"x"}', { status: resendStatus });
    return new Response('{"ok":true}', { status: 200 });
  });
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  await env.DB.prepare('DELETE FROM mail_log').run();
  await env.DB.prepare('DELETE FROM mail_queue').run();
});
afterEach(() => vi.restoreAllMocks());

const telegramCalls = () => fetchSpy.mock.calls.filter(([url]) => String(url).startsWith('https://api.telegram.org/'));
const telegramTexts = () => telegramCalls().map(([, init]) => JSON.parse(String((init as RequestInit).body)) as { chat_id: string; text: string });

describe('tellOwner', () => {
  it('met token en chat-id: één fetch naar Telegram met de juiste chat; de token staat niet in logs', async () => {
    await tellOwner(tg, 'mail_dropped', { kind: 'verify' }, 'hour');
    expect(telegramCalls()).toHaveLength(1);
    expect(String(telegramCalls()[0][0])).toBe('https://api.telegram.org/botgeheim-token-123/sendMessage');
    expect(telegramTexts()[0].chat_id).toBe('4242');
    expect(telegramTexts()[0].text).toContain('verify');
    // een mislukte aanroep logt alleen de status
    fetchSpy.mockImplementation(async () => new Response('nee', { status: 401 }));
    await tellOwner(tg, 'signups', { count: '100' }, 'once');
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain('telegram: 401');
    expect(logged).not.toContain('geheim-token-123');
    expect(logged).not.toContain('4242');
  });

  it('Review 3: tien keer 429 binnen een uur geeft één Telegram-bericht', async () => {
    resendStatus = 429;
    const u = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, 'Lid', ?, 'x', 'member', ?)")
      .bind(u, `t-${u}@example.test`, new Date().toISOString()).run();
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) {
      const id = await enqueueMail(tg, { kind: 'reset', userId: u, ref: null, lang: 'nl', origin: 'https://tick.test' }, t0 + i * 6 * 60_000);
      await deliverQueued(tg, t0 + i * 6 * 60_000, { id });
    }
    expect(telegramCalls()).toHaveLength(1);
    expect(telegramTexts()[0].text).toMatch(/429/);
  });

  it('Review 5: zonder Telegram-instellingen een pushmelding aan de beheerder en geen fetch naar Telegram', async () => {
    const send = vi.fn<Sender>(async () => ({ ok: 1, total: 1 }));
    await tellOwner(openEnv, 'mail_dropped', { kind: 'verify' }, 'hour', Date.now(), send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toBe(ADMIN_ID);
    const payload = send.mock.calls[0][2]('en');
    expect(payload.body).toContain('verify');
    expect(telegramCalls()).toHaveLength(0);
  });

  it('een mail die definitief niet kan (422) geeft één bericht met de soort', async () => {
    resendStatus = 422;
    const u = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, 'Lid', ?, 'x', 'member', ?)")
      .bind(u, `t-${u}@example.test`, new Date().toISOString()).run();
    const id = await enqueueMail(tg, { kind: 'reset', userId: u, ref: null, lang: 'nl', origin: 'https://tick.test' });
    await deliverQueued(tg, Date.now(), { id });
    expect(telegramTexts().map((x) => x.text)).toEqual([expect.stringContaining('reset')]);
  });

  it('de wachtrij telt mee: het bericht noemt het aantal wachtende mails', async () => {
    await tellOwner(tg, 'mail_failing', { status: '429', waiting: '3' }, 'hour');
    expect(telegramTexts()[0].text).toContain('3');
    expect(telegramTexts()[0].text).toContain('429');
  });

  it('een poison-rij (opbouwen gooit) krijgt een volgende poging en een status', async () => {
    const u = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, 'Lid', ?, 'x', 'member', ?)")
      .bind(u, `t-${u}@example.test`, new Date().toISOString()).run();
    const now = Date.now();
    const id = await enqueueMail(tg, { kind: 'reset', userId: u, ref: null, lang: 'nl', origin: 'https://tick.test' }, now);
    // Een database die bij het opbouwen van de mail gooit (sendMail zelf vangt netwerkfouten op).
    const db = new Proxy(env.DB, {
      get: (t, p) => p === 'prepare'
        ? (sql: string) => { if (sql.includes("role = 'member'")) throw new Error('boom'); return t.prepare(sql); }
        : (t as unknown as Record<string | symbol, unknown>)[p],
    });
    await deliverQueued({ ...tg, DB: db }, now, { id });
    const row = await env.DB.prepare('SELECT attempts, last_status, next_try_at FROM mail_queue WHERE id = ?').bind(id).first<{ attempts: number; last_status: string; next_try_at: string }>();
    expect(row?.attempts).toBe(1);
    expect(row?.last_status).toBe('error');
    expect(Date.parse(row!.next_try_at)).toBe(now + 5 * 60_000);
  });
});

describe('mail_warn', () => {
  const day = new Date(); day.setUTCHours(12, 0, 0, 0);
  const noon = day.getTime();
  const reserve = (e: Env, i: number) => reserveMail(env.DB, e, 'x', ADMIN_ID, noon + i, { gapMs: 0, perDay: 1000 });

  it('de 70e mail van de dag geeft één bericht; de 71e niet; vlagrijen tellen niet als mail', async () => {
    for (let i = 1; i <= 69; i++) await reserve(tg, i);
    expect(telegramCalls()).toHaveLength(0);
    await reserve(tg, 70);
    expect(telegramCalls()).toHaveLength(1);
    expect(telegramTexts()[0].text).toContain('70');
    await reserve(tg, 71);
    expect(telegramCalls()).toHaveLength(1);
  });

  it('MAIL_WARN_AT stelt de drempel in; een ongeldige waarde geeft 70', async () => {
    const low: Env = { ...tg, MAIL_WARN_AT: '3' };
    await reserve(low, 1); await reserve(low, 2);
    expect(telegramCalls()).toHaveLength(0);
    await reserve(low, 3);
    expect(telegramCalls()).toHaveLength(1);
    expect(telegramTexts()[0].text).toContain('3');
    await env.DB.prepare('DELETE FROM mail_log').run();
    fetchSpy.mockClear();
    const bad: Env = { ...tg, MAIL_WARN_AT: 'veel' };
    for (let i = 1; i <= 69; i++) await reserve(bad, i);
    expect(telegramCalls()).toHaveLength(0);
    await reserve(bad, 70);
    expect(telegramCalls()).toHaveLength(1);
  });
});

describe('signups', () => {
  it('de 100e aanmelding van de dag geeft één bericht; de 101e niet', async () => {
    const ts = new Date().toISOString();
    await env.DB.batch(Array.from({ length: 98 }, () =>
      env.DB.prepare("INSERT INTO mail_log (id, kind, user_id, sent_at) VALUES (?, 'signup', NULL, ?)").bind(crypto.randomUUID(), ts)));
    const go = () => callWith(tg, '/signup', { method: 'POST', json: { name: 'A', email: `s-${crypto.randomUUID()}@example.test`, password: 'lang-genoeg-1' }, ip: randomIp() });
    expect((await go()).status).toBe(201); // 99e
    expect(telegramCalls()).toHaveLength(0);
    expect((await go()).status).toBe(201); // 100e
    expect(telegramCalls()).toHaveLength(1);
    expect(telegramTexts()[0].text).toContain('100');
    expect((await go()).status).toBe(201); // 101e
    expect(telegramCalls()).toHaveLength(1);
  });
});
