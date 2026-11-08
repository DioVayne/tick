import type { Context } from 'hono';
import type { AppEnv, Env } from './index';
import { cleanEmail } from './account';
import { HttpError } from './errors';
import { mailEnabled, mailLayout, releaseMail, reserveMail, sendMail } from './mail';
import { inBackground, type Locale } from './push';
import { hashKey, newKey } from './keys';
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
export async function afterEmailInvite(c: Context<AppEnv>, inviteId: string, email: string, what: { kind: 'task' | 'list'; title: string }): Promise<void> {
  const me = c.get('user');
  await inBackground(c, sendInviteMail(c.env, { id: me.id, name: me.name }, inviteId, email, what, new URL(c.req.url).origin, c.get('lang')), 'uitnodigingsmail');
}

/**
 * Uitnodigingsmail aan een adres zonder (bevestigd) account: wie deelt, wat Tick is, en waar je een account maakt.
 * Grenzen: per deler 5 per dag (zonder wachttijd), per adres 1 per dag, en samen hooguit de helft van de daggrens.
 * Geen e-mailadres in een link.
 */
export async function sendInviteMail(env: Env, from: { id: string; name: string }, inviteId: string, email: string, what: { kind: 'task' | 'list'; title: string },
  origin: string, lang: Locale): Promise<void> {
  if (!mailEnabled(env)) return;
  const slot = await reserveMail(env.DB, env, 'invite_mail', from.id, Date.now(), { gapMs: 0, perDay: 5, dailyShare: 0.5, recipient: email });
  if (typeof slot !== 'object') return;
  // Een unieke link voor deze uitnodiging; alleen de hash komt in de database.
  const code = newKey().slice('tick_'.length);
  await env.DB.prepare('UPDATE email_invites SET join_hash = ? WHERE id = ?').bind(await hashKey(code), inviteId).run();
  const t = (key: string, vars: Record<string, string> = {}) => translate(lang, key, vars);
  const play = env.PLAY_STORE_URL?.trim();
  const body = mailLayout(lang, {
    heading: t(what.kind === 'task' ? 'mail.invite_heading_task' : 'mail.invite_heading_list', { name: from.name, title: what.title }),
    intro: t('mail.invite_intro'),
    button: { label: t('mail.invite_button'), url: `${origin}/join/${code}` },
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
  const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string | null }>();
  if (user?.email) await claimInvites(env, userId, { email: user.email });
}

/**
 * Zet uitnodigingen aan adressen om in gewone uitnodigingen voor `userId`: alle aan een adres (na bevestigen), of één
 * via de link uit de mail (`/join/<code>`: wie de link heeft, kreeg de mail). Daarna zijn die uitnodigingen weg.
 */
export async function claimInvites(env: Env, userId: string, by: { email: string } | { inviteId: string }): Promise<void> {
  const db = env.DB;
  const where = 'email' in by ? 'e.email = ?2' : 'e.id = ?2';
  const key = 'email' in by ? by.email : by.inviteId;
  const now = new Date().toISOString();
  await db.batch([
    // Met de id van de uitnodiging: de deler ziet dan niets veranderen tot de ontvanger accepteert.
    db.prepare('INSERT INTO task_shares (id, task_id, from_user, to_user, mode, status, created_at) ' +
      "SELECT e.id, e.task_id, e.from_user, ?1, e.mode, 'pending', e.created_at FROM email_invites e " +
      `JOIN tasks t ON t.id = e.task_id WHERE ${where} AND e.expires_at > ?3 AND t.deleted_at IS NULL AND t.parent_id IS NULL ` +
      // Dezelfde controles als bij gewoon delen: een taak in een gedeelde lijst deel je via de lijst (alleen een kopie
      // kan los), en een kopie niet aan iemand die al een exemplaar in de groep heeft.
      "AND t.user_id != ?1 AND (e.mode = 'copy' OR t.shared_list IS NULL) " +
      "AND NOT (e.mode = 'copy' AND t.copy_group IS NOT NULL AND EXISTS (SELECT 1 FROM tasks m WHERE m.user_id = ?1 AND m.copy_group = t.copy_group " +
      'AND m.parent_id IS NULL AND m.deleted_at IS NULL)) ON CONFLICT (task_id, to_user) DO NOTHING').bind(userId, key, now),
    db.prepare('INSERT INTO list_members (list_id, user_id, role, status, name, created_at) ' +
      "SELECT e.list_id, ?1, 'member', 'pending', o.name, e.created_at FROM email_invites e JOIN shared_lists l ON l.id = e.list_id " +
      `JOIN list_members o ON o.list_id = e.list_id AND o.user_id = l.owner_id WHERE ${where} AND e.expires_at > ?3 AND l.owner_id != ?1 ` +
      'ON CONFLICT (list_id, user_id) DO NOTHING').bind(userId, key, now),
    db.prepare(`DELETE FROM email_invites WHERE ${where.replace('?2', '?1').replace('e.', '')}`).bind(key),
  ]);
}

/** De uitnodiging achter een code uit de mail (niet verlopen), met wie deelt en wat; null als de code niet (meer) werkt. */
export async function inviteByCode(db: D1Database, code: string): Promise<{ id: string; email: string; from_name: string; title: string } | null> {
  if (!code) return null;
  return db.prepare('SELECT e.id, e.email, u.name AS from_name, COALESCE(t.title, m.name) AS title FROM email_invites e ' +
    'JOIN users u ON u.id = e.from_user LEFT JOIN tasks t ON t.id = e.task_id ' +
    'LEFT JOIN shared_lists l ON l.id = e.list_id LEFT JOIN list_members m ON m.list_id = l.id AND m.user_id = l.owner_id ' +
    'WHERE e.join_hash = ? AND e.expires_at > ?').bind(await hashKey(code), new Date().toISOString())
    .first<{ id: string; email: string; from_name: string; title: string }>();
}

/**
 * Op een openbare Tick ziet de eigenaar van een gedeelde lijst een openstaand lid niet onder zijn account-id (een
 * uitnodiging aan een adres heeft er geen): beide krijgen `mail:<uuid>`. Voor een lid is die uuid afgeleid van lijst en
 * account, voor een uitnodiging aan een adres is het de id van de uitnodiging.
 */
export async function pendingMemberId(listId: string, userId: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`member:${listId}:${userId}`)));
  const h = [...d.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${MAIL_PREFIX}${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
