import { Hono, type Context } from 'hono';
import type { AppEnv } from './index';
import { HttpError } from './errors';
import { sessionOnly } from './guards';
import { bumpSessionVersionStmt, clearCookie, passwordOk, sessionCookie } from './auth';
import { hashPassword } from './password';
import { getUser } from './users';
import { deleteAccount } from './users-api';
import { mailEnabled } from './mail';
import { inBackground } from './push';
import { openSignup, sendVerifyMail } from './signup';

export const accountApi = new Hono<AppEnv>();
accountApi.use('*', sessionOnly);

export const MIN_PASSWORD = 8;

/**
 * Inloggegevens gewijzigd (wachtwoord gewijzigd of hersteld, elders uitgelogd): alle sessies uit (sessieversie), en
 * ook de toegang die buiten een sessie om openstaat: verhuiscodes (een volledige export zonder inlog) en ongebruikte
 * herstellinks. Voor één batch, zodat het alles of niets is.
 */
export function revokeAccessStmts(db: D1Database, userId: string): D1PreparedStatement[] {
  return [
    bumpSessionVersionStmt(db, userId),
    db.prepare('DELETE FROM move_codes WHERE user_id = ?').bind(userId),
    db.prepare("DELETE FROM account_links WHERE user_id = ? AND kind = 'reset' AND used_at IS NULL").bind(userId),
  ];
}

/** Zelfde rem als /login, voor elke route die een wachtwoord controleert. */
async function limitAttempts(c: Context<AppEnv>): Promise<void> {
  const { success } = await c.env.LOGIN_LIMITER.limit({ key: c.req.header('cf-connecting-ip') ?? 'onbekend' });
  if (!success) throw new HttpError(429, 'err.too_many_attempts');
}

accountApi.post('/password', async (c) => {
  await limitAttempts(c);
  const body = await c.req.json<{ current?: unknown; next?: unknown }>().catch(() => null);
  if (!body || typeof body.current !== 'string' || typeof body.next !== 'string') throw new HttpError(400, 'err.invalid_json');
  const user = c.get('user');
  if (!(await passwordOk(c.env, user, body.current))) throw new HttpError(403, 'err.wrong_password'); // 403, geen 401: de app stuurt bij 401 naar /login
  if (body.next.length < MIN_PASSWORD) throw new HttpError(400, 'err.password_short', { min: MIN_PASSWORD });
  // Wachtwoord en intrekken samen: nooit een nieuw wachtwoord terwijl oude sessies of verhuiscodes nog gelden.
  const db = c.env.DB;
  await db.batch([
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(body.next), user.id),
    ...revokeAccessStmts(db, user.id),
  ]);
  c.header('Set-Cookie', await sessionCookie(c.env, (await getUser(db, user.id))!));
  return c.json({ ok: true });
});

accountApi.post('/delete', async (c) => {
  await limitAttempts(c);
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
  await c.env.DB.batch(revokeAccessStmts(c.env.DB, id));
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
    const user = c.get('user');
    const changed = email.toLowerCase() !== (user.email ?? '').toLowerCase();
    // Een ander adres (niet alleen andere hoofdletters) vraagt het huidige wachtwoord: wie een open sessie in handen
    // krijgt, mag het account niet via "wachtwoord vergeten" naar een eigen adres overnemen.
    if (changed) {
      await limitAttempts(c);
      const password = typeof body.password === 'string' ? body.password : '';
      if (!(await passwordOk(c.env, user, password))) throw new HttpError(403, 'err.wrong_password'); // 403: bij 401 gaat de app naar /login
    }
    sets.push('email = ?'); vals.push(email);
    if (openSignup(c.env) && changed) {
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
  if (reverify) {
    // Een bevestigings- of herstellink van vóór de wijziging mag het nieuwe adres niet bevestigen.
    await c.env.DB.prepare("DELETE FROM account_links WHERE user_id = ? AND kind IN ('verify', 'reset') AND used_at IS NULL").bind(id).run();
    await inBackground(c, sendVerifyMail(c.env, id, new URL(c.req.url).origin, c.get('lang')), 'bevestigingsmail');
  }
  const { name, email, role } = (await getUser(c.env.DB, id))!;
  return c.json({ id, name, email, role });
});
