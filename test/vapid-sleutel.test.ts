import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseVapidKey, sendToAll } from '../src/push';

/** De BOM (U+FEFF) waarmee een geheim uit Windows PowerShell 5.1 kan beginnen. */
const BOM = String.fromCharCode(0xfeff);

const b64u = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Echte VAPID-sleutel (ECDSA P-256) als JWK-tekst, zoals in het geheim. */
async function vapidJwk(): Promise<string> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  return JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
}

/** Abonnement met geldige sleutels van een (nep)browser, op een eigen test-endpoint. */
async function subscribe(endpoint: string) {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const p256dh = b64u((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const auth = b64u(crypto.getRandomValues(new Uint8Array(16)));
  await env.DB.prepare('INSERT INTO push_subscriptions (endpoint,p256dh,auth,user_agent,created_at) VALUES (?,?,?,?,?)')
    .bind(endpoint, p256dh, auth, 'test', new Date().toISOString()).run();
}

afterEach(async () => {
  vi.restoreAllMocks();
  await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint LIKE 'https://push.test/%'").run();
});

describe('parseVapidKey', () => {
  it('haalt een BOM en witruimte aan begin en eind weg', () => {
    expect(parseVapidKey(BOM + '{"kty":"EC"}')).toEqual({ kty: 'EC' });
    expect(parseVapidKey('\r\n  ' + BOM + ' {"kty":"EC"} \r\n')).toEqual({ kty: 'EC' });
  });

  it('geeft null bij een lege, ontbrekende of ongeldige sleutel', () => {
    for (const raw of [undefined, '', '   ', BOM, 'geen json', '"tekst"', '[1]']) expect(parseVapidKey(raw)).toBeNull();
  });
});

describe('sendToAll en de VAPID-sleutel', () => {
  it('verstuurt ook als het geheim met een BOM begint', async () => {
    await subscribe('https://push.test/bom');
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
    const warn = vi.spyOn(console, 'warn');
    const r = await sendToAll({ ...env, VAPID_PRIVATE_KEY: `${BOM}${await vapidJwk()}\r\n` }, () => ({ title: 'Tick', body: 'x' }), 'en');
    expect(r).toEqual({ ok: 1, total: 1 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });

  it('meldt een ongeldige sleutel één keer en probeert geen enkel abonnement', async () => {
    await subscribe('https://push.test/a');
    await subscribe('https://push.test/b');
    const fetch = vi.spyOn(globalThis, 'fetch');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn');
    const r = await sendToAll({ ...env, VAPID_PRIVATE_KEY: BOM + 'kapot' }, () => ({ title: 'Tick', body: 'x' }), 'en');
    expect(r).toEqual({ ok: 0, total: 2 });
    expect(error).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0][0])).toContain('VAPID_PRIVATE_KEY');
    expect(warn).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
