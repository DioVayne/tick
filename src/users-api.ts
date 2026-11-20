import { Hono } from 'hono';
import type { AppEnv, Env } from './index';
import { HttpError } from './errors';
import { adminOnly } from './guards';
import { createLink } from './links';
import { backgroundKey } from './background';
import { deleteUserStmts, getUser } from './users';
import { transferListsStmts } from './sharedlists';

/**
 * Wist een account met alles erop en eraan: de enige wisroute, voor de beheerder en voor jezelf. Gedeelde lijsten gaan
 * eerst over naar een lid, dan alle rijen, dan de achtergrondfoto in R2. Bijlagen in R2 ruimt `sweepAttachments` op.
 */
export async function deleteAccount(env: Env, id: string): Promise<void> {
  await env.DB.batch([...transferListsStmts(env.DB, id), ...deleteUserStmts(env.DB, id)]);
  await env.FILES?.delete(backgroundKey(id));
}

/** Accountbeheer, alleen voor de beheerder. */
export const usersApi = new Hono<AppEnv>();
usersApi.use('*', adminOnly);

/**
 * Alle accounts met tellingen voor de accountpagina (public/accountsview.js): taken (open en afgevinkt, zonder de
 * prullenbak), apparaten (browsers met een push-abonnement en telefoons met een volledige sleutel) en gedeelde lijsten
 * (zelf gedeeld en geaccepteerd lid). Alleen aantallen, nooit inhoud. Eén query: per tabel één GROUP BY, geen N+1.
 */
const USERS_SQL = `
SELECT u.id, u.name, u.email, u.role, u.created_at, u.last_seen,
  COALESCE(t.open, 0) AS tasks_open, COALESCE(t.done, 0) AS tasks_done,
  COALESCE(b.n, 0) AS browsers, COALESCE(k.n, 0) AS phones,
  COALESCE(so.n, 0) AS lists_shared, COALESCE(sj.n, 0) AS lists_joined
FROM users u
LEFT JOIN (SELECT user_id, SUM(done = 0) AS open, SUM(done = 1) AS done FROM tasks WHERE deleted_at IS NULL GROUP BY user_id) t ON t.user_id = u.id
LEFT JOIN (SELECT user_id, COUNT(*) AS n FROM push_subscriptions GROUP BY user_id) b ON b.user_id = u.id
LEFT JOIN (SELECT user_id, COUNT(*) AS n FROM api_keys WHERE kind = 'full' GROUP BY user_id) k ON k.user_id = u.id
LEFT JOIN (SELECT owner_id, COUNT(*) AS n FROM shared_lists GROUP BY owner_id) so ON so.owner_id = u.id
LEFT JOIN (SELECT user_id, COUNT(*) AS n FROM list_members WHERE role = 'member' AND status = 'accepted' GROUP BY user_id) sj ON sj.user_id = u.id
ORDER BY u.created_at, u.id`;

usersApi.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(USERS_SQL).all();
  return c.json(results);
});

usersApi.post('/invite', async (c) => {
  const { code, expires_at } = await createLink(c.env.DB, 'invite', c.get('user').id, null);
  return c.json({ url: `${new URL(c.req.url).origin}/invite/${code}`, expires_at }, 201);
});

usersApi.post('/:id/reset', async (c) => {
  const target = await getUser(c.env.DB, c.req.param('id'));
  if (!target) throw new HttpError(404, 'err.not_found');
  const { code, expires_at } = await createLink(c.env.DB, 'reset', c.get('user').id, target.id);
  return c.json({ url: `${new URL(c.req.url).origin}/reset/${code}`, expires_at }, 201);
});

usersApi.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (id === c.get('user').id) throw new HttpError(400, 'err.cannot_delete_self');
  if (!(await getUser(c.env.DB, id))) throw new HttpError(404, 'err.not_found');
  await deleteAccount(c.env, id);
  return c.json({ ok: true });
});
