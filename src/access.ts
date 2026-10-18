import type { TaskRow } from './index';

/**
 * Toegang tot taken. Je hebt toegang als je de eigenaar bent (`tasks.user_id`), of als er een geaccepteerde deelrij is
 * voor de hoofdtaak (`COALESCE(parent_id, id)`) met jou als ontvanger. Een taak zonder toegang bestaat voor jou niet.
 */
export type Access = TaskRow & { share_id: string | null; share_list: string | null; share_position: number | null };

/** Afstand tussen posities na aanmaken of herverdelen; slepen halveert het gat. */
export const STEP = 1_000_000;

// ?1 is altijd de gebruiker; een gewone ? daarna krijgt het volgende nummer (?2, ?3, …).
const COLS = 't.*, s.id AS share_id, s.list AS share_list, s.position AS share_position';
const JOIN = "LEFT JOIN task_shares s ON s.task_id = COALESCE(t.parent_id, t.id) AND s.to_user = ?1 AND s.status = 'accepted'";
const VISIBLE = '(t.user_id = ?1 OR s.id IS NOT NULL)';

/** De taak met jouw deelrij, of null zonder toegang. Standaard alleen buiten de prullenbak, met `deleted` alleen erin. */
export function getAccess(db: D1Database, userId: string, id: string, opts: { deleted?: boolean } = {}): Promise<Access | null> {
  return db.prepare(`SELECT ${COLS} FROM tasks t ${JOIN} WHERE ${VISIBLE} AND t.id = ? AND t.deleted_at IS ${opts.deleted ? 'NOT NULL' : 'NULL'}`)
    .bind(userId, id).first<Access>();
}

/** Alle taken waar je toegang toe hebt en die aan `where` voldoen (kolommen als `t.…`); `tail` is ORDER BY/LIMIT. */
export async function visibleTasks(db: D1Database, userId: string, where: string, binds: unknown[] = [], tail = ''): Promise<Access[]> {
  const { results } = await db.prepare(`SELECT ${COLS} FROM tasks t ${JOIN} WHERE ${VISIBLE} AND ${where} ${tail}`)
    .bind(userId, ...binds).all<Access>();
  return results;
}

/** Lijst en volgorde van de ontvanger: de hoofdtaak krijgt die uit zijn deelrij, een subtaak de lijst van haar ouder bij hem. */
export function overlay(t: Access): Access {
  if (!t.share_id) return t;
  return { ...t, list: t.share_list ?? t.list, position: t.parent_id ? t.position : t.share_position ?? t.position };
}

/** De laagste positie in jouw volgorde van open hoofdtaken: je eigen taken plus je deelnames. */
export async function topMin(db: D1Database, userId: string): Promise<number | null> {
  const r = await db.prepare(
    'SELECT MIN(p) AS p FROM (SELECT position AS p FROM tasks WHERE user_id = ?1 AND parent_id IS NULL AND done = 0 AND deleted_at IS NULL ' +
    "UNION ALL SELECT s.position FROM task_shares s JOIN tasks t ON t.id = s.task_id WHERE s.to_user = ?1 AND s.status = 'accepted' AND t.done = 0 AND t.deleted_at IS NULL)",
  ).bind(userId).first<{ p: number | null }>();
  return r?.p ?? null;
}

/** Jouw volgorde van open hoofdtaken, met per rij waar de positie staat (in `tasks` of in je deelrij). */
export async function topOrder(db: D1Database, userId: string): Promise<{ id: string; share_id: string | null; position: number }[]> {
  const { results } = await db.prepare(
    'SELECT id, NULL AS share_id, position FROM tasks WHERE user_id = ?1 AND parent_id IS NULL AND done = 0 AND deleted_at IS NULL ' +
    "UNION ALL SELECT t.id, s.id, s.position FROM task_shares s JOIN tasks t ON t.id = s.task_id WHERE s.to_user = ?1 AND s.status = 'accepted' AND t.done = 0 AND t.deleted_at IS NULL " +
    'ORDER BY position',
  ).bind(userId).all<{ id: string; share_id: string | null; position: number }>();
  return results;
}

export type ShareInfo = {
  owner: { id: string; name: string };
  members: { share_id: string; user_id: string; name: string; status: 'pending' | 'accepted' }[];
};

/**
 * Deelinformatie per hoofdtaak waar je bij hoort (als eigenaar of als ontvanger), met `taskId` voor één taak.
 * Alleen `shared`-rijen; een openstaande kopie telt niet als deelnemer.
 */
export async function shareInfo(db: D1Database, userId: string, taskId?: string): Promise<Map<string, ShareInfo>> {
  const scope = taskId ? 's.task_id = ?2' : "s.task_id IN (SELECT id FROM tasks WHERE user_id = ?1 AND parent_id IS NULL " +
    "UNION SELECT task_id FROM task_shares WHERE to_user = ?1 AND status = 'accepted')";
  const { results } = await db.prepare(
    'SELECT s.id, s.task_id, s.to_user, s.status, u.name, o.id AS owner_id, o.name AS owner_name FROM task_shares s ' +
    "JOIN users u ON u.id = s.to_user JOIN tasks t ON t.id = s.task_id JOIN users o ON o.id = t.user_id WHERE s.mode = 'shared' AND " + scope +
    ' ORDER BY s.created_at, s.id',
  ).bind(userId, ...(taskId ? [taskId] : [])).all<{ id: string; task_id: string; to_user: string; status: 'pending' | 'accepted'; name: string; owner_id: string; owner_name: string }>();
  const out = new Map<string, ShareInfo>();
  for (const r of results) {
    let info = out.get(r.task_id);
    if (!info) out.set(r.task_id, info = { owner: { id: r.owner_id, name: r.owner_name }, members: [] });
    info.members.push({ share_id: r.id, user_id: r.to_user, name: r.name, status: r.status });
  }
  // Voor een taak waar je alleen ontvanger bent zonder toegang (scope met taskId) hoort er niets in.
  if (taskId) {
    const info = out.get(taskId);
    if (info && info.owner.id !== userId && !info.members.some((m) => m.user_id === userId && m.status === 'accepted')) out.delete(taskId);
  }
  return out;
}
