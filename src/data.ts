import { Hono } from 'hono';
import type { AppEnv, TaskRow } from './index';
import { HttpError } from './errors';
import { sessionOnly } from './guards';
import { zonedParts } from '../public/repeat.js';
import { inZone } from './time';
import type { User } from './users';
import { readTickTickText, tickTickRows } from '../public/ticktick.js';

/** Kolommen van `tasks` die in een backup horen; alles daarbuiten wordt genegeerd. */
const TASK_COLUMNS: (keyof TaskRow)[] = [
  'id', 'title', 'description', 'list', 'parent_id', 'position', 'remind_at', 'notified', 'done', 'done_at', 'source',
  'created_at', 'updated_at', 'loc_name', 'loc_lat', 'loc_lng', 'loc_radius', 'loc_trigger', 'loc_notified',
  'repeat_rule', 'repeat_start', 'repeat_at', 'repeat_prev',
];
const PLACE_COLUMNS = ['id', 'name', 'lat', 'lng', 'radius', 'created_at', 'updated_at'] as const;

type Row = Record<string, unknown>;

/** Voert statements per `size` stuks uit via `db.batch` (D1 beperkt het aantal per batch); geeft het totaal aantal gewijzigde rijen terug. */
export async function insertBatched(db: D1Database, stmts: D1PreparedStatement[], size = 50): Promise<number> {
  let changes = 0;
  for (let i = 0; i < stmts.length; i += size) {
    for (const r of await db.batch(stmts.slice(i, i + size))) changes += r.meta.changes;
  }
  return changes;
}

/** `INSERT … ON CONFLICT(id) DO UPDATE`: nooit INSERT OR REPLACE, want de cascade zou subtaken wissen. */
function upsert(db: D1Database, table: string, cols: readonly string[], row: Row, userId: string): D1PreparedStatement {
  row = { ...row, user_id: userId };
  const present = [...cols.filter((c) => row[c] !== undefined), 'user_id'];
  const updates = present.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ');
  return db.prepare(
    `INSERT INTO ${table} (${present.join(', ')}) VALUES (${present.map(() => '?').join(', ')}) ON CONFLICT(id) DO UPDATE SET ${updates} WHERE ${table}.user_id = excluded.user_id`,
  ).bind(...present.map((c) => row[c]));
}

const isObj = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown) => typeof v === 'string';
const isId = (v: unknown) => typeof v === 'string' && v !== '';
/** Kolommen met NOT NULL; een null of ontbrekende waarde laat de DB-standaard gelden. */
const NOT_NULL = new Set(['title', 'description', 'list', 'position', 'notified', 'done', 'source', 'created_at', 'updated_at', 'loc_notified']);
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const invalid = () => new HttpError(400, 'err.backup_invalid');

/** Voorvoegsel voor TickTick-ids: de beheerder houdt `tt`, anderen krijgen een eigen reeks zodat ids niet botsen. */
export function tickTickPrefix(user: Pick<User, 'id' | 'role'>): string {
  return user.role === 'admin' ? 'tt' : `tt${user.id.slice(0, 8)}-`;
}

