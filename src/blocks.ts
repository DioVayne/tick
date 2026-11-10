import { Hono } from 'hono';
import type { AppEnv } from './index';
import { HttpError } from './errors';
import { findTarget } from './reports';
import { leaveListStmts } from './sharedlists';
import { openSignup } from './signup';

/**
 * Blokkeren op een openbare Tick (OPEN_SIGNUP). Blokkeren stopt al het delen tussen twee accounts, in beide
 * richtingen; daarna komt wat de een met de ander deelt nooit aan (zie `resolveOpenRecipient`: dan een stille
 * uitnodiging aan het adres, zoals bij een adres zonder account). De geblokkeerde merkt niets.
 */
export const blocksApi = new Hono<AppEnv>();

/** Of een van beiden de ander blokkeerde. */
export async function blockedBetween(db: D1Database, a: string, b: string): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 AS x FROM blocks WHERE (user_id = ?1 AND blocked_id = ?2) OR (user_id = ?2 AND blocked_id = ?1) LIMIT 1')
    .bind(a, b).first());
}

/**
 * Statements voor "me blokkeert other": de blokkade, alle deelrijen (en hun bezorgrijen) op elkaars taken, het
 * lidmaatschap als de een eigenaar is van een gedeelde lijst waar de ander in zit (een lijst van een derde blijft), en
 * uitnodigingen aan elkaars adres. Async: de lijsten worden eerst opgezocht. Kopiegroepen blijven: daar filteren
 * `copiesFor` en `notifyCopyDone` (src/copies.ts) de blokkade bij het lezen, zodat opheffen het terugbrengt.
 */
export async function blockStmts(db: D1Database, me: string, other: string): Promise<D1PreparedStatement[]> {
  const { results: lists } = await db.prepare(
    'SELECT m.list_id, m.user_id FROM list_members m JOIN shared_lists l ON l.id = m.list_id ' +
    'WHERE (l.owner_id = ?1 AND m.user_id = ?2) OR (l.owner_id = ?2 AND m.user_id = ?1)',
  ).bind(me, other).all<{ list_id: string; user_id: string }>();
  const ownedBy = (owner: string) => `SELECT id FROM tasks WHERE user_id = ${owner} OR parent_id IN (SELECT id FROM tasks WHERE user_id = ${owner})`;
  return [
    db.prepare('INSERT INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(me, other, new Date().toISOString()),
    ...lists.flatMap((l) => leaveListStmts(db, l.list_id, l.user_id)),
    db.prepare(`DELETE FROM reminder_sent WHERE (user_id = ?2 AND task_id IN (${ownedBy('?1')})) OR (user_id = ?1 AND task_id IN (${ownedBy('?2')}))`).bind(me, other),
    db.prepare('DELETE FROM task_shares WHERE (to_user = ?2 AND task_id IN (SELECT id FROM tasks WHERE user_id = ?1)) ' +
      'OR (to_user = ?1 AND task_id IN (SELECT id FROM tasks WHERE user_id = ?2))').bind(me, other),
    db.prepare('DELETE FROM email_invites WHERE (from_user = ?1 AND email = (SELECT email FROM users WHERE id = ?2)) ' +
      'OR (from_user = ?2 AND email = (SELECT email FROM users WHERE id = ?1))').bind(me, other),
  ];
}

/**
 * Of `other` iemand is met wie `me` iets deelt of deelde (in welke status ook): een deelrij op elkaars taak, of samen
 * in een gedeelde lijst. Alleen zo iemand kun je blokkeren; op een getypt adres niet (dat verraadt welke bestaan).
 */
export async function related(db: D1Database, me: string, other: string): Promise<boolean> {
  return !!(await db.prepare(
    'SELECT 1 AS x FROM task_shares s JOIN tasks t ON t.id = s.task_id WHERE (t.user_id = ?1 AND s.to_user = ?2) OR (t.user_id = ?2 AND s.to_user = ?1) ' +
    'UNION ALL SELECT 1 FROM list_members a JOIN list_members b ON b.list_id = a.list_id WHERE a.user_id = ?1 AND b.user_id = ?2 ' +
    'UNION ALL SELECT 1 FROM blocks WHERE user_id = ?1 AND blocked_id = ?2 LIMIT 1',
  ).bind(me, other).first());
}

blocksApi.use('*', async (c, next) => {
  if (!openSignup(c.env)) throw new HttpError(404, 'err.not_found');
  await next();
});

blocksApi.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT u.id, u.name FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.user_id = ? ORDER BY lower(u.name), u.id')
    .bind(c.get('auth').userId).all<{ id: string; name: string }>();
  return c.json(results);
});

blocksApi.post('/', async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => { throw new HttpError(400, 'err.invalid_json'); });
  const me = c.get('auth').userId;
  // Met een id (de lijst geblokkeerden, Instellingen), of via wat er gedeeld is: de app kent dan alleen een naam.
  let other = typeof b.user_id === 'string' ? b.user_id : '';
  if (!other) other = (await findTarget(c.env.DB, me, b)).reported;
  else if (other === me || !(await related(c.env.DB, me, other))) throw new HttpError(404, 'err.not_found');
  await c.env.DB.batch(await blockStmts(c.env.DB, me, other));
  return c.json({ ok: true });
});

blocksApi.delete('/:userId', async (c) => {
  await c.env.DB.prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?').bind(c.get('auth').userId, c.req.param('userId')).run();
  return c.json({ ok: true });
});
