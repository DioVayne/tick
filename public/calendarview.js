// Kalender: een eigen pagina in de middenkolom, naar het voorbeeld van de instellingen. Maandraster en agenda.
import { agenda, dayKey, monthGrid, startOfDay, tasksByDay } from './calendar.js';
import { selectTask } from './detail.js';
import { dateLocale, t } from './i18n.js';
import { chipDays, getTimeZone, zonedParts } from './repeat.js';
import { $, el, render } from './render.js';
import { closeDrawer } from './sidebar.js';
import { state } from './store.js';

const MODE_KEY = 'tick.calMode';
const MAX_CHIPS = 3;
const AGENDA_STEP = 30;

const S = { open: false, root: null, mode: 'month', y: 0, m: 0, from: 0, days: AGENDA_STEP };

try { if (localStorage.getItem(MODE_KEY) === 'agenda') S.mode = 'agenda'; } catch { /* geen opslag */ }

export const isCalendarOpen = () => S.open;

const weekStart = () => (chipDays()[0] === 6 ? 'sun' : 'mon');
const tz = () => getTimeZone();
const timeText = (ms) => new Date(ms).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit', timeZone: tz() });
const dayText = (ms) => new Date(ms).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz() });
const tasks = () => state.open.filter((x) => x.remind_at && !x.done && !x.deleted_at);

function today() {
  const p = zonedParts(Date.now());
  return { y: p.y, m: p.m, d: p.d, key: dayKey(Date.now()), ms: startOfDay(p.y, p.m, p.d) };
}

function goToday() {
  const n = today();
  S.y = n.y; S.m = n.m; S.from = n.ms; S.days = AGENDA_STEP;
}

function step(delta) {
  if (S.mode === 'month') {
    const d = new Date(Date.UTC(S.y, S.m - 1 + delta, 1));
    S.y = d.getUTCFullYear(); S.m = d.getUTCMonth() + 1;
  } else {
    const p = zonedParts(S.from);
    S.from = startOfDay(p.y, p.m, p.d + delta * AGENDA_STEP);
  }
  paint();
}

function setMode(mode) {
  S.mode = mode;
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* geen opslag */ }
  paint();
}

const taskButton = (task, ms, cls) =>
  el('button', { class: cls, type: 'button', onclick: () => selectTask(task.id) },
    el('span', { class: 'cal-time' }, timeText(ms)), ' ', el('span', { class: 'cal-name' }, task.title));

function monthTitle() {
  return new Date(Date.UTC(S.y, S.m - 1, 1)).toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function monthView() {
  const weeks = monthGrid(S.y, S.m, weekStart());
  const first = weeks[0][0];
  const last = weeks[weeks.length - 1][6];
  const byDay = tasksByDay(tasks(), startOfDay(first.y, first.m, first.d), startOfDay(last.y, last.m, last.d + 1));
  const now = today();
  const head = weeks[0].map((c) => el('div', { class: 'cal-wd' }, t(`wd.short.${c.wd}`)));
  const cells = weeks.flat().map((c) => {
    const items = byDay.get(c.key) ?? [];
    const shown = items.slice(0, MAX_CHIPS).map((i) => taskButton(i.task, i.ms, 'cal-chip'));
    const date = new Date(Date.UTC(c.y, c.m - 1, c.d)).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    return el('div', { class: 'cal-cell' + (c.inMonth ? '' : ' out') + (c.key === now.key ? ' today' : '') },
      el('button', { class: 'cal-num', type: 'button', 'aria-label': t('cal.day', { date }),
        onclick: () => { S.from = startOfDay(c.y, c.m, c.d); S.days = AGENDA_STEP; setMode('agenda'); } }, String(c.d)),
      ...shown,
      items.length > MAX_CHIPS
        ? el('button', { class: 'cal-more', type: 'button', onclick: () => { S.from = startOfDay(c.y, c.m, c.d); S.days = AGENDA_STEP; setMode('agenda'); } },
          t('cal.more', { n: items.length - MAX_CHIPS }))
        : null);
  });
  return el('div', { class: 'cal-grid' }, ...head, ...cells);
}

function agendaView() {
  const now = today();
  const a = agenda(tasks(), S.from, S.days);
  const root = el('div', { class: 'cal-agenda' });
  if (S.from === now.ms && a.overdue.length) {
    root.append(el('h3', { class: 'cal-day overdue' }, t('cal.overdue')),
      ...a.overdue.map((i) => el('div', { class: 'cal-row' }, taskButton(i.task, i.ms, 'cal-item'),
        el('span', { class: 'cal-when' }, new Date(i.ms).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', timeZone: tz() })))));
  }
  for (const day of a.days) {
    root.append(el('h3', { class: 'cal-day' + (day.key === now.key ? ' today' : '') }, dayText(day.ms)),
      ...day.items.map((i) => el('div', { class: 'cal-row' }, taskButton(i.task, i.ms, 'cal-item'))));
  }
  if (!a.days.length && !(S.from === now.ms && a.overdue.length)) root.append(el('p', { class: 'cal-empty' }, t('cal.empty')));
  root.append(el('button', { class: 'cal-morebtn', type: 'button', onclick: () => { S.days += AGENDA_STEP; paint(); } }, t('cal.more_days')));
  return root;
}

function paint() {
  if (!S.root) return;
  const month = S.mode === 'month';
  const mode = (id, label) => el('button', { class: 'cal-mode', type: 'button', 'aria-pressed': String(S.mode === id), onclick: () => setMode(id) }, label);
  S.root.replaceChildren(
    el('div', { class: 'cal-bar' },
      el('button', { class: 'cal-nav', type: 'button', 'aria-label': t('cal.prev'), onclick: () => step(-1) }, '‹'),
      el('button', { class: 'cal-nav', type: 'button', 'aria-label': t('cal.next'), onclick: () => step(1) }, '›'),
      el('button', { class: 'cal-nav cal-today', type: 'button', onclick: () => { goToday(); paint(); } }, t('cal.today')),
      el('h2', { class: 'cal-heading', 'aria-live': 'polite' }, month ? monthTitle() : dayText(S.from)),
      el('div', { class: 'cal-modes', role: 'group' }, mode('month', t('cal.month')), mode('agenda', t('cal.agenda')))),
    month ? monthView() : agendaView());
}

/** Tekent de kalender opnieuw als de taken veranderen. */
export function refreshCalendar() { if (S.open) paint(); }

export function openCalendar({ push = true } = {}) {
  closeDrawer();
  if (S.open) return;
  S.open = true;
  if (push) history.pushState({ calendar: true }, '');
  goToday();
  S.root = el('section', { id: 'calendar', 'aria-label': t('cal.title') });
  $('#main').append(S.root);
  document.body.classList.add('calendar-open');
  render();
  paint();
  $('#main').scrollTop = 0;
  window.scrollTo(0, 0);
}

/** Verbergt de pagina zonder de geschiedenis te raken (voor popstate). */
export function hideCalendar() {
  if (!S.open) return;
  S.open = false;
  S.root?.remove();
  S.root = null;
  document.body.classList.remove('calendar-open');
  render();
}

export function closeCalendar() {
  if (!S.open) return;
  if (history.state?.calendar) history.back(); // popstate verbergt de pagina
  else hideCalendar();
}

// Esc buiten een veld sluit de pagina (niet als er een dialoog, het menu of een taak open is).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !S.open || state.selected) return;
  if (document.querySelector('dialog[open]') || document.body.classList.contains('drawer-open')) return;
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
  e.stopPropagation();
  closeCalendar();
}, true);
