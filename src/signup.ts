import { Hono } from 'hono';
import type { AppEnv, Env } from './index';
import { cleanEmail, cleanName } from './account';
import { sessionCookie } from './auth';
import { HttpError } from './errors';
import { checkPassword } from './links';
import { signupPage } from './login';
import { claimCapNotice, mailEnabled, SIGNUP_CAP } from './mail';
import { hashPassword } from './password';
import { loadInstallPrefs } from './prefs';
import { inBackground, type Locale, notifyUser } from './push';
import { ADMIN_ID, getUser } from './users';
import { translate } from '../public/i18n.js';

/**
 * Een openbare Tick (`OPEN_SIGNUP` = "true"): iedereen kan zelf een account maken, accounts zien elkaar niet, en delen
 * gaat via e-mailadres. Uit (standaard) werkt alles zoals op een Tick voor een huishouden of klein team.
 */
export function openSignup(env: Env): boolean {
  return env.OPEN_SIGNUP?.trim() === 'true';
}

export const DEFAULT_SIGNUP_LIMIT = 100;

/** `SIGNUP_DAILY_LIMIT` als geheel getal vanaf 1, anders 100. */
export function signupDailyLimit(env: Env): number {
  const n = Number(env.SIGNUP_DAILY_LIMIT);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_SIGNUP_LIMIT;
}

/** Begin van de UTC-dag als ISO-tekst. */
const dayStartIso = (ms: number) => new Date(ms - (ms % 86_400_000)).toISOString();

/**
 * /signup: zelf een account maken op een openbare Tick (vóór de auth-middleware gemonteerd). Uit → 404. Een bestaand
 * adres geeft `409 err.email_taken`: dat ene lek accepteerde Dio, zodat je na aanmelden meteen in de app zit.
 */
export const signupPages = new Hono<AppEnv>();

signupPages.use('/signup', async (c, next) => {
  if (!openSignup(c.env)) return c.notFound();
  await next();
});

signupPages.get('/signup', (c) => c.html(signupPage(c.get('lang'), mailEnabled(c.env))));

signupPages.post('/signup', async (c) => {
  const { success } = await c.env.LOGIN_LIMITER.limit({ key: 'signup:' + (c.req.header('cf-connecting-ip') ?? 'onbekend') });
  if (!success) throw new HttpError(429, 'err.too_many_attempts');
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'err.invalid_json');
  const name = cleanName(body.name);
  const email = cleanEmail(body.email);
  const password = checkPassword(body.password);
  const db = c.env.DB;
  const now = Date.now();
  const today = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'member' AND created_at >= ?")
    .bind(dayStartIso(now)).first<{ n: number }>();
  if ((today?.n ?? 0) >= signupDailyLimit(c.env)) {
    await inBackground(c, notifySignupCap(c.env, now), 'aanmeldgrens');
    throw new HttpError(429, 'err.signup_full');
  }
  if (await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) throw new HttpError(409, 'err.email_taken');
  const id = crypto.randomUUID();
  try {
    await db.prepare("INSERT INTO users (id, name, email, password_hash, role, session_version, created_at) VALUES (?, ?, ?, ?, 'member', 1, ?)")
      .bind(id, name, email, await hashPassword(password), new Date(now).toISOString()).run();
  } catch (e) {
    if (/UNIQUE constraint failed/.test((e as Error).message)) throw new HttpError(409, 'err.email_taken');
    throw e;
  }
  c.header('Set-Cookie', await sessionCookie(c.env, (await getUser(db, id))!));
  await inBackground(c, sendVerifyMail(c.env, id, new URL(c.req.url).origin, c.get('lang')), 'bevestigingsmail');
  return c.json({ ok: true }, 201);
});

/** Eén pushmelding per UTC-dag aan de beheerder dat de aanmeldgrens bereikt is. */
async function notifySignupCap(env: Env, now: number): Promise<void> {
  if (!(await claimCapNotice(env.DB, now, SIGNUP_CAP))) return;
  const limit = String(signupDailyLimit(env));
  await notifyUser(env, ADMIN_ID, (l) => ({ title: translate(l, 'mail.signup_cap_title'), body: translate(l, 'mail.signup_cap_body', { limit }) }),
    (await loadInstallPrefs(env)).defaultLocale);
}

/** Bevestigingsmail (Task 4). */
export async function sendVerifyMail(_env: Env, _userId: string, _origin: string, _lang: Locale): Promise<void> {}
