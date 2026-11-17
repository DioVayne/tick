import { Hono } from 'hono';
import type { AppEnv, Env } from './index';
import { HttpError } from './errors';
import { cleanEmail } from './account';
import { forgotPage } from './login';
import { mailEnabled, reserveMail } from './mail';
import { deliverQueued, enqueueMail, mailBacklog } from './mailqueue';
import { inBackground, type Locale } from './push';

/**
 * "Wachtwoord vergeten?" (/forgot), openbaar en alleen als mailen aan staat. Het antwoord is voor elk geldig adres
 * hetzelfde; opzoeken en versturen gebeurt op de achtergrond, zodat ook de wachttijd niet verraadt of een adres bestaat.
 */
export const forgotPages = new Hono<AppEnv>();

forgotPages.use('/forgot', async (c, next) => {
  if (!mailEnabled(c.env)) return c.notFound();
  await next();
});

forgotPages.get('/forgot', (c) => c.html(forgotPage(c.get('lang'))));

forgotPages.post('/forgot', async (c) => {
  const { success } = await c.env.LOGIN_LIMITER.limit({ key: 'forgot:' + (c.req.header('cf-connecting-ip') ?? 'onbekend') });
  if (!success) throw new HttpError(429, 'err.too_many_attempts');
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const email = cleanEmail(body?.email);
  await inBackground(c, sendResetMail(c.env, email, new URL(c.req.url).origin, c.get('lang')), 'herstelmail');
  // `delayed` hangt alleen af van de wachtrij als geheel, nooit van het adres.
  return c.json({ ok: true, delayed: await mailBacklog(c.env.DB).catch(() => false) });
});

/** Mailt (via de wachtrij) een herstellink naar een gewoon account met dit adres, binnen de grenzen; beheerders krijgen er geen. */
export async function sendResetMail(env: Env, email: string, origin: string, lang: Locale): Promise<void> {
  const db = env.DB;
  const user = await db.prepare("SELECT id, email FROM users WHERE email = ? AND role = 'member'").bind(email).first<{ id: string; email: string }>();
  if (!user) return;
  const now = Date.now();
  const slot = await reserveMail(db, env, 'reset', user.id, now);
  if (slot === 'account_limit') return;
  // Via de wachtrij: de link wordt pas bij versturen gemaakt, dus ook na lang wachten nog een uur geldig.
  const id = await enqueueMail(env, { kind: 'reset', userId: user.id, ref: null, lang, origin }, now);
  await deliverQueued(env, now, { id });
}
