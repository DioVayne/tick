// Generates a VAPID key pair for web push.
// Usage: node scripts/gen-vapid.mjs
// VAPID_PUBLIC_KEY goes into "vars" in wrangler.jsonc; VAPID_PRIVATE_KEY becomes a secret:
//   npx wrangler secret put VAPID_PRIVATE_KEY   (paste the JSON on one line)

const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * New P-256 key pair: the public key as an uncompressed point (65 bytes, base64url), the private key as a JWK.
 * @returns {Promise<{ publicKey: string, privateJwk: JsonWebKey }>}
 */
export async function generateVapid() {
  const pair = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']));
  const raw = new Uint8Array(/** @type {ArrayBuffer} */ (await crypto.subtle.exportKey('raw', pair.publicKey)));
  const privateJwk = /** @type {JsonWebKey} */ (await crypto.subtle.exportKey('jwk', pair.privateKey));
  return { publicKey: b64u(raw), privateJwk };
}

// Only when run as a script, not when imported by the tests.
if (globalThis.process?.argv?.[1]?.replace(/\\/g, '/').endsWith('scripts/gen-vapid.mjs')) {
  const { publicKey, privateJwk } = await generateVapid();
  console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${JSON.stringify(privateJwk)}`);
}
