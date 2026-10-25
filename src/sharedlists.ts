import { Hono, type Context } from 'hono';
import type { AppEnv, Env, TaskRow } from './index';
import { HttpError } from './errors';
import { STEP, topMin } from './access';
import { postWebhook, sendToAll, type Payload, type Sender } from './push';
import { loadUserPrefs } from './prefs';
import { getUser } from './users';
import { recipientOf } from './shares';
import { translate } from '../public/i18n.js';

/**
 * Gedeelde lijsten: een lijst delen, de uitnodiging accepteren of weigeren, vertrekken en iemand eruit halen.
 * Elke hoofdtaak in de lijst is van de eigenaar (`tasks.user_id`) en draagt `tasks.shared_list`; elk ander
 * geaccepteerd lid heeft er een gewone deelrij voor (modus shared). Toegang loopt dus via `src/access.ts`, zoals bij
 * een gedeelde taak; een openstaande uitnodiging heeft geen deelrijen en geeft geen toegang.
 */
export const sharedListsApi = new Hono<AppEnv>();

/** Een geaccepteerd lidmaatschap; `name` is de naam van de lijst bij deze gebruiker. */
export type ListRef = { id: string; owner_id: string; owner_name: string; name: string; role: 'owner' | 'member' };

/** Deelstatus van een lijst voor `GET /api/lists`; `members` zonder de eigenaar, `pending` alleen voor de eigenaar. */
export type ListShare = {
  id: string; mine: boolean; owner: { id: string; name: string };
  members: { user_id: string; name: string; status: 'pending' | 'accepted' }[]; notify_done: boolean;
};

/** De push van deze routes; tests zetten er een nep-sender in (zoals `send` bij notifyShareDone). */
export const listPush: { send: Sender } = { send: sendToAll };

const now = () => new Date().toISOString();

const REF = 'SELECT m.list_id AS id, l.owner_id, o.name AS owner_name, m.name, m.role FROM list_members m ' +
  "JOIN shared_lists l ON l.id = m.list_id JOIN users o ON o.id = l.owner_id WHERE m.user_id = ? AND m.status = 'accepted' AND ";

/** Het geaccepteerde lidmaatschap met deze naam, of null. */
export function listOf(db: D1Database, userId: string, name: string): Promise<ListRef | null> {
  return db.prepare(REF + 'm.name = ?').bind(userId, name).first<ListRef>();
}

/** Het geaccepteerde lidmaatschap van deze lijst, of null. */
export function listById(db: D1Database, userId: string, listId: string): Promise<ListRef | null> {
  return db.prepare(REF + 'm.list_id = ?').bind(userId, listId).first<ListRef>();
}

/** Alle lijstnamen die `GET /api/lists` deze gebruiker toont (eigen taken, deelnames, bewaarde lijsten, lidmaatschappen). */
export async function listNames(db: D1Database, userId: string): Promise<Set<string>> {
  const { results } = await db.prepare(
    'SELECT list AS name FROM tasks WHERE user_id = ?1 AND deleted_at IS NULL ' +
    "UNION SELECT s.list FROM task_shares s JOIN tasks t ON t.id = s.task_id WHERE s.to_user = ?1 AND s.status = 'accepted' AND t.deleted_at IS NULL " +
    'UNION SELECT name FROM lists WHERE user_id = ?1 ' +
    "UNION SELECT name FROM list_members WHERE user_id = ?1 AND status = 'accepted'",
  ).bind(userId).all<{ name: string | null }>();
  return new Set(['Inbox', ...results.flatMap((r) => (r.name === null ? [] : [r.name]))]);
}

/**
 * Maakt een eigen hoofdtaak (met subtaken) deel van de lijst: van de eigenaar, in diens naam van de lijst, met een
 * deelrij voor elk ander geaccepteerd lid. De aanvrager krijgt `actorPosition`, de anderen komen bovenaan.
 */
