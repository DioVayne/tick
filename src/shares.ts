import { Hono, type Context } from 'hono';
import type { AppEnv, Env, TaskRow } from './index';
import { HttpError } from './errors';
import { getAccess, STEP, topMin } from './access';
import { inBackground, notifyUser, sendToAll, type Payload, type Sender } from './push';
import { translate } from '../public/i18n.js';
import { copyAttachmentStmt } from './attachments';
import { addEmailInvite, afterEmailInvite, assertMayShareWith, knownPeople, resolveOpenRecipient, revokeEmailInvite } from './invites';
import { openSignup } from './signup';

/** Taken delen: uitnodigen, uitnodigingen bekijken, accepteren, weigeren en stoppen. */
export const sharesApi = new Hono<AppEnv>();

type ShareRow = {
  id: string; task_id: string; from_user: string; to_user: string; mode: 'shared' | 'copy'; status: 'pending' | 'accepted';
  list: string | null; position: number | null; created_at: string; responded_at: string | null;
  pinned?: number; loc_notified?: number;
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
  await notifyUser(env, toUser, make, defaultLocale);
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
    if (uid !== actorId) await notifyUser(env, uid, make, defaultLocale, send);
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
  const open = openSignup(c.env);
  let toUser: string;
  if (open) {
    // Openbare Tick: alleen e-mailadres (of een bekende), en hetzelfde antwoord met of zonder account erachter.
    const to = await resolveOpenRecipient(c.env, c.get('user'), b);
    await assertMayShareWith(c.env, c.get('user'), to);
    if ('email' in to) {
      // Staat er al een uitnodiging aan dit adres in de andere vorm, dan krijgt die de nieuwe vorm.
      const sw = await db.prepare('UPDATE email_invites SET mode = ?1 WHERE email = ?2 AND task_id = ?3 AND from_user = ?4 AND mode != ?1 AND expires_at > ?5')
        .bind(b.mode, to.email, task.id, userId, now()).run();
      if (sw.meta.changes) return c.json({ ok: true, status: 'pending', mode: b.mode, changed: 'mode' });
      const inv = await addEmailInvite(db, userId, to.email, { kind: 'task', taskId: task.id, mode: b.mode });
      await afterEmailInvite(c, inv.id, to.email, { kind: 'task', title: task.title }, to.silent);
      return c.json({ ok: true, status: 'pending', mode: b.mode }, 201);
    }
    toUser = to.userId;
  } else toUser = await recipientOf(db, b);
  if (toUser === userId) throw new HttpError(400, 'err.share_self');
  const existing = await db.prepare(
    "SELECT s.*, EXISTS (SELECT 1 FROM list_members m WHERE m.list_id = ?3 AND m.user_id = s.to_user AND m.status = 'accepted') AS in_list " +
    'FROM task_shares s WHERE s.task_id = ?1 AND s.to_user = ?2').bind(task.id, toUser, task.shared_list ?? null).first<ShareRow & { in_list: number }>();
  if (existing) return switchMode(c, task, existing, b.mode, b.convert === true, open);
  if (await hasCopyInGroup(db, task.id, toUser)) {
    // Openbare Tick: niet verraden dat dit adres een account in de groep heeft; er gebeurt gewoon niets.
    if (open) return c.json({ ok: true, status: 'pending', mode: b.mode }, 201);
    // Een eigen kopie wordt niet vanzelf weer gedeeld: die kan veranderd of afgevinkt zijn. Eerst moet hij weg.
    throw new HttpError(409, b.mode === 'shared' ? 'err.copy_exists_shared' : 'err.copy_exists');
  }
  const row: ShareRow = {
    id: crypto.randomUUID(), task_id: task.id, from_user: userId, to_user: toUser, mode: b.mode, status: 'pending',
    list: null, position: null, created_at: now(), responded_at: null,
  };
  const res = await db.prepare('INSERT INTO task_shares (id, task_id, from_user, to_user, mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT (task_id, to_user) DO NOTHING').bind(row.id, row.task_id, userId, toUser, row.mode, 'pending', row.created_at).run();
  if (!res.meta.changes) throw new HttpError(409, 'err.share_exists');
  // Een mislukte melding laat de uitnodiging staan; die is altijd in de app te zien.
  await inBackground(c, notifyInvite(c.env, row.id, toUser, c.get('user').name, task.title, row.mode, c.get('install').defaultLocale), 'uitnodiging');
  return open ? c.json({ ok: true, status: 'pending', mode: row.mode }, 201) : c.json(row, 201);
});

