import { Hono } from 'hono';
import type { AppEnv, Env } from './index';
import { cleanEmail, cleanName } from './account';
import { sessionCookie } from './auth';
import { HttpError } from './errors';
import { checkPassword, consumeLink, createLink } from './links';
import { signupPage, verifyPage } from './login';
import { claimCapNotice, mailEnabled, mailLayout, releaseMail, reserveMail, sendMail, SIGNUP_CAP } from './mail';
import { claimEmailInvites } from './invites';
import { hashPassword } from './password';
import { loadInstallPrefs } from './prefs';
import { inBackground, type Locale, notifyUser } from './push';
import { ADMIN_ID, getUser, type User } from './users';
import { deleteAccount } from './users-api';
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
    // De termijn van 30 dagen loopt alleen als er een bevestigingsmail kan komen.
    const deadline = mailEnabled(c.env) ? new Date(now + UNVERIFIED_TTL_MS).toISOString() : null;
    await db.prepare("INSERT INTO users (id, name, email, password_hash, role, session_version, created_at, verify_deadline) VALUES (?, ?, ?, ?, 'member', 1, ?, ?)")
      .bind(id, name, email, await hashPassword(password), new Date(now).toISOString(), deadline).run();
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

export const UNVERIFIED_TTL_MS = 30 * 86_400_000;

/** Tot wanneer een onbevestigd account blijft bestaan; null als het niet opgeruimd wordt. */
export function verifyBy(env: Env, user: Pick<User, 'email_verified_at' | 'verify_deadline' | 'role'>): string | null {
  if (!openSignup(env) || !mailEnabled(env) || user.email_verified_at || user.role !== 'member') return null;
  return user.verify_deadline;
}

/** Mailt een bevestigingslink naar een onbevestigd account, binnen de grenzen van `reserveMail`. */
export async function sendVerifyMail(env: Env, userId: string, origin: string, lang: Locale): Promise<void> {
  if (!mailEnabled(env)) return;
  const db = env.DB;
  const user = await db.prepare('SELECT email FROM users WHERE id = ? AND email IS NOT NULL AND email_verified_at IS NULL')
    .bind(userId).first<{ email: string }>();
  if (!user) return;
  const slot = await reserveMail(db, env, 'verify', userId);
  if (typeof slot !== 'object') return;
  const { code } = await createLink(db, 'verify', userId, userId);
  const t = (key: string) => translate(lang, key);
  const body = mailLayout(lang, {
    heading: t('mail.verify_heading'), intro: t('mail.verify_intro'),
    button: { label: t('mail.verify_button'), url: `${origin}/verify/${code}` }, outro: t('mail.verify_outro'),
  });
  if (!(await sendMail(env, { to: user.email, subject: t('mail.verify_subject'), ...body }))) await releaseMail(db, slot.id);
}

/** Zet het e-mailadres op bevestigd (als dat nog niet zo was) en zet uitnodigingen aan dat adres om. */
export async function markVerified(env: Env, userId: string): Promise<void> {
  await env.DB.prepare('UPDATE users SET email_verified_at = ?, verify_deadline = NULL WHERE id = ? AND email_verified_at IS NULL')
    .bind(new Date().toISOString(), userId).run();
  await claimEmailInvites(env, userId);
}

signupPages.use('/verify/*', async (c, next) => {
  if (!openSignup(c.env)) return c.notFound();
  await next();
});

/** De link uit de bevestigingsmail; werkt zonder inlog. Een gebruikte of onbekende link geeft een nette melding. */
signupPages.get('/verify/:code', async (c) => {
  const { success } = await c.env.LOGIN_LIMITER.limit({ key: 'link:' + (c.req.header('cf-connecting-ip') ?? 'onbekend') });
  if (!success) throw new HttpError(429, 'err.too_many_attempts');
  const link = await consumeLink(c.env.DB, 'verify', c.req.param('code'));
  if (link?.user_id) await markVerified(c.env, link.user_id);
  return c.html(verifyPage(c.get('lang'), !!link?.user_id));
});

/**
 * Elk uur (cron): op een openbare Tick met mail verdwijnen gewone accounts die 30 dagen na aanmelden hun adres nog niet
 * bevestigden, via dezelfde code als "account verwijderen". Zonder mail kan niemand bevestigen, dan gebeurt dat niet.
 * Verlopen uitnodigingen aan adressen gaan altijd weg. Geeft het aantal verwijderde accounts.
 */
export async function purgeUnverified(env: Env, now: number): Promise<number> {
  const db = env.DB;
  await db.prepare('DELETE FROM email_invites WHERE expires_at < ?').bind(new Date(now).toISOString()).run();
  if (!openSignup(env) || !mailEnabled(env)) return 0;
  // Alleen zelf aangemaakte accounts die nooit bevestigd werden (verify_deadline); een gewijzigd adres telt niet.
  const { results } = await db.prepare("SELECT id FROM users WHERE role = 'member' AND email_verified_at IS NULL AND verify_deadline < ? LIMIT 50")
    .bind(new Date(now).toISOString()).all<{ id: string }>();
  for (const { id } of results) await deleteAccount(env, id);
  return results.length;
}
