// Accountpagina van de beheerder (#/accounts): alle accounts met zoeken, sorteren en kiesbare groepen, en per account
// aantallen (taken, apparaten, gedeelde lijsten; nooit inhoud). Een weergave van de instellingenpagina: settingsview.js
// zet hem in de middenkolom en geeft de bouwstenen en acties mee (resetlink, verwijderen), zodat die op één plek staan.
// Alleen online, net als de rest van het accountbeheer. Sorteren en groeperen onthoudt dit apparaat (localStorage).
import { request } from './api.js';
import { GROUPINGS, SORTS, filterUsers, groupUsers, monthLabel, sortUsers } from './accounts.js';
import { dateLocale, t } from './i18n.js';
import { el } from './render.js';
import CONFIG from './settings.js';

const SORT_KEY = 'tick.accounts.sort';
const GROUP_KEY = 'tick.accounts.group';

const recall = (key, allowed, fallback) => {
  try { const v = localStorage.getItem(key); return v && allowed.includes(v) ? v : fallback; } catch { return fallback; }
};
const keep = (key, value) => { try { localStorage.setItem(key, value); } catch { /* geen opslag */ } };
const num = (n) => Number(n).toLocaleString(dateLocale());

/**
 * Bouwt de pagina en haalt de accounts op.
 * @param {{
 *   row: Function, btn: Function, note: Function, seg: Function, select: Function,
 *   fmtDate: (iso: string) => string, ago: (iso: string) => string, offlineText: (e: unknown) => string,
 *   resetLink: (u: any) => unknown, deleteUser: (u: any) => Promise<boolean>, back: () => void,
 * }} ui bouwstenen en acties uit settingsview.js
 * @returns {HTMLElement}
 */
export function accountsPage(ui) {
  const st = {
    /** @type {import('./accounts.js').Account[] | null} */ users: null,
    q: '',
    sort: recall(SORT_KEY, SORTS, 'created'),
    group: recall(GROUP_KEY, GROUPINGS, 'none'),
  };
  const count = el('p', { class: 'acc-count', 'aria-live': 'polite' });
  const list = el('div', { class: 'acc-groups' }, ui.note(t('set.loading')));
  const search = /** @type {HTMLInputElement} */ (el('input', {
    type: 'search', class: 'acc-search', placeholder: t('acc.search'), 'aria-label': t('acc.search'), autocomplete: 'off', spellcheck: false,
    oninput: () => { st.q = search.value; draw(); },
  }));
  const sort = ui.select(t('acc.sort'), SORTS.map((k) => [k, t(`acc.sort_${k}`)]), st.sort, (v) => { st.sort = v; keep(SORT_KEY, v); draw(); });
  const group = ui.seg(t('acc.group'), GROUPINGS.map((k) => [k, t(`acc.group_${k}`)]), st.group, (v) => { st.group = v; keep(GROUP_KEY, v); draw(); });

  const root = el('div', { id: 'accounts', class: 'settings acc-page' },
    el('button', { type: 'button', class: 'set-back', onclick: () => ui.back() }, t('set.back')),
    el('div', { class: 'acc-tools' },
      search,
      el('div', { class: 'acc-tool-row' },
        el('label', { class: 'acc-sort' }, el('span', {}, t('acc.sort')), sort),
        group)),
    count,
    list);

  function stats(u) {
    return el('ul', { class: 'acc-stats' },
      el('li', {}, t('acc.stat_tasks', { open: num(u.tasks_open), done: num(u.tasks_done) })),
      el('li', {}, t('acc.stat_devices', { phones: num(u.phones), browsers: num(u.browsers) })),
      el('li', {}, u.lists_shared || u.lists_joined
        ? t('acc.stat_lists', { own: num(u.lists_shared), joined: num(u.lists_joined) })
        : t('acc.stat_lists_none')));
  }

  function userRow(u) {
    const me = u.id === CONFIG.userId;
    const name = me ? `${u.name} (${t('set.you')})` : u.role === 'admin' ? `${u.name} (${t('acc.admin')})` : u.name;
    const sub = [u.email, t('set.created', { date: ui.fmtDate(u.created_at) }), u.last_seen ? t('set.seen', { when: ui.ago(u.last_seen) }) : t('set.never_seen')]
      .filter(Boolean).join(' · ');
    const remove = async () => {
      if (!(await ui.deleteUser(u)) || !st.users) return;
      st.users = st.users.filter((x) => x.id !== u.id);
      draw();
    };
    const controls = [ui.btn(t('set.reset_link'), () => ui.resetLink(u)), me ? null : ui.btn(t('set.user_delete'), remove, { kind: 'danger' })].filter(Boolean);
    return ui.row(name, controls, sub, stats(u));
  }

  const card = (users) => el('div', { class: 'set-list acc-list' }, ...users.map(userRow));
  const label = (key) => (st.group === 'month' ? monthLabel(key) : t(`acc.act_${key}`));

  function draw() {
    if (!st.users) return;
    const shown = sortUsers(filterUsers(st.users, st.q), st.sort);
    const total = st.users.length;
    count.textContent = shown.length === total
      ? (total === 1 ? t('acc.count_one') : t('acc.count', { n: num(total) }))
      : t('acc.shown', { n: num(shown.length), total: num(total) });
    if (!shown.length) { list.replaceChildren(ui.note(t('acc.none_found'))); return; }
    const groups = groupUsers(shown, st.group);
    list.replaceChildren(...(st.group === 'none'
      ? [card(shown)]
      : groups.map((g) => el('section', { class: 'set-group', 'aria-label': label(g.key) },
        el('h2', { class: 'set-group-h' }, `${label(g.key)} · ${num(g.users.length)}`),
        card(g.users)))));
  }

  (async () => {
    try {
      st.users = await request('GET', '/api/users');
      draw();
    } catch (e) {
      list.replaceChildren(ui.note(ui.offlineText(e)));
    }
  })();
  return root;
}
