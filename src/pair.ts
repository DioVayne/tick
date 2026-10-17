import { Hono, type Context } from 'hono';
import type { AppEnv } from './index';
import { HttpError } from './errors';
import { sessionOnly } from './guards';
import { createKey, hashKey, newKey } from './keys';

const MAX_NAME = 60;
const TTL_MS = 2 * 60 * 1000;

/** Koppelcodes: de PWA (met sessie) vraagt er een aan, de Android-app wisselt hem zonder login in voor een full-sleutel. */
export const pairApi = new Hono<AppEnv>();
pairApi.use('*', sessionOnly);

pairApi.post('/', async (c) => {
  const now = new Date();
  // Verlopen en gebruikte rijen ruimen we hier op; een gebruikte rij blijft dus staan tot de volgende aanvraag.
  await c.env.DB.prepare('DELETE FROM pair_codes WHERE expires_at < ? OR used_at IS NOT NULL').bind(now.toISOString()).run();
  const code = newKey().slice('tick_'.length);
  const id = crypto.randomUUID();
  const expires_at = new Date(now.getTime() + TTL_MS).toISOString();
  await c.env.DB.prepare('INSERT INTO pair_codes (id, hash, expires_at) VALUES (?, ?, ?)').bind(id, await hashKey(code), expires_at).run();
  return c.json({ id, code, expires_at }, 201);
});

pairApi.get('/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT used_at FROM pair_codes WHERE id = ?').bind(c.req.param('id')).first<{ used_at: string | null }>();
  if (!row) throw new HttpError(404, 'err.not_found');
  return c.json({ used: row.used_at !== null });
});

/** Zonder login: wisselt een koppelcode eenmalig in voor een full-sleutel. */
export async function redeem(c: Context<AppEnv>) {
  const ip = c.req.header('cf-connecting-ip') ?? 'onbekend';
  const { success } = await c.env.LOGIN_LIMITER.limit({ key: 'pair:' + ip });
  if (!success) throw new HttpError(429, 'err.too_many_attempts');
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const code = body && typeof body.code === 'string' ? body.code : '';
  const given = body && typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
  const name = given || 'Android';
  const now = new Date().toISOString();
  // Verbruiken in één statement, zodat dezelfde code nooit twee sleutels oplevert.
  const res = await c.env.DB.prepare('UPDATE pair_codes SET used_at = ? WHERE hash = ? AND used_at IS NULL AND expires_at > ?')
    .bind(now, await hashKey(code), now).run();
  if (res.meta.changes !== 1) throw new HttpError(400, 'err.invalid_pair_code');
  const { key } = await createKey(c.env.DB, name, 'full');
  return c.json({ key }, 201);
}