/** Zoekt de eigenaar van de gegeven ids op, in chunks van 50. */
async function ownersOf(db: D1Database, table: 'tasks' | 'places', ids: string[]): Promise<Map<string, string>> {
  const owners = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const { results } = await db.prepare(`SELECT id, user_id FROM ${table} WHERE id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all<{ id: string; user_id: string }>();
    for (const r of results) owners.set(r.id, r.user_id);
  }
  return owners;
}

export const exportApi = new Hono<AppEnv>();
exportApi.use('*', sessionOnly);
exportApi.get('/', async (c) => {
  const userId = c.get('auth').userId;
  const [tasks, places] = await Promise.all([
    c.env.DB.prepare(`SELECT ${TASK_COLUMNS.join(', ')} FROM tasks WHERE user_id = ? ORDER BY created_at, id`).bind(userId).all(),
    c.env.DB.prepare(`SELECT ${PLACE_COLUMNS.join(', ')} FROM places WHERE user_id = ? ORDER BY created_at, id`).bind(userId).all(),
  ]);
  const now = Date.now();
  // De datum in de bestandsnaam: vandaag in de zone van de gebruiker.
  const z = inZone(c.get('prefs'), () => zonedParts(now));
  const date = `${z.y}-${String(z.m).padStart(2, '0')}-${String(z.d).padStart(2, '0')}`;
  c.header('Content-Disposition', `attachment; filename="tick-backup-${date}.json"`);
  return c.json({ app: 'tick', version: 1, exported_at: new Date(now).toISOString(), tasks: tasks.results, places: places.results });
});

export const importApi = new Hono<AppEnv>();
importApi.use('*', sessionOnly);
importApi.post('/backup', async (c) => {
  const body = await c.req.json<unknown>().catch(() => null);
  if (!isObj(body) || body.app !== 'tick' || body.version !== 1 || !Array.isArray(body.tasks)) throw invalid();
  const places = body.places === undefined ? [] : body.places;
  if (!Array.isArray(places)) throw invalid();
  const tasks = body.tasks as unknown[];

  // Eerst alles valideren, zodat een ongeldig bestand niets schrijft.
  for (const t of tasks) {
    if (!isObj(t) || !isId(t.id) || !isStr(t.title) || !isNum(t.position) || !isStr(t.created_at) || !isStr(t.updated_at)) throw invalid();
  }
  for (const p of places) {
    if (!isObj(p) || !isId(p.id) || !isStr(p.name) || !isNum(p.lat) || !isNum(p.lng) || !isNum(p.radius) || !isStr(p.created_at) || !isStr(p.updated_at)) throw invalid();
  }
  // Optionele kolommen: tekst, getal of null; null bij een NOT NULL-kolom valt weg zodat de standaardwaarde geldt.
  // Een reminder die al voorbij is telt als gemeld: anders komt na het terugzetten een stoot oude meldingen.
  const now = Date.now();
  const userId = c.get('auth').userId;
  let skipped = 0;
  const taskRows0 = (tasks as Row[]).map((t) => {
    const row: Row = {};
    for (const col of TASK_COLUMNS) {
      const v = t[col];
      if (v === undefined) continue;
      if (v === null) { if (!NOT_NULL.has(col)) row[col] = null; continue; }
      if (!isStr(v) && !isNum(v)) throw invalid();
      row[col] = v;
    }
    if (isStr(row.remind_at) && Date.parse(row.remind_at as string) <= now) row.notified = 1;
    return row;
  });

  const db = c.env.DB;
  // Ids die van een ander account zijn, vallen weg.
  const taskOwners = await ownersOf(db, 'tasks', [...new Set(taskRows0.map((t) => t.id as string))]);
  const taskRows = taskRows0.filter((t) => {
    const o = taskOwners.get(t.id as string);
    if (o !== undefined && o !== userId) { skipped++; return false; }
    return true;
  });
  const placeOwners = await ownersOf(db, 'places', [...new Set((places as Row[]).map((p) => p.id as string))]);
  const placeRows = (places as Row[]).filter((p) => {
    const o = placeOwners.get(p.id as string);
    if (o !== undefined && o !== userId) { skipped++; return false; }
    return true;
  });
  const inBackup = new Set(taskRows.map((t) => t.id as string));
  const parentIds = [...new Set(taskRows.map((t) => t.parent_id).filter((v): v is string => isStr(v) && !inBackup.has(v)))];
  const inDb = new Set<string>();
  for (let i = 0; i < parentIds.length; i += 50) {
    const chunk = parentIds.slice(i, i + 50);
    const { results } = await db.prepare(`SELECT id FROM tasks WHERE user_id = ? AND id IN (${chunk.map(() => '?').join(',')})`).bind(userId, ...chunk).all<{ id: string }>();
    for (const r of results) inDb.add(r.id);
  }
  // Ouders eerst; een ouder die nergens bestaat wordt null.
  const clean: Row[] = taskRows.map((t): Row => {
    const pid = t.parent_id;
    return isStr(pid) && (inBackup.has(pid) || inDb.has(pid)) && pid !== t.id ? t : { ...t, parent_id: null };
  });
  const roots = clean.filter((t) => t.parent_id === null || t.parent_id === undefined);
  const children = clean.filter((t) => isStr(t.parent_id));
  // Kinderen onderling op diepte: pas schrijven als de ouder al aan de beurt was.
  const ordered: Row[] = [...roots];
  const done = new Set(roots.map((t) => t.id as string));
  let rest = children;
  while (rest.length) {
    const ready = rest.filter((t) => done.has(t.parent_id as string) || inDb.has(t.parent_id as string));
    const batch: Row[] = ready.length ? ready : rest.map((t) => ({ ...t, parent_id: null })); // kringverwijzing: losmaken
    const readySet = new Set(ready);
    for (const t of batch) done.add(t.id as string);
    ordered.push(...batch);
    rest = ready.length ? rest.filter((t) => !readySet.has(t)) : [];
  }

  // Plekken: de naam is uniek (hoofdletterongevoelig); een andere id met dezelfde naam slaan we over.
  const { results: existing } = await db.prepare('SELECT id, name FROM places WHERE user_id = ?').bind(userId).all<{ id: string; name: string }>();
  const nameOwner = new Map(existing.map((p) => [p.name.toLowerCase(), p.id]));
  const placeStmts: D1PreparedStatement[] = [];
  for (const p of placeRows) {
    const key = (p.name as string).toLowerCase();
    const owner = nameOwner.get(key);
    if (owner !== undefined && owner !== p.id) { skipped++; continue; }
    nameOwner.set(key, p.id as string);
    placeStmts.push(upsert(db, 'places', PLACE_COLUMNS, p, userId));
  }

  await insertBatched(db, ordered.map((t) => upsert(db, 'tasks', TASK_COLUMNS, t, userId)));
  await insertBatched(db, placeStmts);
  return c.json({ tasks: ordered.length, places: placeStmts.length, skipped });
});

const MAX_TICKTICK = 10 * 1024 * 1024;
/** TickTick-backup (CSV) importeren; bestaande ids blijven ongemoeid (INSERT OR IGNORE). */
importApi.post('/ticktick', async (c) => {
  const text = await c.req.text();
  if (text.length > MAX_TICKTICK) throw new HttpError(400, 'err.ticktick_invalid');
  const rows = readTickTickText(text);
  if (!rows.length) throw new HttpError(400, 'err.ticktick_invalid');
  const userId = c.get('auth').userId;
  const { tasks: rowsOut, skipped } = tickTickRows(rows, tickTickPrefix(c.get('user')));
  const db = c.env.DB;
  // Een ouder die al bij een ander account bestaat (INSERT OR IGNORE laat hem daar staan), of die niet in dit bestand
  // en niet bij jezelf staat: dan wordt het kind een gewone taak, anders hangt het onder de taak van een ander.
  const inFile = new Set(rowsOut.map((t) => t.id));
  const parentOwners = await ownersOf(db, 'tasks', [...new Set(rowsOut.map((t) => t.parent_id).filter((p): p is string => !!p))]);
  const tasks = rowsOut.map((t) => {
    if (!t.parent_id) return t;
    const owner = parentOwners.get(t.parent_id);
    const ok = owner === userId || (owner === undefined && inFile.has(t.parent_id));
    return ok ? t : { ...t, parent_id: null };
  });
  const stmts = tasks.map((t) => db.prepare(
    `INSERT OR IGNORE INTO tasks (id, user_id, title, description, list, parent_id, position, remind_at, notified, done, done_at, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'import', ?, ?)`,
  ).bind(t.id, userId, t.title, t.description, t.list, t.parent_id, t.position, t.remind_at, t.done ? 1 : 0, t.done_at, t.created_at, t.created_at));
  const added = await insertBatched(db, stmts);
  return c.json({ added, existing: tasks.length - added, skipped });
});
