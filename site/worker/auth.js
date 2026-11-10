// Login for /beheer (the mini-CMS of ticktodo.nl). The password is the secret ADMIN_PASSWORD.
// A session is "expiry.signature" in an HttpOnly cookie; a new password makes every session invalid.

const enc = new TextEncoder();
const SESSIE_DAGEN = 30;

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function onderteken(env, tekst) {
  const sleutel = await crypto.subtle.importKey(
    'raw', enc.encode('cms:' + env.ADMIN_PASSWORD),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', sleutel, enc.encode(tekst)));
}

// Constant-time comparison: hash both sides so the lengths are equal.
export async function gelijk(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(a))),
    crypto.subtle.digest('SHA-256', enc.encode(String(b))),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

export async function sessieCookie(env) {
  const vervalt = String(Date.now() + SESSIE_DAGEN * 864e5);
  const waarde = vervalt + '.' + (await onderteken(env, vervalt));
  return `cms=${waarde}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSIE_DAGEN * 86400}`;
}

export const uitlogCookie = 'cms=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';

export async function isIngelogd(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)cms=([^;]+)/);
  if (!m) return false;
  const [vervalt, handtekening] = m[1].split('.');
  if (!vervalt || !handtekening || Number(vervalt) < Date.now()) return false;
  return gelijk(handtekening, await onderteken(env, vervalt));
}

// Changes are only accepted from the site itself.
export function zelfdeHerkomst(request) {
  return request.headers.get('origin') === new URL(request.url).origin;
}
