import { Hono, type Context } from 'hono';
import type { AppEnv } from './index';
import { HttpError } from './errors';
import { sessionOnly } from './guards';
import { attachImported, insertBatched, ownersOf, tickTickPrefix } from './data';
import { inZone, localToUtcIso } from './time';
import { repeatColumns } from './repeat';
import { userSettingStmt } from './prefs';
import { translate } from '../public/i18n.js';
import { readTickTickText, tickTickRows } from '../public/ticktick.js';
import { todoistRows, type TodoistFile } from '../public/todoist.js';
import type { ImportTask, Lost, Priority } from '../public/importkit.js';
import type { User } from './users';

/**
 * Importeren uit andere apps (TickTick, Todoist) en de laatste import ongedaan maken.
 *
 * De omzetting zelf staat in public/ (ticktick.js, todoist.js, importkit.js), zodat de app vóór het importeren hetzelfde
 * voorbeeld kan laten zien. Elke taak die een import toevoegt, krijgt `import_id`; de laatste import staat per persoon in
 * `user_settings` (`import_last`, JSON). Ongedaan maken zet die taken (en subtaken die je er later onder maakte) in de
 * prullenbak, met één tijdstempel: terugzetten kan per taak zoals altijd. Taken die er al waren (zelfde id: hetzelfde
 * bestand nog eens) blijven ongemoeid en horen niet bij de import.
 */
export const importerApi = new Hono<AppEnv>();
importerApi.use('*', sessionOnly);

const MAX_BYTES = 10 * 1024 * 1024;
const LAST = 'import_last';
type Source = 'ticktick' | 'todoist';
type Last = { id: string; source: Source; at: string; added: number };

/** Voorvoegsel voor Todoist-ids: per persoon, zodat hetzelfde bestand bij twee mensen kan. */
export const todoistPrefix = (user: Pick<User, 'id'>) => `td${user.id.slice(0, 8)}-`;

/** De regels in de notitie, in de taal van de gebruiker: "Prioriteit: hoog", "Deadline: 2026-12-01". */
function labels(lang: 'en' | 'nl') {
  return {
    priority: (p: Priority) => translate(lang, 'import.priority_line', { level: translate(lang, `import.priority_${p}`) }),
    deadline: (d: string) => translate(lang, 'import.deadline_line', { date: d }),
  };
}

/** TickTick-backup (CSV) importeren; bestaande ids blijven ongemoeid (INSERT OR IGNORE). */
importerApi.post('/ticktick', async (c) => {
  const text = await c.req.text();
  if (text.length > MAX_BYTES) throw new HttpError(400, 'err.ticktick_invalid');
  const rows = readTickTickText(text);
  if (!rows.length) throw new HttpError(400, 'err.ticktick_invalid');
  const prefs = c.get('prefs');
  // Een hele dag krijgt de eigen "Herinnering zonder tijd" in de eigen zone (localToUtcIso, synchroon in tickTickRows).
  const r = tickTickRows(rows, tickTickPrefix(c.get('user')), {
    allDay: (ymd: string) => localToUtcIso(ymd, prefs), priority: labels(c.get('lang')).priority,
  });
  return c.json(await save(c, 'ticktick', r.tasks, r.skipped, r.lost));
});

/** Todoist: de CSV-bestanden (per project; de app pakt een back-up-zip zelf uit) als { files: [{ name, text }] }. */
importerApi.post('/todoist', async (c) => {
  const raw = await c.req.text();
  if (raw.length > MAX_BYTES) throw new HttpError(400, 'err.todoist_invalid');
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'err.todoist_invalid'); }
  const files = (body as { files?: unknown })?.files;
  if (!Array.isArray(files) || !files.length || files.length > 500 ||
    !files.every((f) => f && typeof f.name === 'string' && typeof f.text === 'string')) throw new HttpError(400, 'err.todoist_invalid');
  const prefs = c.get('prefs');
  const r = inZone(prefs, () => todoistRows(files as TodoistFile[], todoistPrefix(c.get('user')), labels(c.get('lang'))));
  if (r.invalid.length === files.length) throw new HttpError(400, 'err.todoist_invalid');
  return c.json({ ...(await save(c, 'todoist', r.tasks, r.skipped, r.lost)), invalid: r.invalid.length });
});

/** De laatste import die nog ongedaan gemaakt kan worden, of null. */
importerApi.get('/last', async (c) => c.json({ last: await lastImport(c.env.DB, c.get('auth').userId) }));

/**
 * De laatste import ongedaan maken: zijn taken naar de prullenbak, met de subtaken die je er later onder maakte.
 * Ook taken die in een gedeelde lijst belandden (attachImported: daar zijn ze van de eigenaar van de lijst), zolang je
 * nog in die lijst zit; nooit taken van een andere import. Wat daarna nog over is (een lijst die je verliet), noemt
 * `left`; de import is dan toch afgerond, want opnieuw proberen haalt die taken ook niet weg.
 */
