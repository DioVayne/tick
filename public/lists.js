// Pure lijstlogica (alleen i18n.js voor de sorteertaal), zodat vitest en de PWA dezelfde code gebruiken.
import { getLocale } from './i18n.js';

export const normName = (name) => String(name ?? '').trim() || 'Inbox';

// Hoofdletter- en spatieongevoelig (accenten tellen wel): "werk " en "Werk" zijn voor de gebruiker dezelfde lijst.
export const sameName = (a, b) => String(a).trim().localeCompare(String(b).trim(), getLocale(), { sensitivity: 'accent' }) === 0;

/** De bestaande schrijfwijze van een lijst, of undefined. */
export const findList = (names, name) => names.find((n) => sameName(n, name));

// Hoofdletterongevoelig sorteren, maar bij gelijke letters een vaste volgorde ("Werk" voor "werk").
const byName = (a, b) => a.localeCompare(b, getLocale(), { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * Alle lijsten met het aantal open taken (incl. subtaken). De server kent ook lijsten met alleen afgeronde taken,
 * `extra` zijn lijsten die alleen in deze sessie bestaan. Tellen doen we op de lokale taken, die lopen voor op de server.
 * @param {{ name: string, open: number }[]} server
 * @param {{ list: string, done?: boolean }[]} tasks
 * @param {string[]} extra
 * @returns {{ name: string, open: number }[]}
 */
export function mergeLists(server, tasks, extra) {
  const open = new Map();
  for (const t of tasks) if (!t.done) open.set(t.list, (open.get(t.list) ?? 0) + 1);
  const names = new Set(['Inbox']);
  for (const n of [...server.map((l) => l.name), ...tasks.map((t) => t.list), ...extra]) names.add(n);
  names.delete('Inbox');
  return [{ name: 'Inbox', open: open.get('Inbox') ?? 0 }, ...[...names].sort(byName).map((name) => ({ name, open: open.get(name) ?? 0 }))];
}

/**
 * Past een lijst-op toe op een takenlijst. Nieuwe array; hernoemen raakt alleen exact die lijst.
 * @template {{ id: string, list: string, parent_id: string | null }} T
 * @param {T[]} tasks
 * @param {{ type: 'list-rename', from: string, to: string } | { type: 'list-delete', name: string, tasks: 'inbox' | 'delete' }} op
 * @returns {T[]}
 */
export function applyListOp(tasks, op) {
  if (op.type === 'list-rename') return tasks.map((t) => (t.list === op.from ? { ...t, list: op.to } : t));
  if (op.tasks === 'inbox') return tasks.map((t) => (t.list === op.name ? { ...t, list: 'Inbox' } : t));
  // Verwijderen: ook subtaken van een verwijderde parent gaan mee.
  const gone = new Set(tasks.filter((t) => t.list === op.name).map((t) => t.id));
  return tasks.filter((t) => !gone.has(t.id) && !gone.has(t.parent_id));
}
