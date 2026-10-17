const ITERATIONS = 100_000;
const enc = new TextEncoder();

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

async function derive(pw: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

/** Bewaarvorm: `pbkdf2$<iteraties>$<salt b64>$<hash b64>`. */
export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(await derive(pw, salt, ITERATIONS))}`;
}

/** Geeft false (nooit een fout) bij een kapotte of onbekende opgeslagen waarde. */
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  try {
    const [scheme, iter, salt, hash, ...rest] = stored.split('$');
    if (scheme !== 'pbkdf2' || rest.length || !/^\d+$/.test(iter ?? '')) return false;
    const iterations = Number(iter);
    // Alleen de huidige iteratietelling: een andere waarde is geen formaat dat wij zelf schreven.
    if (iterations !== ITERATIONS) return false;
    const want = fromB64(hash ?? '');
    const saltBytes = fromB64(salt ?? '');
    if (want.length !== 32 || saltBytes.length !== 16) return false;
    const got = await derive(pw, saltBytes, iterations);
    let r = 0;
    for (let i = 0; i < want.length; i++) r |= want[i] ^ got[i];
    return r === 0;
  } catch {
    return false;
  }
}
