import { ask } from './dialog.js';
import { t } from './i18n.js';
import { sameName } from './lists.js';
import { el } from './render.js';
import { deleteList, listNames, lists, renameList, state } from './store.js';

// Menu bij een lijst in de zijbalk en achter de titel: hernoemen, taken verplaatsen naar, verwijderen

let closeOpen = null;
/** Geopend vanaf de titel boven de lijst: hernoemen gebeurt daar, en daar gaat de focus ook weer heen. */
let fromTitle = false;

const openCount = (name) => lists().find((l) => l.name === name)?.open ?? 0;

/**
 * @param {string} name
 * @param {HTMLElement} anchor het lijstknopje in de zijbalk, of de titel boven de lijst
 */
export function openListMenu(name, anchor) {
  if (!name || name === 'Inbox') return; // vaste lijsten hebben geen menu
  closeOpen?.();
  fromTitle = anchor.id === 'title';

  const menu = el('div', { class: 'menu', role: 'menu', 'aria-label': t('lists.menu_named', { name }) });
  const item = (label, onclick, extra = '') => el('button', { class: 'menu-item' + extra, type: 'button', role: 'menuitem', onclick }, label);
  const focusFirst = () => /** @type {HTMLElement | null} */ (menu.querySelector('.menu-item'))?.focus();
  const showMain = () => {
    menu.replaceChildren(
      item(t('lists.rename'), () => { close(); startRename(name, anchor); }),
      item(t('lists.move_tasks'), showTargets),
      item(t('lists.delete'), () => { close(); confirmDelete(name); }, ' menu-danger'),
    );
    focusFirst();
  };
  const showTargets = () => {
    const others = listNames().filter((n) => n !== name); // Inbox staat al vooraan
    menu.replaceChildren(
      el('button', { class: 'menu-item muted', type: 'button', role: 'menuitem', onclick: showMain }, t('lists.back')),
      ...others.map((n) => item(n, () => { close(); confirmMerge(name, n); })),
    );
    focusFirst();
  };

  // Capture op document: Esc sluit alleen het menu.
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      close();
      focusList(name);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...menu.querySelectorAll('.menu-item')];
    e.preventDefault();
    const i = items.indexOf(/** @type {any} */ (document.activeElement));
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
    /** @type {HTMLElement} */ (items[next]).focus();
  };
  // Het ⋯-knopje opent het menu opnieuw, dus dat sluiten we hier niet eerst.
  const onDown = (e) => { if (!menu.contains(e.target) && !e.target.closest?.('.list-more, #title')) close(); };
  function close() {
    if (closeOpen !== close) return;
    closeOpen = null;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onDown, true);
    menu.remove();
  }
  closeOpen = close;
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onDown, true);
  document.body.append(menu);
  showMain();
  place(menu, anchor);
}

/** Onder de knop, en binnen het scherm. */
function place(menu, anchor) {
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const left = Math.max(8, Math.min(r.left + 8, innerWidth - w - 8));
  const below = r.bottom + 2;
  const top = below + h > innerHeight - 8 ? Math.max(8, r.top - h - 2) : below;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}

/** De naam wordt op zijn plek een invoerveld. */
function startRename(name, anchor) {
  // Na een render bestaat de knop misschien niet meer; zoek hem opnieuw.
  const button = /** @type {HTMLElement} */ (fromTitle ? anchor : [...document.querySelectorAll('#side-lists button[data-list]')]
    .find((b) => /** @type {HTMLElement} */ (b).dataset.list === name) ?? anchor);
  const input = el('input', { class: 'rename-input', value: name, maxlength: '100', 'aria-label': t('lists.new_name'), autocomplete: 'off' });
  let finished = false;
  const finish = (commit, refocus = commit) => {
    if (finished) return;
    finished = true;
    const value = input.value.trim();
    input.remove();
    button.hidden = false;
    if (commit && value && value !== name) commitRename(name, value).then(focusList);
    else if (refocus) focusList(name);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // geen Esc voor het uitschuifmenu, geen sneltoetsen
    if (e.key === 'Escape') { e.preventDefault(); finish(false, true); }
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
  });
  // Wie wegklikt annuleert; alleen Enter bevestigt.
  input.addEventListener('blur', () => finish(false));
  // Naast de knop in plaats van erin: een invoerveld in een knop werkt niet overal.
  button.hidden = true;
  button.after(input);
  input.focus();
  input.select();
}

async function commitRename(name, value) {
  // Een andere lijst met die naam; de lijst zelf telt niet ("Werk" naar "werk" naast een bestaande "werk" vraagt wel).
  const target = listNames().find((n) => n !== name && sameName(n, value));
  if (target) {
    const answer = await ask({
      title: t('lists.merge_title'),
      text: t('lists.merge_exists', { value, name }),
      buttons: [{ label: t('lists.merge'), value: 'merge', kind: 'primary' }, { label: t('dialog.cancel'), value: null, kind: 'ghost' }],
    });
    if (answer !== 'merge') return name;
    renameList(name, target); // de bestaande schrijfwijze wint; de zijbalk staat direct goed, de server volgt
    return target;
  }
  // Zonder andere lijst met die naam is ook "werk" naar "Werk" gewoon hernoemen.
  renameList(name, value);
  return value;
}

async function confirmMerge(name, target) {
  const answer = await ask({
    title: t('lists.move_title'),
    text: t('lists.merge_confirm', { n: openCount(name), name, target }),
    buttons: [{ label: t('lists.move'), value: 'merge', kind: 'primary' }, { label: t('dialog.cancel'), value: null, kind: 'ghost' }],
  });
  if (answer === 'merge') renameList(name, target);
  focusList(answer === 'merge' ? target : name);
}

async function confirmDelete(name) {
  const answer = await ask({
    title: t('lists.delete_title', { name, n: openCount(name) }),
    text: t('lists.delete_text'),
    buttons: [
      { label: t('lists.delete_to_inbox'), value: 'inbox', kind: 'primary' },
      { label: t('lists.delete_tasks_too'), value: 'delete', kind: 'danger' },
      { label: t('dialog.cancel'), value: null, kind: 'ghost' },
    ],
  });
  if (answer === 'inbox' || answer === 'delete') {
    deleteList(name, answer);
    focusList(state.list ?? '');
  } else focusList(name);
}

/**
 * Focus terug naar een lijst in de zijbalk na een actie uit het menu, anders valt hij naar het begin van de pagina.
 * Na een render is de knop vervangen, dus opnieuw opzoeken; '' is Alle.
 */
function focusList(name) {
  const title = /** @type {HTMLButtonElement} */ (document.getElementById('title'));
  if (fromTitle && !title.disabled) { title.focus(); return; }
  const buttons = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('#side-lists button[data-list]')]);
  (buttons.find((b) => b.dataset.list === name) ?? buttons[0])?.focus();
}
