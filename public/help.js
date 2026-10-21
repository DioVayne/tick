// Help: een korte pagina in de middenkolom, naar het voorbeeld van de kalender. Per knop een kopje en één zin.
import { t } from './i18n.js';
import { $, el, render } from './render.js';
import { closeDrawer } from './sidebar.js';
import { state } from './store.js';

const TOPICS = ['menu', 'search', 'check', 'drag', 'list', 'remind', 'repeat', 'done', 'trash', 'undo'];

const S = { open: false, root: null };

export const isHelpOpen = () => S.open;

const build = () => el('section', { id: 'help', 'aria-label': t('help.title') },
  el('p', { class: 'help-intro' }, t('help.intro')),
  el('ul', { class: 'help-list' }, ...TOPICS.map((k) =>
    el('li', {}, el('h3', {}, t(`help.${k}_h`)), el('p', {}, t(`help.${k}`))))));

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
