import { countTasks } from '../public/markdown.js';
import type { Access } from './access';

/**
 * Kopiegroep: hoofdtaken met dezelfde `copy_group` zijn exemplaren van dezelfde klus, één per persoon. Van een ander lid
 * gaat alleen naam, klaar en voortgang over de lijn; nooit titel, beschrijving of subtaken.
 */
export type CopyMember = { name: string; done: boolean; done_at: string | null; progress: number | null };
export type Copies = { members: CopyMember[]; pending: { name: string }[] };

/** Afgevinkt deel (0–1) van de takenlijst-regels in de beschrijving plus de subtaken; null als er niets te tellen is. */
export function progressOf(description: string, kids: { done: number }[]): number | null {
  const n = countTasks(description);
  const done = n.done + kids.filter((k) => k.done).length;
  const total = n.total + kids.length;
  return total ? done / total : null;
}

/** Of `copiesFor` iets kan vinden: een hoofdtaak in een groep, of een eigen hoofdtaak met een openstaande kopie-uitnodiging. */
export const anyCopies = (rows: Access[], userId: string) =>
  rows.some((r) => !r.parent_id && (r.copy_group || (r.has_copy_invite && r.user_id === userId)));

type MemberRow = {
  id: string; copy_group: string; name: string; done: number; done_at: string | null; description: string;
  repeat_rule: string | null; repeat_at: string | null; kids: string;
};

/**
 * `copies` per hoofdtaak in `rows`, zoals `userId` hem ziet. De leden zijn de andere niet-verwijderde exemplaren in de
 * groep (uitgesloten op id: een deelnemer van een gedeeld exemplaar ziet dezelfde leden als de eigenaar). Herhalen
 * beide, dan is een lid klaar als het een ronde verder is (latere `repeat_at`), zonder tijdstip. Openstaande
 * kopie-uitnodigingen (`pending`) ziet alleen de eigenaar van de taak. Zonder leden en uitnodigingen staat de taak er niet in.
 */
export async function copiesFor(db: D1Database, userId: string, rows: Access[]): Promise<Map<string, Copies>> {
  const main = rows.filter((r) => !r.parent_id);
  const groups = [...new Set(main.flatMap((r) => (r.copy_group ? [r.copy_group] : [])))];
  const invited = main.filter((r) => r.has_copy_invite && r.user_id === userId).map((r) => r.id);
  const stmts: D1PreparedStatement[] = [];
  if (groups.length) {
    stmts.push(db.prepare(
      'SELECT t.id, t.copy_group, u.name, t.done, t.done_at, t.description, t.repeat_rule, t.repeat_at, ' +
      '(SELECT json_group_array(k.done) FROM tasks k WHERE k.parent_id = t.id AND k.deleted_at IS NULL) AS kids ' +
      'FROM tasks t JOIN users u ON u.id = t.user_id ' +
      'WHERE t.copy_group IN (SELECT value FROM json_each(?)) AND t.parent_id IS NULL AND t.deleted_at IS NULL',
    ).bind(JSON.stringify(groups)));
  }
  if (invited.length) {
    stmts.push(db.prepare(
      "SELECT s.task_id, u.name FROM task_shares s JOIN users u ON u.id = s.to_user WHERE s.mode = 'copy' AND s.status = 'pending' " +
      'AND s.task_id IN (SELECT value FROM json_each(?)) ORDER BY s.created_at, s.id',
    ).bind(JSON.stringify(invited)));
  }
  const out = new Map<string, Copies>();
  if (!stmts.length) return out;
  const res = await db.batch(stmts);
  const members = groups.length ? res[0].results as MemberRow[] : [];
  const pending = invited.length ? res[res.length - 1].results as { task_id: string; name: string }[] : [];
  for (const r of main) {
    const repeats = !!r.repeat_rule;
    const list = members.filter((m) => m.copy_group === r.copy_group && m.id !== r.id).map((m): CopyMember => {
      const progress = progressOf(m.description, (JSON.parse(m.kids) as number[]).map((done) => ({ done })));
      if (repeats && m.repeat_rule) {
        return { name: m.name, done: Date.parse(m.repeat_at ?? '') > Date.parse(r.repeat_at ?? ''), done_at: null, progress };
      }
      return { name: m.name, done: !!m.done, done_at: m.done_at, progress };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const waiting = r.user_id === userId ? pending.filter((p) => p.task_id === r.id).map((p) => ({ name: p.name })) : [];
    if (list.length || waiting.length) out.set(r.id, { members: list, pending: waiting });
  }
  return out;
}
