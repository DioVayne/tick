import { Hono } from 'hono';
import type { AppEnv } from './index';
import { HttpError } from './errors';
import { sessionOnly } from './guards';
import { bumpSessionVersion, bumpSessionVersionStmt, clearCookie, passwordOk, sessionCookie } from './auth';
import { hashPassword } from './password';
import { getUser } from './users';
import { deleteAccount } from './users-api';
import { mailEnabled } from './mail';
import { inBackground } from './push';
import { openSignup, sendVerifyMail } from './signup';

export const accountApi = new Hono<AppEnv>();
accountApi.use('*', sessionOnly);

export const MIN_PASSWORD = 8;

accountApi.post('/password', async (c) => {
  // Zelfde rem als /login, voor het controleren van het huidige wachtwoord.
  const { success } = await c.env.LOGIN_LIMITER.limit({ key: c.req.header('cf-connecting-ip') ?? 'onbekend' });
  if (!success) throw new HttpError(429, 'err.too_many_attempts');
  const body = await c.req.json<{ current?: unknown; next?: unknown }>().catch(() => null);
  if (!body || typeof body.current !== 'string' || typeof body.next !== 'string') throw new HttpError(400, 'err.invalid_json');
  const user = c.get('user');
  if (!(await passwordOk(c.env, user, body.current))) throw new HttpError(403, 'err.wrong_password'); // 403, geen 401: de app stuurt bij 401 naar /login
  if (body.next.length < MIN_PASSWORD) throw new HttpError(400, 'err.password_short', { min: MIN_PASSWORD });
  // Wachtwoord en sessieversie samen: nooit een nieuw wachtwoord terwijl de oude sessies nog gelden.
  const db = c.env.DB;
  await db.batch([
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(body.next), user.id),
    bumpSessionVersionStmt(db, user.id),
  ]);
  c.header('Set-Cookie', await sessionCookie(c.env, (await getUser(db, user.id))!));
  return c.json({ ok: true });
});

accountApi.post('/delete', async (c) => {
  // Zelfde rem als /login: hier wordt een wachtwoord gecontroleerd.
  const { success } = await c.env.LOGIN_LIMITER.limit({ key: c.req.header('cf-connecting-ip') ?? 'onbekend' });
  if (!success) throw new HttpError(429, 'err.too_many_attempts');
  const body = await c.req.json<{ password?: unknown }>().catch(() => null);
  if (!body || typeof body.password !== 'string') throw new HttpError(400, 'err.invalid_json');
  const user = c.get('user');
  if (!(await passwordOk(c.env, user, body.password))) throw new HttpError(403, 'err.wrong_password'); // 403: bij 401 gaat de app naar /login
  if (user.role === 'admin') {
    // Nooit een Tick zonder beheerder.
    const admins = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first<{ n: number }>();
    if ((admins?.n ?? 0) <= 1) throw new HttpError(409, 'err.last_admin');
  }
  await deleteAccount(c.env, user.id);
  // De cookie hoort nu bij niemand meer; de middleware verlengt hem niet omdat de route zelf een cookie zet.
  c.header('Set-Cookie', clearCookie);
  return c.json({ ok: true });
});

accountApi.post('/logout-others', async (c) => {
  const id = c.get('user').id;
  await bumpSessionVersion(c.env.DB, id);
  c.header('Set-Cookie', await sessionCookie(c.env, (await getUser(c.env.DB, id))!));
  return c.json({ ok: true });
});

/** Bevestigingsmail opnieuw sturen (openbare Tick, onbevestigd adres); de grenzen van reserveMail gelden. */
accountApi.post('/verify', async (c) => {
  const user = c.get('user');
  if (!openSignup(c.env) || !mailEnabled(c.env) || user.email_verified_at || !user.email) throw new HttpError(400, 'err.already_verified');
  await inBackground(c, sendVerifyMail(c.env, user.id, new URL(c.req.url).origin, c.get('lang')), 'bevestigingsmail');
  return c.json({ ok: true });
});

accountApi.get('/', (c) => {
  const { id, name, email, role } = c.get('user');
  return c.json({ id, name, email, role });
});

/** Naam en e-mailadres zoals een profiel ze toestaat: getrimd teruggegeven, anders een 400. */
export function cleanName(v: unknown): string {
  const name = typeof v === 'string' ? v.trim() : "";
  if (!name || name.length > 60) throw new HttpError(400, 'err.invalid_name');
  return name;
}
export function cleanEmail(v: unknown): string {
  const email = typeof v === 'string' ? v.trim() : "";
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new HttpError(400, 'err.invalid_email');
  return email;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

accountApi.patch('/', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'err.invalid_json');
  const sets: string[] = [];
  const vals: string[] = [];
  if (body.name !== undefined) {
    sets.push('name = ?'); vals.push(cleanName(body.name));
  }
  const id = c.get('user').id;
  // Op een openbare Tick is een nieuw adres pas bevestigd na de mail; dezelfde in andere hoofdletters blijft bevestigd.
  let reverify = false;
  if (body.email !== undefined) {
    const email = cleanEmail(body.email);
    sets.push('email = ?'); vals.push(email);
    if (openSignup(c.env) && email.toLowerCase() !== (c.get('user').email ?? '').toLowerCase()) {
      sets.push('email_verified_at = NULL');
      reverify = true;
    }
  }
  if (sets.length) {
    try {
      await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
    } catch (e) {
      if (/UNIQUE constraint failed/.test((e as Error).message)) throw new HttpError(409, 'err.email_taken');
      throw e;
    }
  }
  if (reverify) await inBackground(c, sendVerifyMail(c.env, id, new URL(c.req.url).origin, c.get('lang')), 'bevestigingsmail');
  const { name, email, role } = (await getUser(c.env.DB, id))!;
  return c.json({ id, name, email, role });
});
