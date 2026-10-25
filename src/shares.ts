import { Hono } from 'hono';
import type { AppEnv, Env, TaskRow } from './index';
import { HttpError } from './errors';
import { getAccess, STEP, topMin } from './access';
import { postWebhook, sendToAll, type Payload, type Sender } from './push';
import { loadUserPrefs } from './prefs';
import { getUser } from './users';
import { translate } from '../public/i18n.js';
import { copyAttachmentStmt } from './attachments';

/** Taken delen: uitnodigen, uitnodigingen bekijken, accepteren, weigeren en stoppen. */
export const sharesApi = new Hono<AppEnv>();

type ShareRow = {
  id: string; task_id: string; from_user: string; to_user: string; mode: 'shared' | 'copy'; status: 'pending' | 'accepted';
  list: string | null; position: number | null; created_at: string; responded_at: string | null;
};

const now = () => new Date().toISOString();

/** Heeft userId al een (niet-verwijderd) exemplaar in de kopiegroep van deze taak? Zonder groep is het altijd nee. */
async function hasCopyInGroup(db: D1Database, taskId: string, userId: string): Promise<boolean> {
  const r = await db.prepare('SELECT 1 AS x FROM tasks m WHERE m.user_id = ? AND m.parent_id IS NULL AND m.deleted_at IS NULL AND m.copy_group IS NOT NULL ' +
    'AND m.copy_group = (SELECT copy_group FROM tasks WHERE id = ?) LIMIT 1').bind(userId, taskId).first();
  return !!r;
}

/** Ontvanger op e-mailadres (exact) of anders op naam (getrimd); beide hoofdletterongevoelig. */
export async function findRecipient(db: D1Database, to: string): Promise<string> {
  const byEmail = await db.prepare('SELECT id FROM users WHERE email = ?').bind(to).first<{ id: string }>();
  if (byEmail) return byEmail.id;
  const { results } = await db.prepare('SELECT id FROM users WHERE lower(trim(name)) = lower(?) LIMIT 2').bind(to).all<{ id: string }>();
  if (!results.length) throw new HttpError(404, 'err.share_user_unknown');
  if (results.length > 1) throw new HttpError(409, 'err.share_user_ambiguous');
  return results[0].id;
}

/** De ontvanger uit een verzoek: uit de keuzelijst komt een id (`to_user`), getypt een naam of e-mailadres (`to`). */
export async function recipientOf(db: D1Database, b: Record<string, unknown>): Promise<string> {
  if (typeof b.to_user === 'string' && b.to_user) {
    const u = await db.prepare('SELECT id FROM users WHERE id = ?').bind(b.to_user).first<{ id: string }>();
    if (!u) throw new HttpError(404, 'err.share_user_unknown');
    return u.id;
  }
  const to = String(b.to ?? '').trim();
  if (!to) throw new HttpError(400, 'err.required', { field: 'to' });
  return findRecipient(db, to);
}

/** Melding aan de ontvanger: push in de taal van elk abonnement, zonder abonnement via zijn fallback-webhook. */
async function notifyInvite(env: Env, shareId: string, toUser: string, fromName: string, title: string, mode: string, defaultLocale: 'en' | 'nl') {
  const make = (locale: string): Payload => ({
    title: translate(locale, mode === 'copy' ? 'share.push_copy' : 'share.push_shared', { name: fromName }),
    body: title, url: `/?share=${shareId}`, shareId,
    actions: [{ action: 'accept', title: translate(locale, 'push.accept') }, { action: 'decline', title: translate(locale, 'push.decline') }],
  });
  const { total } = await sendToAll(env, toUser, make, defaultLocale);
  if (total) return;
  const user = await getUser(env.DB, toUser);
  const hook = user && (await loadUserPrefs(env, user)).fallbackWebhook;
  if (hook) await postWebhook(hook, { ...make(defaultLocale), actions: undefined });
}

/**
 * Push naar de eigenaar en de geaccepteerde deelnemers van een gedeelde hoofdtaak, behalve naar wie het deed.
 * Zonder abonnement via de eigen fallback-webhook (zoals bij uitnodigingen). In een gedeelde lijst niet naar de
 * leden (die hebben hun eigen meldingen), alleen naar wie de taak per taak deelt zonder lid te zijn.
 */
