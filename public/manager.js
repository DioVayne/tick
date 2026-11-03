// Tickmanager: een pagina in de middenkolom (naar het voorbeeld van help.js) met het aantal oude taken, de termijnen en
// de lijsten, en de opruimronde: kaart voor kaart een oude taak met vier knoppen, aan het eind een samenvatting.
import CONFIG from './settings.js';
import { request, Offline } from './api.js';
import { openDatePicker } from './datepicker.js';
import { t } from './i18n.js';
import { suggest } from './planner.js';
import { $, el, fromLocalInput, render, toast } from './render.js';
import { nextIndex, reviewPrefsOf, staleDays, staleTasks, topOf } from './review.js';
import { closeDrawer } from './sidebar.js';
import { lists, markReviewed, setListReview, skippedLists, staleNow, state, update } from './store.js';
import { deleteWithUndo, swipedAway } from './swipe.js';

/**
 * view: wat er in beeld is. round: de ronde, met de ids die bij de start vastlagen en de tellers voor de samenvatting.
 * @type {{ open: boolean, root: HTMLElement | null, view: 'page' | 'card' | 'summary',
 *   round: { ids: string[], i: number, n: { planned: number, top: number, deleted: number, kept: number } } | null }}
 */
const S = { open: false, root: null, view: 'page', round: null };

export const isManagerOpen = () => S.open;

const prefs = () => reviewPrefsOf(CONFIG);
const plural = (key, n, vars = {}) => t(n === 1 ? `${key}_one` : key, { n, ...vars });
/** De oude taken van nu, zonder een taak die net weggeveegd is en nog op Ongedaan maken wacht. */
const staleShown = () => staleNow(prefs()).filter((x) => !swipedAway(x));

// ---------- de pagina ----------

/** Een termijnveld (dagen). Bij change naar de server; een ongeldige waarde zet het veld terug. */
function daysField(key, field) {
  const input = /** @type {HTMLInputElement} */ (el('input', {
    type: 'number', min: '1', max: '365', step: '1', inputmode: 'numeric', class: 'mgr-days', id: `mgr-${field}`,
    'data-focus': field, value: String(prefs()[field]),
    onchange: () => saveDays(input, field),
  }));
  return el('label', { class: 'mgr-field', for: `mgr-${field}` }, el('span', {}, t(key)), input);
}

async function saveDays(input, field) {
  const before = prefs()[field];
  const v = Number(input.value);
  const fail = (reason) => { input.value = String(before); toast(t('set.save_failed', { reason })); };
  if (input.value.trim() === '' || !Number.isInteger(v) || v < 1 || v > 365) { fail(t('err.invalid_review_days')); return; }
  if (v === before) return;
  const name = field === 'newDays' ? 'reviewNewDays' : 'reviewSeenDays';
  try {
    const s = await request('PATCH', '/api/settings', { [name]: v });
    if (typeof s.reviewNewDays === 'number') CONFIG.reviewNewDays = s.reviewNewDays;
    if (typeof s.reviewSeenDays === 'number') CONFIG.reviewSeenDays = s.reviewSeenDays;
    toast(t('set.saved'), 'ok');
  } catch (e) {
    fail(e instanceof Offline ? t('set.online_only') : e.message);
  }
  refreshManager();
}

/** Een rij per lijst: naam, aantal oude taken en het vinkje meenemen. Een eigen element, later uit te klappen. */
function listRow(l, count, skipped) {
  const box = /** @type {HTMLInputElement} */ (el('input', {
    type: 'checkbox', class: 'mgr-include', 'data-focus': `list:${l.id ?? l.name}`,
    checked: !skipped.has(l.name), disabled: !l.id, title: l.id ? null : t('mgr.list_new'),
    onchange: async () => {
      box.disabled = true;
      if (!(await setListReview(l.id, box.checked))) box.checked = !box.checked; // mislukt: de store meldde het al
      box.disabled = false;
      refreshManager();
    },
  }));
  return el('li', { class: 'mgr-list', 'data-list': l.name },
    el('span', { class: 'mgr-list-name' }, l.name),
    el('span', { class: 'mgr-list-count' }, t('mgr.list_count', { n: count })),
    el('label', { class: 'mgr-include-label' }, box, el('span', {}, t('mgr.include'))));
}

