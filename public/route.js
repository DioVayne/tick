// Het adres achter # volgt wat je ziet, zodat je elk scherm kunt bookmarken. Pure functies (vitest gebruikt ze ook);
// app.js leest het adres bij het starten en bij een bladwijzer, render.js schrijft het na elke render.

/**
 * @typedef {{ page: 'all' | 'inbox' | 'done' | 'trash' | 'calendar' | 'settings' | 'help' }
 *   | { page: 'list', id: string } | { page: 'task', id: string }} Route
 */

const PAGES = ['all', 'inbox', 'done', 'trash', 'calendar', 'settings', 'help'];

/**
 * Het adres voor wat er in beeld is. Een pagina gaat voor een taak, een taak voor de lijst eronder. Een lijst zonder
 * id (net aangemaakt, nog niet terug van de server) heeft nog geen adres: dan ''.
 * @param {{ page: string | null, task: string | null, showDone: boolean, showTrash: boolean, list: string | null, listId?: string }} v
 */
export function toHash(v) {
  if (v.page === 'settings' || v.page === 'help') return '#/' + v.page;
  if (v.task) return '#/task/' + encodeURIComponent(v.task);
  if (v.page === 'calendar') return '#/calendar';
  if (v.showTrash) return '#/trash';
  if (v.showDone) return '#/done';
  if (v.list === null) return '#/all';
  if (v.list === 'Inbox') return '#/inbox';
  return v.listId ? '#/list/' + encodeURIComponent(v.listId) : '';
}

/**
 * Leest een adres; onbekend of leeg geeft null.
 * @param {string} hash location.hash
 * @returns {Route | null}
 */
export function parseHash(hash) {
  const m = /^#\/([a-z]+)(?:\/([^/]+))?$/.exec(hash);
  if (!m) return null;
  const [, page, arg] = m;
  if (page === 'list' || page === 'task') {
    if (!arg) return null;
    try { return { page, id: decodeURIComponent(arg) }; } catch { return null; }
  }
  return !arg && PAGES.includes(page) ? /** @type {Route} */ ({ page }) : null;
}