async function notifyShareMembers(env: Env, task: TaskRow, actorId: string, make: (locale: string) => Payload, defaultLocale: 'en' | 'nl', send: Sender): Promise<void> {
  if (task.parent_id) return;
  const { results } = await env.DB.prepare(
    "SELECT uid FROM (SELECT ?1 AS uid UNION SELECT to_user FROM task_shares WHERE task_id = ?2 AND mode = 'shared' AND status = 'accepted') " +
    "WHERE ?3 IS NULL OR uid NOT IN (SELECT user_id FROM list_members WHERE list_id = ?3 AND status = 'accepted')",
  ).bind(task.user_id, task.id, task.shared_list ?? null).all<{ uid: string }>();
  for (const { uid } of results) {
    if (uid === actorId) continue;
    const { total } = await send(env, uid, make, defaultLocale);
    if (total) continue;
    const user = await getUser(env.DB, uid);
    const hook = user && (await loadUserPrefs(env, user)).fallbackWebhook;
    if (hook) await postWebhook(hook, { ...make(defaultLocale), actions: undefined });
  }
}

/** Push "{name} heeft hem afgevinkt ✓" naar de anderen die de taak delen. */
export function notifyShareDone(env: Env, task: TaskRow, actorId: string, actorName: string, defaultLocale: 'en' | 'nl', send: Sender = sendToAll): Promise<void> {
  return notifyShareMembers(env, task, actorId, (locale) => ({
    title: translate(locale, 'share.push_done', { name: actorName }), body: task.title, url: `/?task=${task.id}`, tag: `share-${task.id}`, actions: [],
  }), defaultLocale, send);
}

/**
 * Push "{name} gaf een gedeelde taak een plek" naar de anderen die de taak delen. Hun Android-app hoort een nieuwe
 * plek anders pas bij zijn volgende verversing; met geo=1 biedt Tick in de app aan om hem meteen te wekken.
 */
export function notifyShareLocation(env: Env, task: TaskRow, actorId: string, actorName: string, defaultLocale: 'en' | 'nl', send: Sender = sendToAll): Promise<void> {
  return notifyShareMembers(env, task, actorId, (locale) => ({
    title: translate(locale, 'share.push_location', { name: actorName }), body: task.title, url: `/?task=${task.id}&geo=1`, tag: `share-loc-${task.id}`, actions: [],
  }), defaultLocale, send);
}

sharesApi.post('/', async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => { throw new HttpError(400, 'err.invalid_json'); });
  if (b.mode !== 'shared' && b.mode !== 'copy') throw new HttpError(400, 'err.share_mode');
  const db = c.env.DB;
  const userId = c.get('auth').userId;
  const task = await getAccess(db, userId, String(b.task_id ?? ''));
  if (!task) throw new HttpError(404, 'err.not_found');
  // In een gedeelde lijst deel je de lijst, niet de taak; een kopie sturen kan wel.
  if (b.mode === 'shared' && task.shared_list) throw new HttpError(400, 'err.share_in_shared_list');
  if (task.user_id !== userId) throw new HttpError(403, 'err.share_owner_only');
  if (task.parent_id) throw new HttpError(400, 'err.share_subtask');
  const toUser = await recipientOf(db, b);
  if (toUser === userId) throw new HttpError(400, 'err.share_self');
  if (await hasCopyInGroup(db, task.id, toUser)) throw new HttpError(409, 'err.copy_exists');
  const row: ShareRow = {
    id: crypto.randomUUID(), task_id: task.id, from_user: userId, to_user: toUser, mode: b.mode, status: 'pending',
    list: null, position: null, created_at: now(), responded_at: null,
  };
  const res = await db.prepare('INSERT INTO task_shares (id, task_id, from_user, to_user, mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT (task_id, to_user) DO NOTHING').bind(row.id, row.task_id, userId, toUser, row.mode, 'pending', row.created_at).run();
  if (!res.meta.changes) throw new HttpError(409, 'err.share_exists');
  // Een mislukte melding laat de uitnodiging staan; die is altijd in de app te zien.
  const sending = notifyInvite(c.env, row.id, toUser, c.get('user').name, task.title, row.mode, c.get('install').defaultLocale)
    .catch((e) => console.warn('uitnodiging melden mislukt', (e as Error).message));
  try { c.executionCtx.waitUntil(sending); } catch { await sending; }
  return c.json(row, 201);
});

