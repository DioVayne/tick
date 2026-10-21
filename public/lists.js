// Pure lijstlogica (alleen i18n.js voor de sorteertaal), zodat vitest en de PWA dezelfde code gebruiken.
import { getLocale } from './i18n.js';

export const normName = (name) => String(name ?? '').trim() || 'Inbox';

// localeCompare met opties maakt per aanroep een nieuwe collator; dat is traag bij elke render. Eén per taal en gevoeligheid.
const collators = new Map();
const collator = (sensitivity) => {
  const key = getLocale() + '\n' + sensitivity;
  if (!collators.has(key)) collators.set(key, new Intl.Collator(getLocale(), { sensitivity }));
  return collators.get(key);
};

// Hoofdletter- en spatieongevoelig (accenten tellen wel): "werk " en "Werk" zijn voor de gebruiker dezelfde lijst.
export const sameName = (a, b) => collator('accent').compare(String(a).trim(), String(b).trim()) === 0;

/** De bestaande schrijfwijze van een lijst, of undefined. */
export const findList = (names, name) => names.find((n) => sameName(n, name));

// Hoofdletterongevoelig sorteren, maar bij gelijke letters een vaste volgorde ("Werk" voor "werk").
const byName = (a, b) => collator('base').compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * Alle lijsten met het aantal open taken (incl. subtaken). De server kent ook lijsten met alleen afgeronde taken,
 * `extra` zijn nieuwe lijsten die de server nog niet teruggaf (ze staan nog in de outbox). Tellen doen we op de lokale taken, die lopen voor op de server.
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

// Lijsten hebben geen eigen kleur: de naam kiest er een uit deze reeks (leesbaar op licht en donker), rond de
// kleurcirkel. Is die al bezet door een andere lijst, dan schuift hij door naar een vrije (stap 5: ver van de buren),
// zodat lijsten pas een kleur delen als er meer lijsten dan kleuren zijn. Inbox heeft geen kleur (null): grijs.
const COLORS = ['#e5484d', '#f76b15', '#e8a317', '#d9c62b', '#8bc34a', '#2e9d4f', '#12a594',
  '#00b8d9', '#378add', '#5b5bd6', '#a36bf0', '#d6409f', '#f49ac1', '#a1745a'];
const STEP = 5; // deelt niets met 14, dus elke kleur komt een keer aan de beurt

const slotOf = (name) => {
  let h = 0;
  for (const c of String(name).trim().toLowerCase()) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return h % COLORS.length;
};

let memo = { key: '', map: new Map(), names: /** @type {string[] | null} */ (null) };
/** Kleur per lijstnaam; alle lijsten samen bepalen wie welke krijgt (op naam gesorteerd, dus elke keer hetzelfde). */
function colorMap(names) {
  if (memo.names === names) return memo.map; // dezelfde array (één render): niet opnieuw sorteren
  const own = names.filter((n) => normName(n) !== 'Inbox').sort(byName);
  const key = own.join('\n');
  if (memo.key === key) { memo.names = names; return memo.map; }
  const map = new Map();
  let used = new Set();
  for (const name of own) {
    if (used.size === COLORS.length) used = new Set(); // meer lijsten dan kleuren: dan opnieuw rond
    let slot = slotOf(name);
    while (used.has(slot)) slot = (slot + STEP) % COLORS.length;
    used.add(slot);
    map.set(name, COLORS[slot]);
  }
  memo = { key, map, names };
  return map;
}

/** De kleur van een lijst, gegeven alle lijstnamen; null voor Inbox. */
export function listColor(name, names) {
  if (normName(name) === 'Inbox') return null;
  return colorMap(names.includes(name) ? names : [...names, name]).get(name) ?? COLORS[slotOf(name)];
}