function buildPage() {
  const p = prefs();
  const stale = staleShown();
  const perList = new Map();
  for (const x of staleTasks(state.open.filter((x) => !swipedAway(x)), p, new Set(), Date.now())) perList.set(x.list, (perList.get(x.list) ?? 0) + 1);
  const skipped = skippedLists();
  return el('div', { class: 'mgr-page' },
    el('div', { class: 'mgr-head' },
      stale.length
        ? [el('p', { class: 'mgr-count' }, plural('mgr.count', stale.length)),
          el('button', { type: 'button', class: 'mgr-start', 'data-focus': 'start', onclick: startRound }, t('mgr.start'))]
        : el('p', { class: 'mgr-count mgr-clear' }, t('mgr.all_clear'))),
    el('div', { class: 'mgr-terms' }, daysField('mgr.new_days', 'newDays'), daysField('mgr.seen_days', 'seenDays')),
    el('h3', { class: 'mgr-h' }, t('mgr.lists')),
    el('ul', { class: 'mgr-lists' }, ...lists().map((l) => listRow(l, perList.get(l.name) ?? 0, skipped))));
}

/** De pagina opnieuw opbouwen; focus en een half getypte termijn blijven staan. */
function showPage() {
  if (!S.root) return;
  const active = document.activeElement instanceof HTMLElement && S.root.contains(document.activeElement) ? document.activeElement : null;
  const focus = active?.dataset.focus;
  const typed = active instanceof HTMLInputElement && active.type === 'number' ? active.value : null;
  S.view = 'page';
  S.round = null;
  S.root.replaceChildren(buildPage());
  if (!focus) return;
  const again = /** @type {HTMLElement | null} */ (S.root.querySelector(`[data-focus="${CSS.escape(focus)}"]`));
  if (again instanceof HTMLInputElement && typed !== null) again.value = typed;
  again?.focus({ preventScroll: true });
}

// ---------- de ronde ----------

function startRound() {
  const ids = staleShown().map((x) => x.id);
  if (!ids.length) { showPage(); return; }
  S.round = { ids, i: 0, n: { planned: 0, top: 0, deleted: 0, kept: 0 } };
  showCard();
}

/** Leeftijd als tekst: dagen onder twee weken, weken onder 60 dagen, daarna maanden. */
function ageText(days) {
  if (days < 14) return plural('mgr.age_days', days);
  if (days < 60) return plural('mgr.age_weeks', Math.floor(days / 7));
  return plural('mgr.age_months', Math.floor(days / 30));
}

