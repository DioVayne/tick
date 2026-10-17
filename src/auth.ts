import type { Env } from './index';
import { hashKey } from './keys';
import { hashPassword, verifyPassword } from './password';
import { setSetting, type Prefs } from './prefs';
import { ADMIN_ID, getUser, type User } from './users';

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

/**
 * Een in de app gezet wachtwoord (hash) gaat voor. Zonder hash geldt LOGIN_PASSWORD, maar alleen voor de beheerder
 * (ook de noodroute); een lid zonder wachtwoord kan niet inloggen.
 */
export async function passwordOk(env: Env, user: Pick<User, 'role' | 'password_hash'>, password: string): Promise<boolean> {
  if (user.password_hash) return verifyPassword(password, user.password_hash);
  // Zonder hash toch één PBKDF2, zodat de responstijd niet verraadt welk account een hash heeft.
  await dummyVerify(password);
  if (user.role !== 'admin' || !env.LOGIN_PASSWORD) return false; // fail closed
  // Vergelijk via hash zodat lengte niet uitlekt.
  const [a, b] = await Promise.all([hmac('pw', password), hmac('pw', env.LOGIN_PASSWORD)]);
  return safeEqual(a, b);
}

let dummyHash: Promise<string> | undefined;

/**
 * Controleert het wachtwoord tegen een vaste dummy-hash (één keer per isolate gemaakt) en geeft altijd false.
 * Voor een onbekend e-mailadres: dan kost een poging even lang als bij een bestaand account.
 */
export async function dummyVerify(password: string): Promise<false> {
  dummyHash ??= hashPassword('tick-dummy-wachtwoord');
  await verifyPassword(password, await dummyHash);
  return false;
}

/** Statement dat de sessieversie van een gebruiker ophoogt (voor een batch). */
export function bumpSessionVersionStmt(db: D1Database, userId: string): D1PreparedStatement {
  return db.prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?').bind(userId);
}

/** Hoogt de sessieversie van een gebruiker op: logt al zijn bestaande sessies uit. */
export async function bumpSessionVersion(db: D1Database, userId: string): Promise<void> {
  await bumpSessionVersionStmt(db, userId).run();
}

/** Sessiecookie `exp.userId.version.hmac`; `version` is `users.session_version`. */
export async function sessionCookie(env: Env, user: Pick<User, 'id' | 'session_version'>): Promise<string> {
  const payload = `${Date.now() + SESSION_DAYS * DAY_MS}.${user.id}.${user.session_version}`;
  const token = `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
  return `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86_400}; HttpOnly; Secure; SameSite=Lax`;
}

export const clearCookie = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

/** Wie de request doet. `inbox` mag alleen POST /api/inbox; `renew` vraagt om een verse sessiecookie. */
export type Auth =
  | { kind: 'dev'; userId: string }
  | { kind: 'token'; keyId: string; userId: string }
  | { kind: 'inbox'; keyId: string; userId: string }
  | { kind: 'session'; userId: string; renew: boolean };

/** Uitkomst van `authorize`; bij een sessie zit de al gelezen gebruiker erbij, zodat de middleware niet opnieuw leest. */
export type Authorized = Auth & { user?: User };

async function session(req: Request, env: Env): Promise<Authorized | null> {
  if (!env.SESSION_SECRET) return null;
  const token = req.headers.get('cookie')?.match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`))?.[1];
  if (!token) return null;
  // Oude cookies (`exp.version.hmac`, zonder gebruiker) hebben een deel te weinig en zijn ongeldig.
  const [exp, userId, version, sig, ...rest] = token.split('.');
  if (!exp || !userId || !version || !sig || rest.length) return null;
  const left = Number(exp) - Date.now();
  if (!(left > 0)) return null;
  if (!safeEqual(sig, await hmac(env.SESSION_SECRET, `${exp}.${userId}.${version}`))) return null;
  const user = await getUser(env.DB, userId);
  if (!user || String(user.session_version) !== version) return null;
  // Sliding renewal: na de helft van de looptijd krijgt de browser een nieuwe cookie.
  return { kind: 'session', userId, renew: left < (SESSION_DAYS * DAY_MS) / 2, user };
}

const USED_EVERY_MS = 3_600_000;

/** Zoekt een sleutel uit de app op zijn hash (unieke index) en markeert hem hoogstens eens per uur als gebruikt. */
async function keyFromDb(env: Env, key: string): Promise<Auth | null> {
  const row = await env.DB.prepare('SELECT id, kind, last_used_at, user_id FROM api_keys WHERE hash = ?').bind(await hashKey(key))
    .first<{ id: string; kind: 'full' | 'inbox'; last_used_at: string | null; user_id: string }>();
  if (!row) return null;
  // Alleen schrijven als het nodig is: anders kost elke request met een sleutel een D1-schrijfactie.
  if (!(Date.parse(row.last_used_at ?? '') >= Date.now() - USED_EVERY_MS)) {
    try {
      await env.DB.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').bind(new Date().toISOString(), row.id).run();
    } catch (e) {
      console.warn('last_used_at bijwerken mislukt', e);
    }
  }
  return row.kind === 'inbox' ? { kind: 'inbox', keyId: row.id, userId: row.user_id } : { kind: 'token', keyId: row.id, userId: row.user_id };
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

export async function authorize(req: Request, env: Env, prefs: Prefs): Promise<Authorized | null> {
  // Alleen lokaal: op een echte host doet DEV_AUTH_BYPASS niets, ook als hij per ongeluk gezet is.
  if (env.DEV_AUTH_BYPASS === '1' && LOCAL_HOSTS.has(new URL(req.url).hostname)) return { kind: 'dev', userId: ADMIN_ID };
  const bearer = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (bearer) {
    // Sleutels uit de app beginnen met tick_; oude secrets niet, die slaan de query over.
    if (bearer.startsWith('tick_')) {
      const found = await keyFromDb(env, bearer);
      if (found) return found;
    }
    if (env.API_TOKEN && !prefs.envApiTokenOff && safeEqual(bearer, env.API_TOKEN)) {
      await touchEnv(env, 'env_api_token_used', prefs.envApiTokenUsed);
      return { kind: 'token', keyId: 'env-api', userId: ADMIN_ID };
    }
    if (env.INBOX_TOKEN && !prefs.envInboxTokenOff && safeEqual(bearer, env.INBOX_TOKEN)) {
      await touchEnv(env, 'env_inbox_token_used', prefs.envInboxTokenUsed);
      return { kind: 'inbox', keyId: 'env-inbox', userId: ADMIN_ID };
    }
  }
  return session(req, env);
}
