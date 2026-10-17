import type { Env } from './index';
import { hashKey } from './keys';
import { verifyPassword } from './password';
import { setSetting, type Prefs } from './prefs';

const enc = new TextEncoder();
const DAY_MS = 86_400_000;
export const SESSION_DAYS = 30;
export const COOKIE = 'tick_session';

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Een in de app gezet wachtwoord (hash) gaat voor; zonder hash geldt LOGIN_PASSWORD (ook de noodroute). */
export async function passwordOk(env: Env, prefs: Prefs, password: string): Promise<boolean> {
  if (prefs.passwordHash) return verifyPassword(password, prefs.passwordHash);
  if (!env.LOGIN_PASSWORD) return false; // fail closed
  // Vergelijk via hash zodat lengte niet uitlekt.
  const [a, b] = await Promise.all([hmac('pw', password), hmac('pw', env.LOGIN_PASSWORD)]);
  return safeEqual(a, b);
}

/** Statement dat de sessieversie ophoogt (voor een batch); zonder rij (versie 1) wordt het 2. */
export function bumpSessionVersionStmt(db: D1Database): D1PreparedStatement {
  return db.prepare("INSERT INTO settings (key, value) VALUES ('session_version', '2') "
    + 'ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(settings.value AS INTEGER) + 1 AS TEXT)');
}

/** Hoogt de sessieversie op (logt alle bestaande sessies uit); maakt de rij aan als hij ontbreekt. */
export async function bumpSessionVersion(db: D1Database): Promise<void> {
  await bumpSessionVersionStmt(db).run();
}

/** Huidige sessieversie uit `settings`; ophogen logt alle sessies uit. */
export async function sessionVersion(db: D1Database): Promise<string> {
  const r = await db.prepare("SELECT value FROM settings WHERE key = 'session_version'").first<{ value: string }>();
  return r?.value ?? '1';
}

export async function sessionCookie(env: Env): Promise<string> {
  const payload = `${Date.now() + SESSION_DAYS * DAY_MS}.${await sessionVersion(env.DB)}`;
  const token = `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
  return `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86_400}; HttpOnly; Secure; SameSite=Lax`;
}

export const clearCookie = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

/** Wie de request doet. `inbox` mag alleen POST /api/inbox; `renew` vraagt om een verse sessiecookie. */
export type Auth =
  | { kind: 'dev' }
  | { kind: 'token'; keyId: string }
  | { kind: 'inbox'; keyId: string }
  | { kind: 'session'; renew: boolean };

async function session(req: Request, env: Env, prefs: Prefs): Promise<Auth | null> {
  if (!env.SESSION_SECRET) return null;
  const token = req.headers.get('cookie')?.match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`))?.[1];
  if (!token) return null;
  const [exp, version, sig, ...rest] = token.split('.');
  if (!exp || !version || !sig || rest.length) return null;
  const left = Number(exp) - Date.now();
  if (!(left > 0)) return null;
  if (!safeEqual(sig, await hmac(env.SESSION_SECRET, `${exp}.${version}`))) return null;
  if (version !== prefs.sessionVersion) return null;
  // Sliding renewal: na de helft van de looptijd krijgt de browser een nieuwe cookie.
  return { kind: 'session', renew: left < (SESSION_DAYS * DAY_MS) / 2 };
}

const USED_EVERY_MS = 3_600_000;

/** Zoekt een sleutel uit de app op zijn hash (unieke index) en markeert hem hoogstens eens per uur als gebruikt. */
async function keyFromDb(env: Env, key: string): Promise<Auth | null> {
  const row = await env.DB.prepare('SELECT id, kind, last_used_at FROM api_keys WHERE hash = ?').bind(await hashKey(key))
    .first<{ id: string; kind: 'full' | 'inbox'; last_used_at: string | null }>();
  if (!row) return null;
  // Alleen schrijven als het nodig is: anders kost elke request met een sleutel een D1-schrijfactie.
  if (!(Date.parse(row.last_used_at ?? '') >= Date.now() - USED_EVERY_MS)) {
    try {
      await env.DB.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').bind(new Date().toISOString(), row.id).run();
    } catch (e) {
      console.warn('last_used_at bijwerken mislukt', e);
    }
  }
  return row.kind === 'inbox' ? { kind: 'inbox', keyId: row.id } : { kind: 'token', keyId: row.id };
}

/** Gebruik van een oude secret staat in `settings`; een mislukte schrijfactie mag het verzoek niet breken. */
async function touchEnv(env: Env, key: string, last: string | null): Promise<void> {
  if (last && Date.parse(last) > Date.now() - USED_EVERY_MS) return;
  try {
    await setSetting(env.DB, key, new Date().toISOString());
  } catch (e) {
    console.warn('gebruik van oude sleutel bijwerken mislukt', e);
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

export async function authorize(req: Request, env: Env, prefs: Prefs): Promise<Auth | null> {
  // Alleen lokaal: op een echte host doet DEV_AUTH_BYPASS niets, ook als hij per ongeluk gezet is.
  if (env.DEV_AUTH_BYPASS === '1' && LOCAL_HOSTS.has(new URL(req.url).hostname)) return { kind: 'dev' };
  const bearer = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (bearer) {
    // Sleutels uit de app beginnen met tick_; oude secrets niet, die slaan de query over.
    if (bearer.startsWith('tick_')) {
      const found = await keyFromDb(env, bearer);
      if (found) return found;
    }
    if (env.API_TOKEN && !prefs.envApiTokenOff && safeEqual(bearer, env.API_TOKEN)) {
      await touchEnv(env, 'env_api_token_used', prefs.envApiTokenUsed);
      return { kind: 'token', keyId: 'env-api' };
    }
    if (env.INBOX_TOKEN && !prefs.envInboxTokenOff && safeEqual(bearer, env.INBOX_TOKEN)) {
      await touchEnv(env, 'env_inbox_token_used', prefs.envInboxTokenUsed);
      return { kind: 'inbox', keyId: 'env-inbox' };
    }
  }
  return session(req, env, prefs);
}