export async function attachStmts(db: D1Database, task: Pick<TaskRow, 'id'>, list: ListRef, actorId: string, actorPosition: number): Promise<D1PreparedStatement[]> {
  const { results: members } = await db.prepare("SELECT user_id, name FROM list_members WHERE list_id = ? AND status = 'accepted'")
    .bind(list.id).all<{ user_id: string; name: string }>();
  const ts = now();
  const position = async (uid: string) => (uid === actorId ? actorPosition : ((await topMin(db, uid)) ?? 0) - STEP);
  const ownerName = members.find((m) => m.user_id === list.owner_id)?.name ?? list.name;
  const stmts = [
    db.prepare('UPDATE tasks SET user_id = ?1, list = ?2, updated_at = ?3 WHERE id = ?4 OR parent_id = ?4').bind(list.owner_id, ownerName, ts, task.id),
    db.prepare('UPDATE tasks SET shared_list = ?, position = ? WHERE id = ?').bind(list.id, await position(list.owner_id), task.id),
    // De eigenaar heeft de taak nu zelf; een deelrij voor hem zou hem dubbel geven.
    db.prepare('DELETE FROM task_shares WHERE task_id = ? AND to_user = ?').bind(task.id, list.owner_id),
  ];
  for (const m of members) {
    if (m.user_id === list.owner_id) continue;
    stmts.push(db.prepare(
      "INSERT INTO task_shares (id, task_id, from_user, to_user, mode, status, list, position, created_at, responded_at) VALUES (?, ?, ?, ?, 'shared', 'accepted', ?, ?, ?, ?) " +
      "ON CONFLICT (task_id, to_user) DO UPDATE SET mode = 'shared', status = 'accepted', list = excluded.list, position = excluded.position, responded_at = excluded.responded_at",
    ).bind(crypto.randomUUID(), task.id, list.owner_id, m.user_id, m.name, await position(m.user_id), ts, ts));
  }
  return stmts;
}

/**
 * Maakt een hoofdtaak uit een gedeelde lijst een persoonlijke taak van `actorId` in `list`, met zijn subtaken. Alle
 * deelrijen gaan weg, en de meldrijen van de anderen (`task_watch`, `reminder_sent`). Zonder melding.
 */
export function detachStmts(db: D1Database, task: Pick<TaskRow, 'id'>, actorId: string, list: string, position: number): D1PreparedStatement[] {
  const family = '(task_id = ?2 OR task_id IN (SELECT id FROM tasks WHERE parent_id = ?2))';
  return [
    db.prepare('UPDATE tasks SET user_id = ?1, list = ?2, updated_at = ?3 WHERE id = ?4 OR parent_id = ?4').bind(actorId, list, now(), task.id),
    db.prepare('UPDATE tasks SET position = ?, shared_list = NULL, claimed_by = NULL WHERE id = ?').bind(position, task.id),
    db.prepare('DELETE FROM task_shares WHERE task_id = ?').bind(task.id),
    db.prepare(`DELETE FROM task_watch WHERE user_id != ?1 AND ${family}`).bind(actorId, task.id),
    db.prepare(`DELETE FROM reminder_sent WHERE user_id != ?1 AND ${family}`).bind(actorId, task.id),
  ];
}

/**
 * De eigenaar heft de lijst op en houdt de taken: zoals `detachStmts` naar de eigenaar voor elke hoofdtaak van de
 * lijst (ook in de prullenbak), maar in een vast aantal statements, want D1 telt elk statement van een batch als
 * query. De lijstnaam verandert hier niet (dat doet de route); het lidmaatschap gaat weg met de cascade.
 */
export function dissolveStmts(db: D1Database, listId: string, ownerId: string): D1PreparedStatement[] {
  const inList = 'SELECT id FROM tasks WHERE shared_list = ?1';
  const family = `(task_id IN (${inList}) OR task_id IN (SELECT id FROM tasks WHERE parent_id IN (${inList})))`;
  return [
    db.prepare(`DELETE FROM task_shares WHERE task_id IN (${inList})`).bind(listId),
    db.prepare(`DELETE FROM task_watch WHERE user_id != ?2 AND ${family}`).bind(listId, ownerId),
    db.prepare(`DELETE FROM reminder_sent WHERE user_id != ?2 AND ${family}`).bind(listId, ownerId),
    db.prepare('UPDATE tasks SET shared_list = NULL, claimed_by = NULL, updated_at = ?2 WHERE shared_list = ?1').bind(listId, now()),
    db.prepare('DELETE FROM shared_lists WHERE id = ?').bind(listId),
  ];
}

/**
 * Statements voor vertrekken of eruit gehaald worden: de deelrijen van de gebruiker op de taken van de lijst (ook in
 * de prullenbak), zijn meldrijen op die taken en hun subtaken, zijn naam op taken, en zijn lidmaatschap. De taken
 * zelf blijven bij de eigenaar.
 */
