/** Zo lang blijft een taak in de prullenbak; daarna wist de cron hem. */
export const TRASH_DAYS = 30;

/**
 * Statements die de taken uit `where` echt wissen, met hun subtaken, deelrijen en bezorgrijen. `where` gaat over de
 * tabel tasks en krijgt `binds` (vier keer gebruikt). De rijen van de taken zelf komen in het laatste statement.
 */
export function wipeStmts(db: D1Database, where: string, binds: unknown[]): D1PreparedStatement[] {
  const ids = `SELECT id FROM tasks WHERE ${where}`;
  const all = `${ids} UNION SELECT id FROM tasks WHERE parent_id IN (${ids})`;
  return [
    db.prepare(`DELETE FROM task_shares WHERE task_id IN (${ids})`).bind(...binds),
    db.prepare(`DELETE FROM reminder_sent WHERE task_id IN (${all})`).bind(...binds, ...binds),
    db.prepare(`DELETE FROM tasks WHERE parent_id IN (${ids})`).bind(...binds),
    db.prepare(`DELETE FROM tasks WHERE ${where}`).bind(...binds),
  ];
}

/** Wist alles wat langer dan TRASH_DAYS in de prullenbak staat; geeft het aantal gewiste taken terug. */
export async function purgeTrash(db: D1Database, now: number): Promise<number> {
  const cutoff = new Date(now - TRASH_DAYS * 86_400_000).toISOString();
  const res = await db.batch(wipeStmts(db, 'deleted_at IS NOT NULL AND deleted_at < ?', [cutoff]));
  return res[2].meta.changes + res[3].meta.changes;
}