/**
 * De andere accounts op deze installatie, voor de keuzelijst in de deeldialoog: alleen id en naam. Tick is voor een
 * huishouden of klein team; wie een account heeft, mag de namen van de anderen zien om met hen te delen.
 */
sharesApi.get('/people', async (c) => {
  if (openSignup(c.env)) return c.json(await knownPeople(c.env.DB, c.get('auth').userId));
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

/** Waar een kopie komt: lijst, plek, pin en locatiemelding van de hoofdtaak; `keepDone` houdt afgevinkt zoals het is. */
type CopyPlace = { list: string; position: number; pinned: number; locNotified: number; keepDone: boolean };

/**
 * Kopie accepteren: nieuwe taken van de ontvanger met nieuwe ids, zoals het origineel nu is, subtaken allemaal open.
 * De hoofdtaak komt in de kopiegroep van het origineel; die groep wordt eerst aangemaakt als ze er nog niet is. De
 * insert leest de groep met een subquery, zodat gelijktijdige accepts dezelfde groep krijgen.
 */
function copyStmts(db: D1Database, src: TaskRow, kids: TaskRow[], userId: string, fromUser: string, position: number,
  place: CopyPlace = { list: 'Inbox', position, pinned: 0, locNotified: 0, keepDone: false }): D1PreparedStatement[] {
  const ts = now();
  const past = (iso: string | null) => (iso && Date.parse(iso) <= Date.now() ? 1 : 0);
  const insert = db.prepare(
    'INSERT INTO tasks (id, user_id, title, description, list, parent_id, position, remind_at, notified, done, done_at, pinned, source, created_at, updated_at, ' +
    'loc_name, loc_lat, loc_lng, loc_radius, loc_trigger, loc_more, loc_notified, repeat_rule, repeat_start, repeat_at, copy_group, copied_from) ' +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'share', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT copy_group FROM tasks WHERE id = ?), ?)");
  const row = (t: TaskRow, id: string, parent: string | null, pos: number) => insert.bind(
    id, userId, t.title, t.description, place.list, parent, pos, t.remind_at, past(t.remind_at),
    place.keepDone ? t.done : 0, place.keepDone ? t.done_at : null, parent ? 0 : place.pinned, ts, ts,
    t.loc_name, t.loc_lat, t.loc_lng, t.loc_radius, t.loc_trigger, t.loc_more, parent ? 0 : place.locNotified, t.repeat_rule, t.repeat_start, t.repeat_at,
    parent ? null : src.id, // alleen de hoofdtaak krijgt de groep, gelezen op het moment van invoegen
    parent ? null : fromUser); // en wie hem stuurde ("Kopie van …")
  const id = crypto.randomUUID();
  const kidIds = kids.map(() => crypto.randomUUID());
  return [
    db.prepare('UPDATE tasks SET copy_group = ? WHERE id = ? AND copy_group IS NULL').bind(crypto.randomUUID(), src.id),
    row(src, id, null, place.position), ...kids.map((k, i) => row(k, kidIds[i], id, k.position)),
    // De bijlagen gaan mee als verwijzing naar hetzelfde R2-object.
    copyAttachmentStmt(db, src.id, id), ...kids.map((k, i) => copyAttachmentStmt(db, k.id, kidIds[i])),
  ];
}

/**
 * Iemand zit al op de taak (`s`) en de eigenaar kiest een vorm. Dezelfde vorm, of iemand die via de gedeelde lijst
 * meedoet: 409. Een openstaande uitnodiging krijgt de nieuwe vorm (de ontvanger ziet dan de nieuwe tekst). Een
 * geaccepteerde gedeelde taak wordt na bevestiging (`convert`, anders 428) een eigen kopie van de ontvanger, zoals de
 * taak nu is, op zijn plek in zijn lijst; de deelrij gaat weg, het origineel blijft. Een geaccepteerde kopie heeft geen
 * deelrij meer en komt hier dus niet.
 */
async function switchMode(c: Context<AppEnv>, task: TaskRow, s: ShareRow & { in_list: number }, mode: 'shared' | 'copy', convert: boolean, open: boolean) {
  const db = c.env.DB;
  if (s.mode === mode || s.in_list) throw new HttpError(409, 'err.share_exists');
  if (s.status === 'pending') {
    if (mode === 'copy' && await hasCopyInGroup(db, task.id, s.to_user)) {
      // Openbare Tick: zoals bij een nieuwe uitnodiging niets verraden; er gebeurt gewoon niets.
      if (open) return c.json({ ok: true, status: 'pending', mode, changed: 'mode' });
      throw new HttpError(409, 'err.copy_exists');
    }
    const res = await db.prepare("UPDATE task_shares SET mode = ? WHERE id = ? AND status = 'pending' AND mode = ?").bind(mode, s.id, s.mode).run();
    if (!res.meta.changes) throw new HttpError(409, 'err.share_exists'); // intussen geaccepteerd, geweigerd of al omgezet
    if (open) return c.json({ ok: true, status: 'pending', mode, changed: 'mode' });
    const { in_list: _, ...row } = s;
    return c.json({ ...row, mode, changed: 'mode' });
  }
  if (!convert) throw new HttpError(428, 'err.share_to_copy_confirm');
  const { results: kids } = await db.prepare('SELECT * FROM tasks WHERE parent_id = ? AND deleted_at IS NULL ORDER BY position').bind(task.id).all<TaskRow>();
  // Zoals bij accepteren: eerst de deelrij weghalen, zodat er maar één kopie komt. Mislukt de kopie, dan komt de rij terug.
  const claim = await db.prepare("DELETE FROM task_shares WHERE id = ? AND status = 'accepted' AND mode = 'shared'").bind(s.id).run();
  if (!claim.meta.changes) throw new HttpError(409, 'err.share_exists');
  const position = s.position ?? (((await topMin(db, s.to_user)) ?? 0) - STEP);
  try {
    await db.batch([
      ...copyStmts(db, task, kids, s.to_user, task.user_id, position,
        { list: s.list ?? 'Inbox', position, pinned: s.pinned ?? 0, locNotified: s.loc_notified ?? 0, keepDone: true }),
      // De bezorgrijen van de ontvanger voor het origineel (de deelrij zelf is al weg).
      ...leaveShareStmts(db, s.id, task.id, s.to_user).slice(1),
    ]);
  } catch (e) {
    await db.prepare('INSERT OR IGNORE INTO task_shares (id, task_id, from_user, to_user, mode, status, list, position, pinned, loc_notified, created_at, responded_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(s.id, s.task_id, s.from_user, s.to_user, s.mode, s.status, s.list, s.position,
      s.pinned ?? 0, s.loc_notified ?? 0, s.created_at, s.responded_at).run();
    throw e;
  }
  return c.json({ ok: true, changed: 'copy' });
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
  await db.batch(copyStmts(db, task, kids, userId, s.from_user, position));
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
  if (!s) {
    // Een uitnodiging aan een e-mailadres (openbare Tick) trekt alleen de deler in.
    if (await revokeEmailInvite(db, userId, c.req.param('id'))) return c.json({ ok: true });
    throw new HttpError(404, 'err.not_found');
  }
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