importerApi.post('/undo', async (c) => {
  const db = c.env.DB;
  const userId = c.get('auth').userId;
  const last = await lastImport(db, userId);
  if (!last) throw new HttpError(404, 'err.import_none');
  const ts = new Date().toISOString();
  const [res, rest] = await db.batch([
    db.prepare(
      `WITH mine(id) AS (
         SELECT t.id FROM tasks t LEFT JOIN tasks p ON p.id = t.parent_id
         WHERE t.import_id = ?3 AND (t.user_id = ?2 OR COALESCE(p.shared_list, t.shared_list) IN
           (SELECT list_id FROM list_members WHERE user_id = ?2 AND status = 'accepted')))
       UPDATE tasks SET deleted_at = ?1, updated_at = ?1
       WHERE deleted_at IS NULL AND (id IN (SELECT id FROM mine) OR parent_id IN (SELECT id FROM mine))`,
    ).bind(ts, userId, last.id),
    db.prepare('SELECT count(*) AS n FROM tasks WHERE import_id = ? AND deleted_at IS NULL').bind(last.id),
    userSettingStmt(db, userId, LAST, null),
  ]);
  return c.json({ removed: res.meta.changes, left: (rest.results[0] as { n: number }).n });
});

async function lastImport(db: D1Database, userId: string): Promise<Last | null> {
  const row = await db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').bind(userId, LAST).first<{ value: string }>();
  try {
    const v = row ? JSON.parse(row.value) as Last : null;
    return v && typeof v.id === 'string' ? v : null;
  } catch { return null; }
}

/**
 * Schrijft de taken van een import: een herhaling krijgt zijn begin en volgende keer (repeatColumns, in de zone van de
 * gebruiker); een ritme dat niet (meer) kan valt weg en telt als verloren. Een ouder die bij een ander account bestaat,
 * of nergens: dan wordt het kind een hoofdtaak. Hoofdtaken in de naam van een gedeelde lijst horen daarna bij die lijst.
 */
async function save(c: Context<AppEnv>, source: Source, rowsOut: ImportTask[], skipped: number, lost: Lost) {
  const db = c.env.DB;
  const userId = c.get('auth').userId;
  const prefs = c.get('prefs');
  const inFile = new Set(rowsOut.map((t) => t.id));
  const parentOwners = await ownersOf(db, 'tasks', [...new Set(rowsOut.map((t) => t.parent_id).filter((p): p is string => !!p))]);
  const importId = crypto.randomUUID();
  const now = Date.now();
  const tasks = rowsOut.map((t) => {
    let row = t;
    if (t.parent_id) {
      const owner = parentOwners.get(t.parent_id);
      if (!(owner === userId || (owner === undefined && inFile.has(t.parent_id)))) row = { ...row, parent_id: null };
    }
    let rep: { repeat_rule: string | null; repeat_start: string | null; repeat_at: string | null } = { repeat_rule: null, repeat_start: null, repeat_at: null };
    if (row.repeat_rule && row.remind_at && !row.done && !row.parent_id) {
      try {
        const cols = repeatColumns(row.repeat_rule, row.remind_at, prefs);
        rep = { repeat_rule: cols.repeat_rule as string, repeat_start: cols.repeat_start as string, repeat_at: cols.repeat_at as string };
        row = { ...row, remind_at: rep.repeat_at, notified: Date.parse(rep.repeat_at as string) <= now };
      } catch { lost.repeats++; }
    }
    return { ...row, ...rep };
  });
  const stmts = tasks.map((t) => db.prepare(
    `INSERT OR IGNORE INTO tasks (id, user_id, title, description, list, parent_id, position, remind_at, notified, done, done_at, source,
       created_at, updated_at, repeat_rule, repeat_start, repeat_at, pinned, import_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(t.id, userId, t.title, t.description, t.list, t.parent_id, t.position, t.remind_at, t.notified ? 1 : 0, t.done ? 1 : 0, t.done_at,
    t.created_at, t.created_at, t.repeat_rule, t.repeat_start, t.repeat_at, t.pinned ? 1 : 0, importId));
  const added = await insertBatched(db, stmts);
  if (added) {
    // Alleen de taken die deze import echt toevoegde (INSERT OR IGNORE liet bestaande staan).
    const { results } = await db.prepare('SELECT id FROM tasks WHERE user_id = ? AND import_id = ? AND parent_id IS NULL').bind(userId, importId).all<{ id: string }>();
    await attachImported(db, userId, results.map((r) => r.id));
    const last: Last = { id: importId, source, at: new Date(now).toISOString(), added };
    await userSettingStmt(db, userId, LAST, JSON.stringify(last)).run();
  }
  return { added, existing: tasks.length - added, skipped, lost };
}