export function leaveListStmts(db: D1Database, listId: string, userId: string): D1PreparedStatement[] {
  const inList = 'SELECT id FROM tasks WHERE shared_list = ?1';
  return [
    db.prepare(`DELETE FROM reminder_sent WHERE user_id = ?2 AND (task_id IN (${inList}) OR task_id IN (SELECT id FROM tasks WHERE parent_id IN (${inList})))`).bind(listId, userId),
    db.prepare(`DELETE FROM task_watch WHERE user_id = ?2 AND task_id IN (${inList})`).bind(listId, userId),
    db.prepare('UPDATE tasks SET claimed_by = NULL, updated_at = ?3 WHERE shared_list = ?1 AND claimed_by = ?2').bind(listId, userId, now()),
    db.prepare(`DELETE FROM task_shares WHERE to_user = ?2 AND task_id IN (${inList})`).bind(listId, userId),
    db.prepare('DELETE FROM list_members WHERE list_id = ? AND user_id = ?').bind(listId, userId),
  ];
}

/** Deelstatus per lijst waar je geaccepteerd lid van bent, met als sleutel jouw naam van de lijst. */
export async function listSharing(db: D1Database, userId: string): Promise<Map<string, ListShare>> {
  const { results } = await db.prepare(
    'SELECT me.list_id, me.name AS list_name, me.role AS my_role, me.notify_done, l.owner_id, o.name AS owner_name, ' +
    'm.user_id, m.role, m.status, u.name AS user_name FROM list_members me JOIN shared_lists l ON l.id = me.list_id ' +
    'JOIN users o ON o.id = l.owner_id JOIN list_members m ON m.list_id = me.list_id JOIN users u ON u.id = m.user_id ' +
    "WHERE me.user_id = ? AND me.status = 'accepted' ORDER BY m.created_at, m.user_id",
  ).bind(userId).all<{
    list_id: string; list_name: string; my_role: string; notify_done: number; owner_id: string; owner_name: string;
    user_id: string; role: string; status: 'pending' | 'accepted'; user_name: string;
  }>();
  const out = new Map<string, ListShare>();
  for (const r of results) {
    let share = out.get(r.list_name);
    if (!share) {
      out.set(r.list_name, share = {
        id: r.list_id, mine: r.my_role === 'owner', owner: { id: r.owner_id, name: r.owner_name }, members: [], notify_done: !!r.notify_done,
      });
    }
    if (r.role === 'owner' || (r.status === 'pending' && !share.mine)) continue;
    share.members.push({ user_id: r.user_id, name: r.user_name, status: r.status });
  }
  return out;
}

/** Push naar één persoon in de taal van elk abonnement; zonder abonnement via zijn fallback-webhook (zoals bij taken). */
async function notify(env: Env, userId: string, make: (locale: string) => Payload, defaultLocale: 'en' | 'nl'): Promise<void> {
  const { total } = await listPush.send(env, userId, make, defaultLocale);
  if (total) return;
  const user = await getUser(env.DB, userId);
  const hook = user && (await loadUserPrefs(env, user)).fallbackWebhook;
  if (hook) await postWebhook(hook, { ...make(defaultLocale), actions: undefined });
}

/** Een melding die het antwoord niet ophoudt; mislukt hij, dan blijft de wijziging staan. */
async function inBackground(c: Context<AppEnv>, sending: Promise<void>, what: string) {
  const p = sending.catch((e) => console.warn(`${what} melden mislukt`, (e as Error).message));
  try { c.executionCtx.waitUntil(p); } catch { await p; }
}

async function readBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  return c.req.json<Record<string, unknown>>().catch(() => { throw new HttpError(400, 'err.invalid_json'); });
}

