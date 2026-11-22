import { Hono } from 'hono';
import type { AppEnv, Env } from './index';
import { cleanEmail, cleanName } from './account';
import { sessionCookie } from './auth';
import { HttpError } from './errors';
import { checkPassword, consumeLink } from './links';
import { joinInvalidPage, signupPage, verifyPage } from './login';
import { mailEnabled, recordSignup, releaseMail, reserveMail } from './mail';
import { deliverQueued, enqueueMail } from './mailqueue';
import { claimEmailInvites, claimInvites, inviteByCode } from './invites';
import { authorize } from './auth';
import { hashPassword } from './password';
import { loadInstallPrefs } from './prefs';
import { inBackground, type Locale } from './push';
import { background, tellOwner } from './telegram';
import { getUser, type User } from './users';
import { deleteAccount } from './users-api';
import { tryWelcomeTask } from './welcome';

/**
 * Een openbare Tick (`OPEN_SIGNUP` = "true"): iedereen kan zelf een account maken, accounts zien elkaar niet, en delen
 * gaat via e-mailadres. Uit (standaard) werkt alles zoals op een Tick voor een huishouden of klein team.
 */
export function openSignup(env: Env): boolean {
  return env.OPEN_SIGNUP?.trim() === 'true';
}

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

signupPages.use('/join/*', async (c, next) => {
  if (!openSignup(c.env)) return c.notFound();
  await next();
});

/**
 * De knop in de uitnodigingsmail. Ingelogd: de uitnodiging gaat naar je eigen account en je gaat naar de app. Anders
 * het aanmeldscherm met het adres ingevuld (en een link om eerst in te loggen). Een onbekende code: een nette melding.
 */
signupPages.get('/join/:code', async (c) => {
  const { success } = await c.env.LOGIN_LIMITER.limit({ key: 'link:' + (c.req.header('cf-connecting-ip') ?? 'onbekend') });
  if (!success) throw new HttpError(429, 'err.too_many_attempts');
  const code = c.req.param('code');
  const join = await inviteByCode(c.env.DB, code);
  if (!join) return c.html(joinInvalidPage(c.get('lang')));
  const auth = await authorize(c.req.raw, c.env, await loadInstallPrefs(c.env));
  if (auth && auth.kind === 'session') {
    await claimInvites(c.env, auth.userId, { inviteId: join.id });
    return c.redirect('/', 302);
  }
  return c.html(signupPage(c.get('lang'), mailEnabled(c.env), { code, email: join.email, name: join.from_name, title: join.title }));
});

signupPages.post('/signup', async (c) => {
  const { success } = await c.env.LOGIN_LIMITER.limit({ key: 'signup:' + (c.req.header('cf-connecting-ip') ?? 'onbekend') });
  if (!success) throw new HttpError(429, 'err.too_many_attempts');
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'err.invalid_json');
  const name = cleanName(body.name);
  const email = cleanEmail(body.email);
  const password = checkPassword(body.password);
  const db = c.env.DB;
  // Via de link uit een uitnodigingsmail (/join/<code>): de uitnodiging volgt de link.
  const join = typeof body.join === 'string' && body.join ? await inviteByCode(db, body.join) : null;
  if (body.join && !join) throw new HttpError(400, 'err.link_invalid');
  // Hetzelfde adres als in de uitnodiging: de mail kwam aan, dus het adres is bevestigd.
  const confirmed = !!join && join.email.toLowerCase() === email.toLowerCase();
  const now = Date.now();
  // Eén rij `signup` per aanmelding (geen grens); een verwijderd account telt zo nog mee in het aantal van vandaag.
  const slot = await recordSignup(db, now);
  const id = crypto.randomUUID();
  try {
    if (await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) throw new HttpError(409, 'err.email_taken');
    // De termijn van 30 dagen loopt alleen als er een bevestigingsmail kan komen.
    const deadline = !confirmed && mailEnabled(c.env) ? new Date(now + UNVERIFIED_TTL_MS).toISOString() : null;
    const ts = new Date(now).toISOString();
    await db.prepare("INSERT INTO users (id, name, email, password_hash, role, session_version, created_at, verify_deadline, email_verified_at) VALUES (?, ?, ?, ?, 'member', 1, ?, ?, ?)")
      .bind(id, name, email, await hashPassword(password), ts, deadline, confirmed ? ts : null).run();
  } catch (e) {
    // Geen account gemaakt: de plek telt niet mee.
    await releaseMail(db, slot.id);
    if (/UNIQUE constraint failed/.test((e as Error).message)) throw new HttpError(409, 'err.email_taken');
    throw e;
  }
  // Elke 100 aanmeldingen op een dag een bericht aan de eigenaar (één per honderdtal, ook bij gelijktijdige
  // aanmeldingen), pas als het account er is en zonder dat de aanmelder erop wacht.
  const hundred = Math.floor(slot.count / 100) * 100;
  if (hundred >= 100) background(tellOwner(c.env, 'signups', { count: String(hundred) }, 'once', now));
  await tryWelcomeTask(c.env, id, c.get('lang')); // de uitleg-taak met subtaken (src/welcome.ts)
  if (join) await claimInvites(c.env, id, { inviteId: join.id });
  if (confirmed) await claimEmailInvites(c.env, id); // ook uitnodigingen van anderen aan dit adres
  c.header('Set-Cookie', await sessionCookie(c.env, (await getUser(db, id))!));
  if (!confirmed) await inBackground(c, sendVerifyMail(c.env, id, new URL(c.req.url).origin, c.get('lang')), 'bevestigingsmail');
  return c.json({ ok: true }, 201);
});

export const UNVERIFIED_TTL_MS = 30 * 86_400_000;

/** Tot wanneer een onbevestigd account blijft bestaan; null als het niet opgeruimd wordt. */
export function verifyBy(env: Env, user: Pick<User, 'email_verified_at' | 'verify_deadline' | 'role'>): string | null {
  if (!openSignup(env) || !mailEnabled(env) || user.email_verified_at || user.role !== 'member') return null;
  return user.verify_deadline;
}

/** Hooguit zoveel bevestigingsmails per adres per 24 uur (ook over verwijderde accounts heen), zodat opnieuw sturen werkt. */
export const VERIFY_PER_RECIPIENT = 3;

/** Mailt (via de wachtrij) een bevestigingslink naar een onbevestigd account, binnen de grenzen van `reserveMail`. */
export async function sendVerifyMail(env: Env, userId: string, origin: string, lang: Locale): Promise<void> {
  if (!mailEnabled(env)) return;
  const db = env.DB;
  const user = await db.prepare('SELECT email FROM users WHERE id = ? AND email IS NOT NULL AND email_verified_at IS NULL')
    .bind(userId).first<{ email: string }>();
  if (!user) return;
  // Een paar per adres per 24 uur, ook over een verwijderd account heen; binnen die grens werkt "opnieuw sturen" gewoon.
  const now = Date.now();
  const slot = await reserveMail(db, env, 'verify', userId, now, { recipient: user.email, recipientPerDay: VERIFY_PER_RECIPIENT });
  if (typeof slot !== 'object') return;
  // Via de wachtrij (link en adres bij versturen, src/mailqueue.ts); lukt de directe poging niet, dan later alsnog.
  const id = await enqueueMail(env, { kind: 'verify', userId, ref: null, lang, origin }, now);
  await deliverQueued(env, now, { id });
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
