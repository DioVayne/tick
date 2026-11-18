import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import worker, { type Env } from '../src/index';
import { translate } from '../public/i18n.js';
import { BASE, createUser, openEnv, randomIp, session } from './helpers';

// Beheerpagina: een knop die één testbericht aan de eigenaar stuurt (Telegram, of anders een push), zonder grens per uur.
const tg: Env = { ...openEnv, TELEGRAM_BOT_TOKEN: 'geheim-token-123', TELEGRAM_CHAT_ID: '4242' };

async function raw(e: Env, path: string, o: { method?: string; cookie?: string; origin?: string | null } = {}) {
  const headers = new Headers({ 'cf-connecting-ip': randomIp(), 'accept-language': 'nl', accept: 'text/html' });
  if (o.cookie) headers.set('cookie', o.cookie);
  if (o.origin !== null) headers.set('origin', o.origin ?? BASE);
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(BASE + path, { method: o.method ?? 'GET', headers, redirect: 'manual' }), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const test = (e: Env, o: { cookie?: string; origin?: string | null } = {}) => raw(e, '/admin/owner-test', { method: 'POST', cookie: o.cookie ?? admin, origin: o.origin });

let admin: string;
let fetchSpy: MockInstance<typeof fetch>;
let telegramStatus = 200;
beforeAll(async () => { admin = await session(); });
beforeEach(() => {
  telegramStatus = 200;
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
    new Response('{}', { status: String(url).startsWith('https://api.telegram.org/') ? telegramStatus : 200 }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const telegramCalls = () => fetchSpy.mock.calls.filter(([url]) => String(url).startsWith('https://api.telegram.org/'));

describe('testbericht aan de eigenaar', () => {
  it('stuurt via Telegram naar de chat-id en meldt dat op de pagina', async () => {
    const res = await test(tg);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/reports?test=telegram');
    expect(telegramCalls()).toHaveLength(1);
    const body = JSON.parse(String((telegramCalls()[0][1] as RequestInit).body));
    expect(body.chat_id).toBe('4242');
    expect(['en', 'nl'].map((l) => translate(l, 'owner.test'))).toContain(body.text);
  });

  it('twee keer na elkaar: twee berichten (geen grens per uur)', async () => {
    await test(tg);
    await test(tg);
    expect(telegramCalls()).toHaveLength(2);
  });

  it('Telegram weigert → de pagina zegt dat het mislukt is', async () => {
    telegramStatus = 401;
    const res = await test(tg);
    expect(res.headers.get('location')).toBe('/admin/reports?test=failed');
  });

  it('zonder Telegram-instellingen → een pushmelding, geen Telegram', async () => {
    const res = await test(openEnv);
    expect(res.headers.get('location')).toBe('/admin/reports?test=push');
    expect(telegramCalls()).toHaveLength(0);
  });

  it('alleen de beheerder, en alleen vanaf Tick zelf', async () => {
    const u = await createUser();
    expect((await test(tg, { cookie: u.cookie })).status).toBe(403);
    expect((await test(tg, { origin: null })).status).toBe(403);
    expect((await test(tg, { origin: 'https://evil.test' })).status).toBe(403);
    expect(telegramCalls()).toHaveLength(0);
  });

  it('de meldingenpagina toont de knop, waar het heen gaat en de uitkomst', async () => {
    const page = await (await raw(tg, '/admin/reports?test=telegram', { cookie: admin })).text();
    expect(page).toContain('action="/admin/owner-test"');
    expect(page).toContain(translate('nl', 'admin.owner_test'));
    expect(page).toContain(translate('nl', 'admin.owner_via_telegram'));
    expect(page).toContain(translate('nl', 'admin.owner_sent_telegram'));
    const plain = await (await raw(openEnv, '/admin/reports', { cookie: admin })).text();
    expect(plain).toContain(translate('nl', 'admin.owner_via_push'));
    expect(plain).not.toContain(translate('nl', 'admin.owner_sent_telegram'));
  });
});