/** Lijst `name` delen met `to`/`to_user`. De eerste keer wordt de lijst een gedeelde lijst, met al je hoofdtaken erin. */
sharedListsApi.post('/', async (c) => {
  const b = await readBody(c);
  if (b.mode !== undefined && b.mode !== 'shared') throw new HttpError(400, 'err.list_mode');
  const name = String(b.name ?? '');
  if (!name.trim()) throw new HttpError(400, 'err.required', { field: 'name' });
  if (name === 'Inbox') throw new HttpError(400, 'err.inbox_share');
  const db = c.env.DB;
  const userId = c.get('auth').userId;
  const list = await listOf(db, userId, name);
  if (list && list.role !== 'owner') throw new HttpError(403, 'err.shared_list_owner_only');
  if (!list && !(await listNames(db, userId)).has(name)) throw new HttpError(404, 'err.list_unknown');
  const toUser = await recipientOf(db, b);
  if (toUser === userId) throw new HttpError(400, 'err.share_self');
  const ts = now();
  const listId = list?.id ?? crypto.randomUUID();
  const stmts: D1PreparedStatement[] = [];
  if (!list) {
    stmts.push(
      db.prepare("INSERT INTO shared_lists (id, owner_id, mode, created_at) VALUES (?, ?, 'shared', ?)").bind(listId, userId, ts),
      db.prepare("INSERT INTO list_members (list_id, user_id, role, status, name, created_at, responded_at) VALUES (?, ?, 'owner', 'accepted', ?, ?, ?)")
        .bind(listId, userId, name, ts, ts),
      // Open én afgevinkt; subtaken volgen hun hoofdtaak. Wat al per taak gedeeld was, houdt die deelnemers.
      db.prepare('UPDATE tasks SET shared_list = ?, updated_at = ? WHERE user_id = ? AND list = ? AND parent_id IS NULL AND deleted_at IS NULL')
        .bind(listId, ts, userId, name),
    );
  }
  stmts.push(db.prepare("INSERT INTO list_members (list_id, user_id, role, status, name, created_at) VALUES (?, ?, 'member', 'pending', ?, ?) " +
    'ON CONFLICT (list_id, user_id) DO NOTHING').bind(listId, toUser, name, ts));
  const res = await db.batch(stmts);
  if (!res.at(-1)!.meta.changes) throw new HttpError(409, 'err.list_member_exists');
  const fromName = c.get('user').name;
  await inBackground(c, notify(c.env, toUser, (locale) => ({
    title: translate(locale, 'slist.push_invite', { name: fromName, list: name }), body: '',
    url: `/?listInvite=${listId}`, listInviteId: listId, tag: `slist-${listId}`,
    actions: [{ action: 'accept', title: translate(locale, 'push.accept') }, { action: 'decline', title: translate(locale, 'push.decline') }],
  }), c.get('install').defaultLocale), 'lijstuitnodiging');
  return c.json({ id: listId, list_id: listId, status: 'pending' }, 201);
});

/** Je openstaande uitnodigingen, met het aantal open taken (meer zie je pas na accepteren). */
sharedListsApi.get('/incoming', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT m.list_id AS id, m.name, o.name AS from_name, (SELECT count(*) FROM tasks t WHERE t.shared_list = m.list_id ' +
    'AND t.parent_id IS NULL AND t.done = 0 AND t.deleted_at IS NULL) AS open FROM list_members m JOIN shared_lists l ON l.id = m.list_id ' +
    "JOIN users o ON o.id = l.owner_id WHERE m.user_id = ? AND m.status = 'pending' ORDER BY m.created_at DESC",
  ).bind(c.get('auth').userId).all<{ id: string; name: string; from_name: string; open: number }>();
  return c.json(results.map((r) => ({ id: r.id, name: r.name, from: { name: r.from_name }, open: r.open })));
});

/**
 * Accepteren: je lidmaatschap krijgt een naam die je nog niet hebt, en elke hoofdtaak van de lijst een deelrij,
 * bovenaan in jouw volgorde en in die van de eigenaar. De deelrijen lezen de taken in dezelfde batch, zodat er geen
 * taak tussendoor valt; een taak die al per taak met je gedeeld was, houdt zijn rij, en een openstaande uitnodiging
 * per taak wordt een deelname in de lijst.
 */