/**
 * De andere accounts op deze installatie, voor de keuzelijst in de deeldialoog: alleen id en naam. Tick is voor een
 * huishouden of klein team; wie een account heeft, mag de namen van de anderen zien om met hen te delen.
 */
sharesApi.get('/people', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, name FROM users WHERE id != ? ORDER BY lower(name), id')
    .bind(c.get('auth').userId).all<{ id: string; name: string }>();
  return c.json(results);
});

sharesApi.get('/incoming', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT s.id, s.mode, s.created_at, t.title, t.description, t.remind_at, u.name AS from_name, ' +
    '(SELECT count(*) FROM tasks k WHERE k.parent_id = t.id AND k.deleted_at IS NULL) AS subtasks ' +
    "FROM task_shares s JOIN tasks t ON t.id = s.task_id JOIN users u ON u.id = s.from_user WHERE s.to_user = ? AND s.status = 'pending' " +
    'AND t.deleted_at IS NULL ORDER BY s.created_at DESC',
  ).bind(c.get('auth').userId).all<{ id: string; mode: string; created_at: string; title: string; description: string; remind_at: string | null; from_name: string; subtasks: number }>();
  return c.json(results.map((r) => ({
    id: r.id, mode: r.mode, created_at: r.created_at, from: { name: r.from_name },
    task: { title: r.title, description: r.description, remind_at: r.remind_at, subtasks: r.subtasks },
  })));
});

/**
 * Kopie accepteren: nieuwe taken van de ontvanger met nieuwe ids, zoals het origineel nu is, subtaken allemaal open.
 * De hoofdtaak komt in de kopiegroep van het origineel; die groep wordt eerst aangemaakt als ze er nog niet is. De
 * insert leest de groep met een subquery, zodat gelijktijdige accepts dezelfde groep krijgen.
 */
function copyStmts(db: D1Database, src: TaskRow, kids: TaskRow[], userId: string, position: number): D1PreparedStatement[] {
  const ts = now();
  const past = (iso: string | null) => (iso && Date.parse(iso) <= Date.now() ? 1 : 0);
  const insert = db.prepare(
    'INSERT INTO tasks (id, user_id, title, description, list, parent_id, position, remind_at, notified, done, source, created_at, updated_at, ' +
    'loc_name, loc_lat, loc_lng, loc_radius, loc_trigger, loc_notified, repeat_rule, repeat_start, repeat_at, copy_group) ' +
    "VALUES (?, ?, ?, ?, 'Inbox', ?, ?, ?, ?, 0, 'share', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, (SELECT copy_group FROM tasks WHERE id = ?))");
  const row = (t: TaskRow, id: string, parent: string | null, pos: number) => insert.bind(
    id, userId, t.title, t.description, parent, pos, t.remind_at, past(t.remind_at), ts, ts,
    t.loc_name, t.loc_lat, t.loc_lng, t.loc_radius, t.loc_trigger, t.repeat_rule, t.repeat_start, t.repeat_at,
    parent ? null : src.id); // alleen de hoofdtaak krijgt de groep, gelezen op het moment van invoegen
  const id = crypto.randomUUID();
  const kidIds = kids.map(() => crypto.randomUUID());
  return [
    db.prepare('UPDATE tasks SET copy_group = ? WHERE id = ? AND copy_group IS NULL').bind(crypto.randomUUID(), src.id),
    row(src, id, null, position), ...kids.map((k, i) => row(k, kidIds[i], id, k.position)),
    // De bijlagen gaan mee als verwijzing naar hetzelfde R2-object.
    copyAttachmentStmt(db, src.id, id), ...kids.map((k, i) => copyAttachmentStmt(db, k.id, kidIds[i])),
  ];
}

