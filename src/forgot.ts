import { Hono } from 'hono';
import type { AppEnv, Env } from './index';
import { HttpError } from './errors';
import { cleanEmail } from './account';
import { createLink } from './links';
import { forgotPage } from './login';
import { claimCapNotice, dailyLimit, mailEnabled, mailLayout, releaseMail, reserveMail, sendMail } from './mail';
import { loadInstallPrefs } from './prefs';
import { inBackground, type Locale, notifyUser } from './push';
import { ADMIN_ID } from './users';
import { translate } from '../public/i18n.js';

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
  return c.json({ ok: true });
});

/** Mailt een herstellink naar een gewoon account met dit adres, binnen de grenzen; beheerders krijgen er geen. */
export async function sendResetMail(env: Env, email: string, origin: string, lang: Locale): Promise<void> {
  const db = env.DB;
  const user = await db.prepare("SELECT id, email FROM users WHERE email = ? AND role = 'member'").bind(email).first<{ id: string; email: string }>();
  if (!user) return;
  const slot = await reserveMail(db, env, 'reset', user.id);
  if (slot === 'account_limit') return;
  if (slot === 'daily_limit') {
    if (await claimCapNotice(db)) {
      const limit = String(dailyLimit(env));
      await notifyUser(env, ADMIN_ID, (l) => ({ title: translate(l, 'mail.cap_title'), body: translate(l, 'mail.cap_body', { limit }) }),
        (await loadInstallPrefs(env)).defaultLocale);
    }
    return;
  }
  const { code } = await createLink(db, 'reset', user.id, user.id);
  const t = (key: string) => translate(lang, key);
  const body = mailLayout(lang, {
    heading: t('mail.reset_heading'), intro: t('mail.reset_intro'),
    button: { label: t('mail.reset_button'), url: `${origin}/reset/${code}` }, outro: t('mail.reset_outro'),
  });
  if (!(await sendMail(env, { to: user.email, subject: t('mail.reset_subject'), ...body }))) await releaseMail(db, slot.id);
}