/** De volgende kaart (de huidige als die nog open is); geen meer: de samenvatting. */
function showCard() {
  const r = S.round;
  if (!r || !S.root) return;
  r.i = nextIndex(r.ids, r.i, new Set(state.open.filter((x) => !swipedAway(x)).map((x) => x.id)));
  if (r.i >= r.ids.length) { showSummary(); return; }
  const task = state.open.find((x) => x.id === r.ids[r.i]);
  if (!task) return; // kan niet: nextIndex gaf een open taak
  S.view = 'card';
  const desc = (task.description ?? '').trim();
  const actions = el('div', { class: 'mgr-actions' });
  const done = (/** @type {'planned' | 'top' | 'deleted' | 'kept'} */ kind) => { r.n[kind]++; r.i++; showCard(); };
  const plan = async () => {
    const slots = await suggest(task);
    if (S.round !== r || r.ids[r.i] !== task.id) return; // intussen gestopt of verder
    const pick = (remind_at) => { update(task.id, { remind_at }); markReviewed(task.id); done('planned'); };
    const dateBtn = el('button', { type: 'button', class: 'ghost', onclick: () => openDatePicker(dateBtn, '', (value) => {
      if (value) pick(fromLocalInput(value)); // Wissen: niets ingepland, de kaart blijft
    }) }, t('mgr.pick_date'));
    actions.replaceChildren(
      ...slots.map((s) => el('button', { type: 'button', class: 'ghost mgr-slot', onclick: () => pick(s.at) }, s.label)),
      dateBtn,
      el('button', { type: 'button', class: 'ghost', onclick: drawActions }, t('dialog.cancel')));
    /** @type {HTMLElement | null} */ (actions.firstElementChild)?.focus();
  };
  function drawActions() {
    actions.replaceChildren(
      el('button', { type: 'button', class: 'ghost', onclick: plan }, t('mgr.plan')),
      el('button', { type: 'button', class: 'ghost', onclick: () => {
        update(task.id, { position: topOf(task, state.open) });
        markReviewed(task.id);
        done('top');
      } }, t('mgr.top')),
      el('button', { type: 'button', class: 'ghost', onclick: () => { markReviewed(task.id); done('kept'); } }, t('mgr.keep')),
      el('button', { type: 'button', class: 'danger', onclick: async () => {
        if (await deleteWithUndo(task)) done('deleted'); // geweigerd: de kaart blijft
      } }, t('mgr.delete')));
    /** @type {HTMLElement | null} */ (actions.firstElementChild)?.focus({ preventScroll: true });
  }
  S.root.replaceChildren(el('div', { class: 'mgr-round', role: 'group', 'aria-label': t('mgr.round') },
    el('div', { class: 'mgr-bar' },
      el('span', { class: 'mgr-progress' }, t('mgr.progress', { i: r.i + 1, n: r.ids.length })),
      el('button', { type: 'button', class: 'ghost mgr-stop', onclick: showPage }, t('mgr.stop'))),
    el('article', { class: 'mgr-card' },
      el('h3', { class: 'mgr-title' }, task.title),
      el('p', { class: 'mgr-meta' }, el('span', {}, task.list), el('span', {}, ageText(staleDays(task, Date.now())))),
      desc ? el('p', { class: 'mgr-desc' }, desc.length > 140 ? desc.slice(0, 140).trimEnd() + '…' : desc) : null),
    actions));
  drawActions();
}

function showSummary() {
  const n = S.round?.n ?? { planned: 0, top: 0, deleted: 0, kept: 0 };
  S.view = 'summary';
  S.round = null;
  const back = el('button', { type: 'button', class: 'mgr-start', onclick: closeManager }, t('mgr.back'));
  S.root?.replaceChildren(el('div', { class: 'mgr-summary' },
    el('h3', { class: 'mgr-h' }, t('mgr.done')),
    el('p', {}, t('mgr.summary', n)),
    back));
  back.focus({ preventScroll: true });
}

// ---------- openen en sluiten ----------

/** De pagina opnieuw tekenen na een wijziging (getallen, lijsten); niet tijdens een kaart of de samenvatting. */
export function refreshManager() {
  if (S.open && S.view === 'page') showPage();
}

export function openManager({ push = true, start = false } = {}) {
  if (!prefs().on) return; // uitgezet in de instellingen: de gewone lijst blijft
  closeDrawer();
  if (!S.open) {
    S.open = true;
    if (push) history.pushState({ manager: true }, '');
    S.root = el('section', { id: 'manager', 'aria-label': t('mgr.title') });
    $('#main').append(S.root);
    document.body.classList.add('manager-open');
    showPage();
    render(); // de zijbalk zet de titel en verbergt het invoerveld (zie updateHeader)
    $('#main').scrollTop = 0;
    window.scrollTo(0, 0);
  }
  if (start && S.view === 'page') startRound();
}

/** Verbergt de pagina zonder de geschiedenis te raken (voor popstate). */
export function hideManager() {
  if (!S.open) return;
  S.open = false;
  S.round = null;
  S.view = 'page';
  S.root?.remove();
  S.root = null;
  document.body.classList.remove('manager-open');
  render();
}

export function closeManager() {
  if (!S.open) return;
  if (history.state?.manager) history.back(); // popstate verbergt de pagina
  else hideManager();
}

// Esc buiten een veld: tijdens de ronde terug naar de pagina, op de pagina sluiten (niet met een dialoog, het menu of
// een taak open).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !S.open || state.selected) return;
  if (document.querySelector('dialog[open]') || document.body.matches('.drawer-open, .sheet-open')) return;
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
  e.stopPropagation();
  if (S.view === 'card') showPage();
  else closeManager();
}, true);
