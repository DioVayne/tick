import { Hono } from 'hono';
import type { AppEnv } from './index';
import { HttpError } from './errors';

/** Een taak als bekeken markeren; `updated_at` gaat mee, zodat synchroniseren hem oppikt. Geeft het moment terug. */
export async function markReviewed(db: D1Database, id: string): Promise<string> {
  const at = new Date().toISOString();
  await db.prepare('UPDATE tasks SET reviewed_at = ?1, updated_at = ?1 WHERE id = ?2').bind(at, id).run();
  return at;
}

/** Tickmanager: welke lijsten meedoen aan de ronde. Ook een Bearer-sleutel mag dit, zoals de andere taakroutes. */
export const reviewApi = new Hono<AppEnv>();

reviewApi.put('/lists/:listId', async (c) => {
  const b = await c.req.json<{ include?: unknown }>().catch(() => null);
  if (!b || typeof b.include !== 'boolean') throw new HttpError(400, 'err.must_be_bool', { field: 'include' });
  const db = c.env.DB;
  const userId = c.get('auth').userId;
  const listId = c.req.param('listId');
  // Alleen een id uit je eigen list_ids; die van een ander bestaat voor jou niet.
  const own = await db.prepare('SELECT 1 FROM list_ids WHERE user_id = ? AND id = ?').bind(userId, listId).first();
  if (!own) throw new HttpError(404, 'err.not_found');
  await db.prepare(b.include
    ? 'DELETE FROM review_skip_lists WHERE user_id = ? AND list_id = ?'
    : 'INSERT OR IGNORE INTO review_skip_lists (user_id, list_id) VALUES (?, ?)').bind(userId, listId).run();
  return c.json({ ok: true });
});