sharedListsApi.post('/:id/accept', async (c) => {
  const db = c.env.DB;
  const userId = c.get('auth').userId;
  const listId = c.req.param('id');
  const m = await db.prepare('SELECT m.name, o.name AS owner_name FROM list_members m JOIN shared_lists l ON l.id = m.list_id ' +
    "JOIN users o ON o.id = l.owner_id WHERE m.list_id = ? AND m.user_id = ? AND m.status = 'pending'").bind(listId, userId)
    .first<{ name: string; owner_name: string }>();
  if (!m) throw new HttpError(404, 'err.not_found');
  const taken = await listNames(db, userId);
  let name = m.name;
  if (taken.has(name)) {
    const base = `${m.name} (${m.owner_name})`;
    name = base;
    for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
  }
  const top = (await topMin(db, userId)) ?? 0;
  const ts = now();
  const [res] = await db.batch([
    db.prepare("UPDATE list_members SET status = 'accepted', name = ?, responded_at = ? WHERE list_id = ? AND user_id = ? AND status = 'pending'")
      .bind(name, ts, listId, userId),
    db.prepare(
      'INSERT INTO task_shares (id, task_id, from_user, to_user, mode, status, list, position, created_at, responded_at) ' +
      "SELECT lower(hex(randomblob(16))), id, user_id, ?2, 'shared', 'accepted', ?3, ?4 - (n - rn + 1) * ?5, ?6, ?6 FROM (" +
      'SELECT id, user_id, row_number() OVER (ORDER BY position, id) AS rn, count(*) OVER () AS n FROM tasks ' +
      'WHERE shared_list = ?1 AND parent_id IS NULL AND deleted_at IS NULL) ' +
      "WHERE EXISTS (SELECT 1 FROM list_members WHERE list_id = ?1 AND user_id = ?2 AND status = 'accepted') " +
      // Een openstaande uitnodiging per taak (gedeeld of kopie) wordt een gewone deelname; een geaccepteerde blijft.
      "ON CONFLICT (task_id, to_user) DO UPDATE SET mode = 'shared', status = 'accepted', list = excluded.list, position = excluded.position, " +
      "responded_at = excluded.responded_at WHERE task_shares.status = 'pending'",
    ).bind(listId, userId, name, top, STEP, ts),
  ]);
  if (!res.meta.changes) throw new HttpError(404, 'err.not_found'); // intussen geweigerd of ingetrokken
  return c.json({ ok: true, name });
});

sharedListsApi.post('/:id/decline', async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM list_members WHERE list_id = ? AND user_id = ? AND status = 'pending'")
    .bind(c.req.param('id'), c.get('auth').userId).run();
  if (!res.meta.changes) throw new HttpError(404, 'err.not_found');
  return c.json({ ok: true });
});

/** Vertrekken (jezelf, niet de eigenaar), of iemand eruit halen of een uitnodiging intrekken (alleen de eigenaar). */
sharedListsApi.delete('/:id/members/:userId', async (c) => {
  const db = c.env.DB;
  const me = c.get('auth').userId;
  const listId = c.req.param('id');
  const target = c.req.param('userId');
  const member = (uid: string) => db.prepare('SELECT role, status, name FROM list_members WHERE list_id = ? AND user_id = ?')
    .bind(listId, uid).first<{ role: string; status: string; name: string }>();
  const mine = await member(me);
  if (!mine) throw new HttpError(404, 'err.not_found');
  let theirs = mine;
  if (target === me) {
    if (mine.role === 'owner') throw new HttpError(400, 'err.shared_list_owner_leave');
  } else {
    if (mine.role !== 'owner') throw new HttpError(404, 'err.not_found');
    const m = await member(target);
    if (!m) throw new HttpError(404, 'err.not_found');
    theirs = m;
  }
  await db.batch(leaveListStmts(db, listId, target));
  if (target !== me && theirs.status === 'accepted') {
    const fromName = c.get('user').name;
    await inBackground(c, notify(c.env, target, (locale) => ({
      title: translate(locale, 'slist.push_removed', { name: fromName, list: theirs.name }), body: '', url: '/', tag: `slist-${listId}`, actions: [],
    }), c.get('install').defaultLocale), 'uit lijst gehaald');
  }
  return c.json({ ok: true });
});

/** Je eigen keuze voor meldingen bij afvinken in deze lijst. */
sharedListsApi.patch('/:id/me', async (c) => {
  const b = await readBody(c);
  if (typeof b.notify_done !== 'boolean') throw new HttpError(400, 'err.must_be_bool', { field: 'notify_done' });
  const res = await c.env.DB.prepare("UPDATE list_members SET notify_done = ? WHERE list_id = ? AND user_id = ? AND status = 'accepted'")
    .bind(b.notify_done ? 1 : 0, c.req.param('id'), c.get('auth').userId).run();
  if (!res.meta.changes) throw new HttpError(404, 'err.not_found');
  return c.json({ ok: true });
});
