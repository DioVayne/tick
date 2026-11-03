// De regel voor oude taken (Tickmanager): puur, zonder DOM. De PWA bepaalt zelf wat oud is, zodat getal en ronde offline werken.

/** Een dag in milliseconden. */
export const DAY = 86_400_000;

/**
 * @typedef {{ on: boolean, newDays: number, seenDays: number }} ReviewPrefs
 * @typedef {{ id: string, list: string, parent_id: string | null, done: boolean, pinned: boolean, repeat: unknown,
 *   remind_at: string | null, created_at: string, reviewed_at: string | null, position: number }} ReviewTask
 */

/**
 * Instellingen uit CONFIG; een oudere offline cache kent de velden nog niet, dus met standaarden.
 * @param {{ tickmanager?: boolean, reviewNewDays?: number, reviewSeenDays?: number }} config
 * @returns {ReviewPrefs}
 */
export function reviewPrefsOf(config) {
  return { on: config.tickmanager !== false, newDays: config.reviewNewDays ?? 14, seenDays: config.reviewSeenDays ?? 30 };
}

/** Moment waarop de taak voor het laatst gezien is: bekeken, anders aangemaakt (nooit updated_at). */
const seenAt = (/** @type {ReviewTask} */ t) => Date.parse(t.reviewed_at ?? t.created_at);

/**
 * Is deze taak oud (spec §3)? Precies N dagen telt als oud. `skipped` zijn lijstnamen zoals de persoon ze ziet.
 * @param {ReviewTask} task
 * @param {ReviewPrefs} prefs
 * @param {Set<string>} skipped
 * @param {number} now
 */
export function isStale(task, prefs, skipped, now) {
  if (task.done || task.parent_id || task.pinned || task.repeat || skipped.has(task.list)) return false;
  if (task.remind_at && Date.parse(task.remind_at) > now) return false;
  const limit = (task.reviewed_at ? prefs.seenDays : prefs.newDays) * DAY;
  return now - seenAt(task) >= limit;
}

/**
 * Alle oude taken, oudste eerst; bij gelijke tijd op id.
 * @template {ReviewTask} T
 * @param {T[]} tasks
 * @param {ReviewPrefs} prefs
 * @param {Set<string>} skipped
 * @param {number} now
 * @returns {T[]}
 */
export function staleTasks(tasks, prefs, skipped, now) {
  return tasks
    .filter((t) => isStale(t, prefs, skipped, now))
    .sort((a, b) => seenAt(a) - seenAt(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Hele dagen sinds de taak voor het laatst gezien is (naar beneden afgerond). */
export function staleDays(/** @type {ReviewTask} */ task, /** @type {number} */ now) {
  return Math.floor((now - seenAt(task)) / DAY);
}

/**
 * Positie voor "bovenaan zetten": net boven de andere open, niet-vastgepinde hoofdtaken in dezelfde lijst.
 * Zijn er geen, of staat de taak al het hoogst, dan blijft de positie zoals ze was.
 * @param {ReviewTask} task
 * @param {ReviewTask[]} tasks
 * @returns {number}
 */
export function topOf(task, tasks) {
  const others = tasks.filter((t) => t.id !== task.id && t.list === task.list && !t.done && !t.pinned && !t.parent_id);
  if (!others.length) return task.position;
  const min = Math.min(...others.map((t) => t.position));
  return min > task.position ? task.position : min - 1_000_000;
}

/**
 * Eerste index vanaf `from` waarvan de taak nog open is; `ids.length` als er geen meer is.
 * @param {string[]} ids
 * @param {number} from
 * @param {Set<string>} openIds
 */
export function nextIndex(ids, from, openIds) {
  let i = from;
  while (i < ids.length && !openIds.has(ids[i])) i++;
  return i;
}
