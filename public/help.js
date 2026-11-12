// Help: een pagina in de middenkolom, naar het voorbeeld van de kalender. Groepen (klein kopje, zoals in Instellingen) met
// per groep een kaart; per knop een icoon, een kopje en één zin. Daaronder de sneltoetsen (alleen met een toetsenbord en
// muis) en een link naar de volledige handleiding.
import { t } from './i18n.js';
import { icon } from './icons.js';
import { $, el, render } from './render.js';
import { closeDrawer } from './sidebar.js';
import { state } from './store.js';

/** Per groep de onderwerpen met hun icoon; --c (zie style.css) geeft een paar iconen de kleur die ze in de app hebben. */
const GROUPS = [
  ['basic', [['menu', 'menu'], ['search', 'search'], ['check', 'checkbox'], ['list', 'folder']]],
  ['order', [['drag', 'move'], ['swipe', 'swipe'], ['manager', 'bolt']]],
  ['time', [['remind', 'bell'], ['repeat', 'repeat']]],
  ['back', [['done', 'done'], ['trash', 'trash'], ['undo', 'undo']]],
];

/** Echte sneltoetsen uit app.js en composer.js (/ en N, Enter en Shift+Enter in het invoerveld, Esc). */
const KEYS = [[['/'], 'key_search'], [['N'], 'key_new'], [['Enter'], 'key_add'], [['Shift', 'Enter'], 'key_add_open'], [['Esc'], 'key_close']];

/** De handleiding in docs/ (Engels), op GitHub: de repo is openbaar. */
const GUIDE_URL = 'https://github.com/DioVayne/tick/blob/main/docs/README.md';

const S = { open: false, root: null };

export const isHelpOpen = () => S.open;

const group = (key, ...kids) => el('div', { class: 'help-group' },
  el('h2', { class: 'help-group-h', id: `help-g-${key}` }, t(`help.group_${key}`)), ...kids);

const item = (k, ico) => el('li', { class: `help-item help-${k}` },
  el('span', { class: 'help-ico' }, icon(/** @type {any} */ (ico))),
  el('div', { class: 'help-text' }, el('h3', {}, t(`help.${k}_h`)), el('p', {}, t(`help.${k}`))));

const keyRow = ([keys, k]) => el('li', { class: 'help-key' },
  el('span', { class: 'help-kbds' }, ...keys.flatMap((x, i) => i ? [el('span', { class: 'help-plus', 'aria-hidden': 'true' }, '+'), el('kbd', {}, x)] : [el('kbd', {}, x)])),
  el('span', {}, t(`help.${k}`)));

const build = () => el('section', { id: 'help', 'aria-label': t('help.title') },
  el('p', { class: 'help-intro' }, t('help.intro')),
  ...GROUPS.map(([g, items]) => group(g, el('ul', { class: 'help-card', 'aria-labelledby': `help-g-${g}` }, ...items.map(([k, ico]) => item(k, ico))))),
  el('div', { class: 'help-group help-keys' },
    el('h2', { class: 'help-group-h', id: 'help-g-keys' }, t('help.group_keys')),
    el('ul', { class: 'help-card', 'aria-labelledby': 'help-g-keys' }, ...KEYS.map(keyRow))),
  el('a', { class: 'help-guide', href: GUIDE_URL, target: '_blank', rel: 'noopener' },
    el('span', { class: 'help-ico' }, icon('book')),
    el('span', { class: 'help-text' }, el('strong', {}, t('help.guide')), el('small', {}, t('help.guide_note')))));

export function openHelp({ push = true } = {}) {
  closeDrawer();
  if (S.open) return;
  S.open = true;
  if (push) history.pushState({ help: true }, '');
  S.root = build();
  $('#main').append(S.root);
  document.body.classList.add('help-open');
  render(); // de zijbalk zet de titel op Help en verbergt het invoerveld (zie updateHeader)
  $('#main').scrollTop = 0;
  window.scrollTo(0, 0);
}

/** Verbergt de pagina zonder de geschiedenis te raken (voor popstate). */
export function hideHelp() {
  if (!S.open) return;
  S.open = false;
  S.root?.remove();
  S.root = null;
  document.body.classList.remove('help-open');
  render();
}

export function closeHelp() {
  if (!S.open) return;
  if (history.state?.help) history.back(); // popstate verbergt de pagina
  else hideHelp();
}

// Esc buiten een veld sluit de pagina (niet als er een dialoog, het menu of een taak open is).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !S.open || state.selected) return;
  if (document.querySelector('dialog[open]') || document.body.classList.contains('drawer-open')) return;
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
  e.stopPropagation();
  closeHelp();
}, true);
