import { Hono } from 'hono';
import type { AppEnv } from './index';
import { HttpError } from './errors';
import { sessionOnly } from './guards';
import { bumpSessionVersion, bumpSessionVersionStmt, passwordOk, sessionCookie } from './auth';
import { hashPassword } from './password';
import { settingStmt } from './prefs';

export const accountApi = new Hono<AppEnv>();
accountApi.use('*', sessionOnly);

const MIN_PASSWORD = 8;

accountApi.post('/password', async (c) => {
  // Zelfde rem als /login, voor het controleren van het huidige wachtwoord.
  const { success } = await c.env.LOGIN_LIMITER.limit({ key: c.req.header('cf-connecting-ip') ?? 'onbekend' });
  if (!success) throw new HttpError(429, 'err.too_many_attempts');
  const body = await c.req.json<{ current?: unknown; next?: unknown }>().catch(() => null);
  if (!body || typeof body.current !== 'string' || typeof body.next !== 'string') throw new HttpError(400, 'err.invalid_json');
  if (!(await passwordOk(c.env, c.get('prefs'), body.current))) throw new HttpError(403, 'err.wrong_password'); // 403, geen 401: de app stuurt bij 401 naar /login
  if (body.next.length < MIN_PASSWORD) throw new HttpError(400, 'err.password_short', { min: MIN_PASSWORD });
  // Wachtwoord en sessieversie samen: nooit een nieuw wachtwoord terwijl de oude sessies nog gelden.
  const db = c.env.DB;
  await db.batch([settingStmt(db, 'password_hash', await hashPassword(body.next)), bumpSessionVersionStmt(db)]);
  c.header('Set-Cookie', await sessionCookie(c.env));
  return c.json({ ok: true });
});

accountApi.post('/logout-others', async (c) => {
  await bumpSessionVersion(c.env.DB);
  c.header('Set-Cookie', await sessionCookie(c.env));
  return c.json({ ok: true });
});
