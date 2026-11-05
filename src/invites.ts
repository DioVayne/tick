import type { Context } from 'hono';
import type { AppEnv, Env } from './index';
import { cleanEmail } from './account';
import { HttpError } from './errors';
import { mailEnabled, mailLayout, releaseMail, reserveMail, sendMail } from './mail';
import { inBackground, type Locale } from './push';
import { translate } from '../public/i18n.js';
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

/** Na een nieuwe uitnodiging aan een adres: de uitnodigingsmail, op de achtergrond. */
export async function afterEmailInvite(c: Context<AppEnv>, email: string, what: { kind: 'task' | 'list'; title: string }): Promise<void> {
  const me = c.get('user');
  await inBackground(c, sendInviteMail(c.env, { id: me.id, name: me.name }, email, what, new URL(c.req.url).origin, c.get('lang')), 'uitnodigingsmail');
}

/**
 * Uitnodigingsmail aan een adres zonder (bevestigd) account: wie deelt, wat Tick is, en waar je een account maakt.
 * Grenzen: per deler 5 per dag (zonder wachttijd), per adres 1 per dag, en samen hooguit de helft van de daggrens.
 * Geen e-mailadres in een link.
 */
export async function sendInviteMail(env: Env, from: { id: string; name: string }, email: string, what: { kind: 'task' | 'list'; title: string },
  origin: string, lang: Locale): Promise<void> {
  if (!mailEnabled(env)) return;
  const slot = await reserveMail(env.DB, env, 'invite_mail', from.id, Date.now(), { gapMs: 0, perDay: 5, dailyShare: 0.5, recipient: email });
  if (typeof slot !== 'object') return;
  const t = (key: string, vars: Record<string, string> = {}) => translate(lang, key, vars);
  const play = env.PLAY_STORE_URL?.trim();
  const body = mailLayout(lang, {
    heading: t(what.kind === 'task' ? 'mail.invite_heading_task' : 'mail.invite_heading_list', { name: from.name, title: what.title }),
    intro: t('mail.invite_intro'),
    button: { label: t('mail.invite_button'), url: `${origin}/signup` },
    extra: play ? { label: t('mail.invite_play'), url: play } : undefined,
    outro: t('mail.invite_outro'),
  });
  if (!(await sendMail(env, { to: email, subject: t('mail.invite_subject', { name: from.name }), ...body }))) await releaseMail(env.DB, slot.id);
}

/**
 * Na het bevestigen van een adres: elke niet-verlopen uitnodiging aan dat adres wordt een gewone uitnodiging (taak of
 * lijst, status `pending`). Verwijderde taken, eigen taken en eigen lijsten worden overgeslagen; daarna zijn alle
 * uitnodigingen aan dat adres weg.
 */
export async function claimEmailInvites(env: Env, userId: string): Promise<void> {
  const db = env.DB;
  const user = await db.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string | null }>();
  if (!user?.email) return;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare('INSERT INTO task_shares (id, task_id, from_user, to_user, mode, status, created_at) ' +
      "SELECT lower(hex(randomblob(16))), e.task_id, e.from_user, ?1, e.mode, 'pending', e.created_at FROM email_invites e " +
      'JOIN tasks t ON t.id = e.task_id WHERE e.email = ?2 AND e.expires_at > ?3 AND t.deleted_at IS NULL AND t.parent_id IS NULL ' +
      'AND t.user_id != ?1 ON CONFLICT (task_id, to_user) DO NOTHING').bind(userId, user.email, now),
    db.prepare('INSERT INTO list_members (list_id, user_id, role, status, name, created_at) ' +
      "SELECT e.list_id, ?1, 'member', 'pending', o.name, e.created_at FROM email_invites e JOIN shared_lists l ON l.id = e.list_id " +
      'JOIN list_members o ON o.list_id = e.list_id AND o.user_id = l.owner_id WHERE e.email = ?2 AND e.expires_at > ?3 AND l.owner_id != ?1 ' +
      'ON CONFLICT (list_id, user_id) DO NOTHING').bind(userId, user.email, now),
    db.prepare('DELETE FROM email_invites WHERE email = ?').bind(user.email),
  ]);
}
