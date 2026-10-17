import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { authorize } from '../src/auth';
import { hashKey } from '../src/keys';
import { loadInstallPrefs } from '../src/prefs';
import { ADMIN_ID, call, callAs, createUser, json, login, randomIp, session } from './helpers';

afterEach(async () => {
  await env.DB.prepare('UPDATE users SET email = NULL, password_hash = NULL WHERE id = ?').bind(ADMIN_ID).run();
  await env.DB.prepare("DELETE FROM api_keys WHERE id IN ('inloggen-oud', 'inloggen-weg')").run();
});

/** Geldig ondertekende cookie met een zelf gekozen payload. */
async function signed(payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode('test-sessie-geheim'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
  return `tick_session=${payload}.${[...sig].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const insertKey = async (id: string, key: string, userId?: string) => {
  const cols = userId ? 'id, name, kind, hash, hint, created_at, user_id' : 'id, name, kind, hash, hint, created_at';
  const marks = userId ? '?, ?, ?, ?, ?, ?, ?' : '?, ?, ?, ?, ?, ?';
  const values: unknown[] = [id, 'Test', 'full', await hashKey(key), key.slice(-4), new Date().toISOString()];
  if (userId) values.push(userId);
  await env.DB.prepare(`INSERT INTO api_keys (${cols}) VALUES (${marks})`).bind(...values).run();
};

describe('inloggen met e-mailadres', () => {
  it('leeg e-mailadres + wachtwoord logt in als beheerder zolang die geen e-mailadres heeft', async () => {
    expect((await login('test-wachtwoord')).status).toBe(200);
  });

  it('heeft de beheerder een e-mailadres, dan is het veld verplicht (hoofdletters maken niet uit)', async () => {
    await env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind('dio@example.com', ADMIN_ID).run();
    expect((await login('test-wachtwoord')).status).toBe(401);
    expect((await login('test-wachtwoord', randomIp(), 'DIO@example.com')).status).toBe(200);
    expect((await login('test-wachtwoord', randomIp(), '  dio@example.com ')).status).toBe(200);
  });

  it('de inlogpagina toont de hint voor een leeg e-mailadres alleen zolang de beheerder er geen heeft', async () => {
    const page = () => call('/login', { auth: null, headers: { 'accept-language': 'nl' } }).then((r) => r.text());
    expect(await page()).toContain('Beheerder en nog geen e-mailadres ingesteld? Laat het e-mailveld leeg.');
    await env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind('beheer@example.com', ADMIN_ID).run();
    expect(await page()).not.toContain('Beheerder en nog geen e-mailadres');
  });

  it('een lid logt in met e-mailadres; onbekend adres en fout wachtwoord geven dezelfde fout', async () => {
    const b = await createUser({ password: 'lid-wachtwoord' });
    expect((await callAs(b.cookie, '/api/tasks')).status).toBe(200);
    const wrongRes = await login('fout', randomIp(), b.email);
    const unknownRes = await login('lid-wachtwoord', randomIp(), 'niemand@example.test');
    expect(wrongRes.status).toBe(401);
    expect(unknownRes.status).toBe(401);
    const wrong = await json<{ error: string }>(wrongRes);
    const unknown = await json<{ error: string }>(unknownRes);
    expect(wrong.error).toBe(unknown.error);
    expect(wrong.error).toBe('Unknown email address or wrong password.');
  });

  it('LOGIN_PASSWORD geldt niet voor een lid zonder wachtwoord', async () => {
    const b = await createUser();
    await env.DB.prepare('UPDATE users SET password_hash = NULL WHERE id = ?').bind(b.id).run();
    expect((await login('test-wachtwoord', randomIp(), b.email)).status).toBe(401);
  });

  it('de cookie bevat de gebruiker; een oude cookie zonder gebruiker is ongeldig', async () => {
    expect((await login('test-wachtwoord')).headers.get('set-cookie')).toMatch(/^tick_session=\d+\.[0-9a-f-]{36}\.\d+\.[0-9a-f]{64};/);
    const exp = Date.now() + 86_400_000;
    // Controle: dezelfde opbouw met gebruiker werkt wel.
    expect((await callAs(await signed(`${exp}.${ADMIN_ID}.1`), '/api/tasks')).status).toBe(200);
    expect((await callAs(await signed(`${exp}.1`), '/api/tasks')).status).toBe(401);
    // Een cookie voor een gebruiker die niet bestaat.
    expect((await callAs(await signed(`${exp}.${crypto.randomUUID()}.1`), '/api/tasks')).status).toBe(401);
  });

  it('op andere toestellen uitloggen raakt alleen jezelf', async () => {
    const a1 = await session(); const a2 = await session(); const b = await createUser();
    const res = await callAs(a1, '/api/account/logout-others', { method: 'POST', json: {} });
    expect(res.status).toBe(200);
    try {
      expect((await callAs(a2, '/api/tasks')).status).toBe(401);
      expect((await callAs(b.cookie, '/api/tasks')).status).toBe(200);
      expect((await callAs(res.headers.get('set-cookie')!.split(';')[0], '/api/tasks')).status).toBe(200);
    } finally {
      await env.DB.prepare('UPDATE users SET session_version = 1 WHERE id = ?').bind(ADMIN_ID).run();
    }
  });

  it('API_TOKEN, INBOX_TOKEN en een sleutel van vóór de update horen bij de beheerder', async () => {
    const install = await loadInstallPrefs(env);
    const req = (bearer: string) => new Request('https://tick.test/api/tasks', { headers: { authorization: `Bearer ${bearer}` } });
    expect(await authorize(req('test-token'), env, install)).toMatchObject({ kind: 'token', keyId: 'env-api', userId: ADMIN_ID });
    expect(await authorize(req('test-inbox-token'), env, install)).toMatchObject({ kind: 'inbox', userId: ADMIN_ID });
    await insertKey('inloggen-oud', 'tick_inloggen_oud');
    expect(await authorize(req('tick_inloggen_oud'), env, install)).toMatchObject({ kind: 'token', keyId: 'inloggen-oud', userId: ADMIN_ID });
  });

  it('een sleutel waarvan de gebruiker niet meer bestaat geeft 401', async () => {
    await insertKey('inloggen-weg', 'tick_weg', 'weg');
    expect((await call('/api/tasks', { auth: 'Bearer tick_weg' })).status).toBe(401);
  });

  it('inloggen werkt last_seen bij', async () => {
    const b = await createUser();
    expect((await env.DB.prepare('SELECT last_seen FROM users WHERE id = ?').bind(b.id).first<{ last_seen: string }>())!.last_seen).toBeTruthy();
  });
});
