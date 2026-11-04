// Strook "Voor vandaag" bovenaan de lijst: de taken achter de teller op het icoon (zie badge.js), uit alle lijsten.
// Standaard ingeklapt tot één regel met het getal; open blijft open op dit apparaat. Zonder taken of met de teller uit: weg.
import { badgeOff, dueTasks } from './badge.js';
import { confetti, isCouple } from './confetti.js';
import { selectTask } from './detail.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { listColor } from './lists.js';
import { checkOff, el, fmt, render } from './render.js';
import { claimedByOther, listNames, state } from './store.js';

const OPEN_KEY = 'tick.dueOpen';
const isOpen = () => { try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } };
function setOpen(open) {
  try { if (open) localStorage.setItem(OPEN_KEY, '1'); else localStorage.removeItem(OPEN_KEY); } catch { /* geen opslag */ }
}

/** Eén taak in de strook: vinkje, titel (opent de taak), de lijst als pilletje en de herinnering. */
function dueItem(task, today, names) {
  const late = Date.parse(task.remind_at) < today;
  const past = Date.parse(task.remind_at) < Date.now();
  const locked = claimedByOther(task);
  const pill = el('span', { class: 'lpill' }, task.list);
  const color = listColor(task.list, names);
  if (color) pill.style.setProperty('--lc', color); // CSSOM: geen style-attribuut (CSP)
  return el('li', { class: 'due-item' },
    el('div', { class: 'row' },
      el('button', {
        class: 'check', role: 'checkbox', 'aria-checked': 'false', disabled: locked,
        'aria-label': t('render.check_named', { title: task.title }),
        onclick: (e) => { confetti(e.currentTarget, isCouple(task.share)); checkOff(task); },
      }),
      el('button', { class: 'title', type: 'button', onclick: () => selectTask(task.id) }, task.title),
      pill),
    el('div', { class: 'meta' },
      el('span', { class: 'bell' + (past ? ' past' : '') + (late ? ' late' : '') }, icon('bell', 'sm'), fmt(task.remind_at),
        late ? ` · ${t('due.late')}` : null)));
}

/** De strook, of null als er niets voor vandaag is (of de teller op dit apparaat uit staat). */
export function dueStrip() {
  if (badgeOff()) return null;
  const { tasks, today } = dueTasks(state.open, Date.now());
  if (!tasks.length) return null;
  const open = isOpen();
  const late = tasks.some((x) => Date.parse(x.remind_at) < today);
  const label = t('due.count', { n: tasks.length });
  const head = el('button', {
    class: 'due-head', type: 'button', 'aria-expanded': String(open), 'aria-controls': open ? 'due-list' : false, 'aria-label': label,
    onclick: () => { setOpen(!open); render(); },
  },
  icon('bell', 'sm'),
  el('span', { class: 'due-title' }, t('due.title')),
  el('span', { class: 'due-count' + (late ? ' late' : ''), 'aria-hidden': 'true' }, String(tasks.length)),
  el('span', { class: 'due-chev', 'aria-hidden': 'true' }, open ? '▴' : '▾'));
  const names = listNames();
  return el('section', { class: 'due' + (open ? ' open' : '') },
    head,
    open ? el('ul', { id: 'due-list', class: 'due-list' }, tasks.map((x) => dueItem(x, today, names))) : null);
}
