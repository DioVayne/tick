import { Hono, type Context } from 'hono';
import type { AppEnv } from './index';
import { HttpError } from './errors';
import { cleanEmail, cleanName, MIN_PASSWORD } from './account';
import { sessionCookie } from './auth';
import { linkPage } from './login';
import { hashPassword } from './password';
import { getUser } from './users';
import { hashKey, newKey } from './keys';

export const INVITE_TTL_MS = 7 * 86_400_000;
export const RESET_TTL_MS = 3_600_000;

export type LinkKind = 'invite' | 'reset';

/** Maakt een eenmalige link-code; alleen de hash komt in de database. Ruimt eerst verlopen en gebruikte links op. */
export async function createLink(db: D1Database, kind: LinkKind, createdBy: string, userId: string | null): Promise<{ code: string; expires_at: string }> {
  const now = Date.now();
  const code = newKey().slice('tick_'.length);
  const expires_at = new Date(now + (kind === 'invite' ? INVITE_TTL_MS : RESET_TTL_MS)).toISOString();
  await db.prepare('DELETE FROM account_links WHERE expires_at < ? OR used_at IS NOT NULL').bind(new Date(now).toISOString()).run();
  await db.prepare('INSERT INTO account_links (id, hash, kind, user_id, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), await hashKey(code), kind, userId, createdBy, expires_at).run();
  return { code, expires_at };
}

/** Is de link nog te gebruiken (bestaat, juiste soort, niet verlopen, niet gebruikt)? Verbruikt hem niet. */
export async function linkValid(db: D1Database, kind: LinkKind, code: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS ok FROM account_links WHERE hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?')
    .bind(await hashKey(code), kind, new Date().toISOString()).first();
  return !!row;
}

/** Verbruikt de link in één statement; null als hij onbekend, verlopen of al gebruikt is. */
export async function consumeLink(db: D1Database, kind: LinkKind, code: string): Promise<{ user_id: string | null } | null> {
  const now = new Date().toISOString();
  return db.prepare('UPDATE account_links SET used_at = ? WHERE hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id')
    .bind(now, await hashKey(code), kind, now).first<{ user_id: string | null }>();
}

/** De publieke pagina's /invite/:code en /reset/:code (vóór de auth-middleware gemonteerd). */
export const linkPages = new Hono<AppEnv>();

async function limited(c: Context<AppEnv>) {
  const { success } = await c.env.LOGIN_LIMITER.limit({ key: 'link:' + (c.req.header('cf-connecting-ip') ?? 'onbekend') });
  if (!success) throw new HttpError(429, 'err.too_many_attempts');
}

for (const kind of ['invite', 'reset'] as const) {
  linkPages.get(`/${kind}/:code`, async (c) => {
    await limited(c);
    return c.html(linkPage(c.get('lang'), kind, await linkValid(c.env.DB, kind, c.req.param('code'))));
  });
}

function checkPassword(v: unknown): string {
  if (typeof v !== 'string' || v.length < MIN_PASSWORD) throw new HttpError(400, 'err.password_short', { min: MIN_PASSWORD });
  return v;
}

linkPages.post('/invite/:code', async (c) => {
  await limited(c);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'err.invalid_json');
  const name = cleanName(body.name);
  const email = cleanEmail(body.email);
  const password = checkPassword(body.password);
  const db = c.env.DB;
  const code = c.req.param('code');
  // Eerst de link: zonder geldige link mag de route niet verraden of een e-mailadres al bestaat.
  if (!(await linkValid(db, 'invite', code))) throw new HttpError(400, 'err.link_invalid');
  // Controleren vóór het verbruiken: een mislukte poging maakt de link niet op.
  if (await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) throw new HttpError(409, 'err.email_taken');
  if (!(await consumeLink(db, 'invite', code))) throw new HttpError(400, 'err.link_invalid');
  const id = crypto.randomUUID();
  try {
    await db.prepare("INSERT INTO users (id, name, email, password_hash, role, session_version, created_at) VALUES (?, ?, ?, ?, 'member', 1, ?)")
      .bind(id, name, email, await hashPassword(password), new Date().toISOString()).run();
  } catch (e) {
    // Zelfde adres net tussendoor vergeven: de link is dan wel verbruikt.
    if (/UNIQUE constraint failed/.test((e as Error).message)) throw new HttpError(409, 'err.email_taken');
    throw e;
  }
  c.header('Set-Cookie', await sessionCookie(c.env, (await getUser(db, id))!));
  return c.json({ ok: true }, 201);
});

linkPages.post('/reset/:code', async (c) => {
  await limited(c);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const password = checkPassword(body?.password);
  const db = c.env.DB;
  const link = await consumeLink(db, 'reset', c.req.param('code'));
  if (!link?.user_id) throw new HttpError(400, 'err.link_invalid');
  await db.prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?')
    .bind(await hashPassword(password), link.user_id).run();
  const user = await getUser(db, link.user_id);
  if (!user) throw new HttpError(400, 'err.link_invalid'); // account intussen verwijderd
  c.header('Set-Cookie', await sessionCookie(c.env, user));
  return c.json({ ok: true });
});