sharesApi.post('/:id/accept', async (c) => {
  const db = c.env.DB;
  const userId = c.get('auth').userId;
  const s = await db.prepare("SELECT * FROM task_shares WHERE id = ? AND to_user = ? AND status = 'pending'").bind(c.req.param('id'), userId).first<ShareRow>();
  if (!s) throw new HttpError(404, 'err.not_found');
  const task = await db.prepare('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL').bind(s.task_id).first<TaskRow>();
  if (!task) {
    await db.prepare('DELETE FROM task_shares WHERE id = ?').bind(s.id).run();
    throw new HttpError(410, 'err.share_gone');
  }
  const position = ((await topMin(db, userId)) ?? 0) - STEP;
  if (s.mode === 'shared') {
    const res = await db.prepare("UPDATE task_shares SET status = 'accepted', list = 'Inbox', position = ?, responded_at = ? WHERE id = ? AND status = 'pending'")
      .bind(position, now(), s.id).run();
    if (!res.meta.changes) throw new HttpError(404, 'err.not_found'); // intussen geweigerd of ingetrokken
    return c.json({ ok: true, task_id: task.id });
  }
  const { results: kids } = await db.prepare('SELECT * FROM tasks WHERE parent_id = ? AND deleted_at IS NULL ORDER BY position').bind(task.id).all<TaskRow>();
  // Eerst de deelrij weghalen: alleen wie hem echt weghaalt, maakt de kopie. Een gelijktijdige accept, weigering of
  // intrekking vindt hem dan niet meer, en er komt nooit een kopie van een uitnodiging die er niet meer is.
  const claim = await db.prepare("DELETE FROM task_shares WHERE id = ? AND status = 'pending'").bind(s.id).run();
  if (!claim.meta.changes) throw new HttpError(404, 'err.not_found');
  // Intussen kan een andere uitnodiging uit dezelfde groep al zijn geaccepteerd: één exemplaar per persoon. De rij is al weg.
  if (await hasCopyInGroup(db, task.id, userId)) throw new HttpError(409, 'err.copy_exists');
  await db.batch(copyStmts(db, task, kids, userId, position));
  return c.json({ ok: true });
});

sharesApi.post('/:id/decline', async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM task_shares WHERE id = ? AND to_user = ? AND status = 'pending'")
    .bind(c.req.param('id'), c.get('auth').userId).run();
  if (!res.meta.changes) throw new HttpError(404, 'err.not_found');
  return c.json({ ok: true });
});

/** Stoppen met delen (de ontvanger), of iemand eraf halen of een uitnodiging intrekken (de eigenaar). */
sharesApi.delete('/:id', async (c) => {
  const db = c.env.DB;
  const userId = c.get('auth').userId;
  const s = await db.prepare(
    'SELECT s.id, s.task_id, s.to_user, EXISTS (SELECT 1 FROM list_members m WHERE m.list_id = t.shared_list AND m.user_id = s.to_user ' +
    "AND m.status = 'accepted') AS in_list FROM task_shares s JOIN tasks t ON t.id = s.task_id WHERE s.id = ?1 AND (s.to_user = ?2 OR t.user_id = ?2)",
  ).bind(c.req.param('id'), userId).first<{ id: string; task_id: string; to_user: string; in_list: number }>();
  if (!s) throw new HttpError(404, 'err.not_found');
  // De deelrij van een lid van de gedeelde lijst hoort bij de lijst: daar vertrek je, of haalt de eigenaar je eruit.
  if (s.in_list) throw new HttpError(400, 'err.share_is_list');
  await db.batch(leaveShareStmts(db, s.id, s.task_id, s.to_user));
  return c.json({ ok: true });
});

/**
 * Statements die een deelrij wissen, met de bezorgrijen van die persoon voor de taak en haar subtaken: deelt iemand
 * de taak later opnieuw, dan telt een herinnering niet meer als al bij hem bezorgd.
 */
export function leaveShareStmts(db: D1Database, shareId: string, taskId: string, userId: string): D1PreparedStatement[] {
  return [
    db.prepare('DELETE FROM task_shares WHERE id = ?').bind(shareId),
    db.prepare('DELETE FROM reminder_sent WHERE user_id = ?1 AND (task_id = ?2 OR task_id IN (SELECT id FROM tasks WHERE parent_id = ?2))').bind(userId, taskId),
  ];
}
