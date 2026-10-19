import { Hono } from 'hono';
import type { AppEnv } from './index';
import { HttpError } from './errors';
import { adminOnly } from './guards';
import { createLink } from './links';
import { backgroundKey } from './background';
import { deleteUserStmts, getUser } from './users';

/** Accountbeheer, alleen voor de beheerder. */
export const usersApi = new Hono<AppEnv>();
usersApi.use('*', adminOnly);

usersApi.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, name, email, role, created_at, last_seen FROM users ORDER BY created_at, id').all();
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
  await c.env.DB.batch(deleteUserStmts(c.env.DB, id));
  await c.env.FILES?.delete(backgroundKey(id));
  return c.json({ ok: true });
});
