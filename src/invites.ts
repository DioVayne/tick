import type { Context } from 'hono';
import type { AppEnv, Env } from './index';
import { cleanEmail } from './account';
import { HttpError } from './errors';
import { mailEnabled } from './mail';
import type { User } from './users';

/**
 * Delen op een openbare Tick (OPEN_SIGNUP): geen lijst van accounts, alleen een volledig e-mailadres of iemand met wie
 * je al deelt. Een adres zonder bevestigd account krijgt een rij in `email_invites` (en een uitnodigingsmail); die
 * wordt een gewone uitnodiging zodra een account met dat adres bevestigd is. Het antwoord aan de deler is in beide
 * gevallen hetzelfde, zodat niemand kan uitproberen welke adressen een account hebben.
 */

export const INVITE_TTL_MS = 30 * 86_400_000;
/** Prefix van `user_id` voor een uitnodiging aan een adres in de ledenlijsten (`mail:<invite id>`). */
export const MAIL_PREFIX = 'mail:';

export type Target = { kind: 'task'; taskId: string; mode: 'shared' | 'copy' } | { kind: 'list'; listId: string };

/** Accounts met wie je al een geaccepteerde gedeelde taak of lijst hebt (in beide richtingen): die ken je al. */
export async function knownPeople(db: D1Database, userId: string): Promise<{ id: string; name: string }[]> {
  const { results } = await db.prepare(
    'SELECT id, name FROM users WHERE id != ?1 AND id IN (' +
    "SELECT s.to_user FROM task_shares s JOIN tasks t ON t.id = s.task_id WHERE t.user_id = ?1 AND s.mode = 'shared' AND s.status = 'accepted' " +
    "UNION SELECT t.user_id FROM task_shares s JOIN tasks t ON t.id = s.task_id WHERE s.to_user = ?1 AND s.mode = 'shared' AND s.status = 'accepted' " +
    "UNION SELECT o.user_id FROM list_members me JOIN list_members o ON o.list_id = me.list_id WHERE me.user_id = ?1 AND me.status = 'accepted' AND o.status = 'accepted'" +
    ') ORDER BY lower(name), id',
  ).bind(userId).all<{ id: string; name: string }>();
  return results;
}

/**
 * De ontvanger op een openbare Tick. Afzender onbevestigd → 403. `to_user` alleen uit `knownPeople`; anders een geldig
 * e-mailadres. Een bevestigd account → `{ userId }`, anders (geen of onbevestigd account) → `{ email }`.
 */
export async function resolveOpenRecipient(env: Env, me: User, b: Record<string, unknown>): Promise<{ userId: string } | { email: string }> {
  if (!me.email_verified_at) throw new HttpError(403, mailEnabled(env) ? 'err.verify_first' : 'err.share_unavailable');
  const db = env.DB;
  if (typeof b.to_user === 'string' && b.to_user) {
    if ((await knownPeople(db, me.id)).some((p) => p.id === b.to_user)) return { userId: b.to_user };
    throw new HttpError(400, 'err.share_email_needed');
  }
  let email: string;
  try {
    email = cleanEmail(b.to);
  } catch {
    throw new HttpError(400, 'err.share_email_needed');
  }
  if (email.toLowerCase() === (me.email ?? '').toLowerCase()) throw new HttpError(400, 'err.share_self');
  const u = await db.prepare('SELECT id FROM users WHERE email = ? AND email_verified_at IS NOT NULL').bind(email).first<{ id: string }>();
  return u ? { userId: u.id } : { email };
}

/** Een uitnodiging aan een adres; dezelfde nogmaals geeft dezelfde 409 als bij een account. */
export async function addEmailInvite(db: D1Database, fromUser: string, email: string, target: Target): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const res = await db.prepare('INSERT INTO email_invites (id, email, from_user, task_id, list_id, mode, created_at, expires_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(
    id, email, fromUser, target.kind === 'task' ? target.taskId : null, target.kind === 'list' ? target.listId : null,
    target.kind === 'task' ? target.mode : 'shared', new Date(now).toISOString(), new Date(now + INVITE_TTL_MS).toISOString(),
  ).run();
  if (!res.meta.changes) throw new HttpError(409, target.kind === 'task' ? 'err.share_exists' : 'err.list_member_exists');
  return { id };
}

/** Een uitnodiging aan een adres intrekken (alleen de deler); false als er niets was. */
export async function revokeEmailInvite(db: D1Database, fromUser: string, id: string, target?: Target): Promise<boolean> {
  const scope = target?.kind === 'list' ? ' AND list_id = ?3' : '';
  const res = await db.prepare(`DELETE FROM email_invites WHERE id = ?1 AND from_user = ?2${scope}`)
    .bind(id, fromUser, ...(scope ? [(target as { listId: string }).listId] : [])).run();
  return !!res.meta.changes;
}

/** Niet-verlopen uitnodigingen aan adressen van deze deler, per taak (gedeeld en kopie) of per lijst. */
export async function emailInviteRows(db: D1Database, ownerId: string): Promise<{ id: string; email: string; task_id: string | null; list_id: string | null; mode: string }[]> {
  const { results } = await db.prepare('SELECT id, email, task_id, list_id, mode FROM email_invites WHERE from_user = ? AND expires_at > ? ORDER BY created_at, id')
    .bind(ownerId, new Date().toISOString()).all<{ id: string; email: string; task_id: string | null; list_id: string | null; mode: string }>();
  return results;
}

/** Na een nieuwe uitnodiging aan een adres: de uitnodigingsmail (Task 6). */
export async function afterEmailInvite(_c: Context<AppEnv>, _email: string, _what: { kind: 'task' | 'list'; title: string }): Promise<void> {}
