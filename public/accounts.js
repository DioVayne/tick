// Accountpagina van de beheerder: zoeken, sorteren en groeperen van de lijst uit GET /api/users. Pure functies (vitest
// gebruikt ze ook); accountsview.js tekent. Grenzen van vandaag, deze week en deze maand in de tijdzone van Tick.
import { chipDays, getTimeZone, zonedParts, zonedToUtc } from './repeat.js';
import { dateLocale } from './i18n.js';

/**
 * @typedef {{ id: string, name: string, email: string | null, role: string, created_at: string, last_seen: string | null,
 *   tasks_open: number, tasks_done: number, browsers: number, phones: number, lists_shared: number, lists_joined: number }} Account
 */

export const SORTS = ['name', 'created', 'seen', 'tasks', 'devices'];
export const GROUPINGS = ['none', 'activity', 'month'];
export const ACTIVITY = ['today', 'week', 'month', 'older', 'never'];

const fold = (s) => String(s ?? '').toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Accounts waarvan naam of e-mailadres de zoektekst bevat (hoofdletters en accenten tellen niet).
 * @param {Account[]} users @param {string} query
 */
export function filterUsers(users, query) {
  const q = fold(query.trim());
  return q ? users.filter((u) => fold(u.name).includes(q) || fold(u.email).includes(q)) : users;
}

const ms = (iso) => (iso ? Date.parse(iso) : -Infinity);
const byName = (a, b) => a.name.localeCompare(b.name, dateLocale(), { sensitivity: 'base' }) || a.id.localeCompare(b.id);

/**
 * Een nieuwe, gesorteerde lijst. Naam: A-Z; de rest: hoogste of nieuwste eerst, bij gelijk op naam.
 * @param {Account[]} users @param {string} key een van SORTS
 */
export function sortUsers(users, key) {
  /** @type {(u: Account) => number} */
  const value = key === 'created' ? (u) => ms(u.created_at)
    : key === 'seen' ? (u) => ms(u.last_seen)
    : key === 'tasks' ? (u) => u.tasks_open + u.tasks_done
    : key === 'devices' ? (u) => u.browsers + u.phones
    : () => 0;
  return [...users].sort((a, b) => (key === 'name' ? 0 : value(b) - value(a)) || byName(a, b));
}

/** Begin van vandaag, deze week en deze maand (UTC-ms) in de tijdzone van Tick. */
function bounds(now) {
  const p = zonedParts(now);
  const today = zonedToUtc(p.y, p.m, p.d, 0, 0);
  const back = (p.wd - chipDays()[0] + 7) % 7; // dagen sinds het begin van de week
  const w = new Date(Date.UTC(p.y, p.m - 1, p.d - back));
  return { today, week: zonedToUtc(w.getUTCFullYear(), w.getUTCMonth() + 1, w.getUTCDate(), 0, 0), month: zonedToUtc(p.y, p.m, 1, 0, 0) };
}

/**
 * Wanneer iemand voor het laatst actief was: vandaag, deze week, deze maand, langer geleden of nooit.
 * @param {string | null} lastSeen @param {number} [now] @param {ReturnType<typeof bounds>} [b]
 */
export function activityOf(lastSeen, now = Date.now(), b = bounds(now)) {
  if (!lastSeen) return 'never';
  const t = Date.parse(lastSeen);
  return t >= b.today ? 'today' : t >= b.week ? 'week' : t >= b.month ? 'month' : 'older';
}

/** "2026-11" voor de maand waarin het account gemaakt is (tijdzone van Tick). */
export function monthOf(iso) {
  const p = zonedParts(Date.parse(iso));
  return `${p.y}-${String(p.m).padStart(2, '0')}`;
}

/** "november 2026" voor "2026-11". */
export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(zonedToUtc(y, m, 15, 12, 0)).toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric', timeZone: getTimeZone() });
}

/**
 * Deelt een (al gesorteerde) lijst op in groepen; de volgorde binnen een groep blijft. Lege groepen vallen weg.
 * none: één groep; activity: vandaag … nooit; month: nieuwste maand eerst.
 * @param {Account[]} users @param {string} mode een van GROUPINGS @param {number} [now]
 * @returns {{ key: string, users: Account[] }[]}
 */
export function groupUsers(users, mode, now = Date.now()) {
  if (mode !== 'activity' && mode !== 'month') return [{ key: 'all', users }];
  const b = bounds(now);
  const keyOf = mode === 'activity' ? (u) => activityOf(u.last_seen, now, b) : (u) => monthOf(u.created_at);
  /** @type {Map<string, Account[]>} */
  const map = new Map();
  for (const u of users) {
    const k = keyOf(u);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(u);
  }
  const keys = mode === 'activity' ? ACTIVITY.filter((k) => map.has(k)) : [...map.keys()].sort().reverse();
  return keys.map((key) => ({ key, users: map.get(key) }));
}

/**
 * Voor Instellingen › Accounts: hoeveel accounts er zijn en hoeveel daarvan deze week actief waren.
 * @param {Account[]} users @param {number} [now]
 */
export function summarize(users, now = Date.now()) {
  const b = bounds(now);
  return { total: users.length, week: users.filter((u) => ['today', 'week'].includes(activityOf(u.last_seen, now, b))).length };
}
