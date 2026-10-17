import { buildPushHTTPRequest } from '@pushforge/builder';
import { describe, expect, it } from 'vitest';
import { generateVapid } from '../scripts/gen-vapid.mjs';

const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Een nep-abonnement zoals een browser het maakt: een eigen ECDH-sleutel en 16 bytes auth. */
async function fakeSubscription() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
  return { endpoint: 'https://push.example.com/abc', keys: { p256dh: b64u(raw), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } };
}

describe('generateVapid', () => {
  it('maakt een sleutelpaar dat pushforge accepteert', async () => {
    const { publicKey, privateJwk } = await generateVapid();
    expect(publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/);
    expect(privateJwk).toMatchObject({ kty: 'EC', crv: 'P-256' });
    expect(typeof privateJwk.d).toBe('string');
    const req = await buildPushHTTPRequest({
      privateJWK: privateJwk,
      subscription: await fakeSubscription(),
      message: { payload: { title: 'x' }, adminContact: 'mailto:a@example.com' },
    });
    expect(req.endpoint).toBe('https://push.example.com/abc');
  });

  it('elke keer een ander paar', async () => {
    expect((await generateVapid()).publicKey).not.toBe((await generateVapid()).publicKey);
  });
});
