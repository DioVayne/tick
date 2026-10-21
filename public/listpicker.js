import { t } from './i18n.js';
import { el } from './render.js';
import { createList, listNames } from './store.js';

// Lijstkeuzemenu onder een knop: Inbox, de andere lijsten en onderaan "Nieuwe lijst…".

let closeOpen = null;
let openAnchor = null;

/**
 * @param {HTMLElement} anchor
 * @param {string} current
 * @param {(name: string) => void} onPick
 */
export function openListPicker(anchor, current, onPick) {
  // Nog een keer op dezelfde knop: dicht.
  if (closeOpen && openAnchor === anchor) { closeOpen(); return; }
  closeOpen?.();
  const names = listNames(); // Inbox staat al vooraan
  const item = (name) => el('button', {
    class: 'menu-item' + (name === current ? ' on' : ''), type: 'button', role: 'menuitemradio',
    'aria-checked': String(name === current),
    onclick: () => { close(); if (name !== current) onPick(name); },
  }, name);

  const input = el('input', { class: 'menu-input', placeholder: t('ui.list_name'), 'aria-label': t('ui.new_list_name'), maxlength: '100', autocomplete: 'off' });
  const newButton = el('button', {
    class: 'menu-item muted', type: 'button', role: 'menuitem',
    onclick: () => { newButton.replaceWith(input); input.focus(); },
  }, t('lists.new_list'));
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    close();
    const name = createList(value); // een bestaande schrijfwijze wint
    if (name !== current) onPick(name);
  });

  const menu = el('div', { class: 'menu', role: 'menu', 'aria-label': t('lists.pick') },
    ...names.map(item), el('div', { class: 'menu-sep' }), newButton);
  document.body.append(menu);
  place(menu, anchor);

  // Capture op document: Esc sluit alleen het menu, niet ook het paneel eronder.
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      close();
      anchor.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...menu.querySelectorAll('.menu-item')];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(/** @type {any} */ (document.activeElement));
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
    /** @type {HTMLElement} */ (items[next]).focus();
  };
  const onDown = (e) => { if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); };
  function close() {
    if (closeOpen !== close) return;
    closeOpen = null;
    openAnchor = null;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onDown, true);
    menu.remove();
    anchor.setAttribute('aria-expanded', 'false');
  }
  closeOpen = close;
  openAnchor = anchor;
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onDown, true);
  anchor.setAttribute('aria-expanded', 'true');
  /** @type {HTMLElement | null} */ (menu.querySelector('.menu-item.on') ?? menu.querySelector('.menu-item'))?.focus();
}

/** Onder de knop, en binnen het scherm. */
function place(menu, anchor) {
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
  const below = r.bottom + 4;
  const top = below + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : below;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}
