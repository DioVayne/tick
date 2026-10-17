import { Hono } from 'hono';
import type { AppEnv } from './index';
import { HttpError } from './errors';
import { sessionOnly } from './guards';
import { bumpSessionVersion, bumpSessionVersionStmt, passwordOk, sessionCookie } from './auth';
import { hashPassword } from './password';
import { getUser } from './users';

export const accountApi = new Hono<AppEnv>();
accountApi.use('*', sessionOnly);

const MIN_PASSWORD = 8;

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

accountApi.post('/logout-others', async (c) => {
  const id = c.get('user').id;
  await bumpSessionVersion(c.env.DB, id);
  c.header('Set-Cookie', await sessionCookie(c.env, (await getUser(c.env.DB, id))!));
  return c.json({ ok: true });
});
