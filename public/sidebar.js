import { t } from './i18n.js';
import { $, el, render } from './render.js';
import { listColor } from './lists.js';
import { createList, lists, load, loadTrash, state } from './store.js';

let contextHandler = () => {};
/** Haak voor het lijstmenu (rechtsklik op een lijst); de aanroeper krijgt de naam en het knopelement. */
export const onListContext = (fn) => { contextHandler = fn; };

// Het uitschuifmenu houdt de focus bij zich: de rest is zolang inert (niet te tabben, niet voor een schermlezer).
const behindDrawer = () => ['#topbar', '#main', '#detail'].map((s) => /** @type {HTMLElement} */ ($(s)));

export function openDrawer() {
  document.body.classList.add('drawer-open');
  $('#btn-menu').setAttribute('aria-expanded', 'true');
  for (const e of behindDrawer()) e.inert = true;
  /** @type {HTMLElement | null} */ ($('#side .item.on, #side .item[aria-pressed="true"], #side .item'))?.focus();
}
export function closeDrawer() {
  if (!document.body.classList.contains('drawer-open')) return; // ook op desktop aangeroepen: dan geen focus verplaatsen
  const inside = $('#side').contains(document.activeElement);
  document.body.classList.remove('drawer-open');
  $('#btn-menu').setAttribute('aria-expanded', 'false');
  for (const e of behindDrawer()) e.inert = false;
  if (inside) $('#btn-menu').focus();
}

export function selectList(name) {
  state.list = name;
  state.showDone = false;
  state.showTrash = false;
  closeDrawer();
  render();
}

/** Zijbalk (en uitschuifmenu), mobiele titel en het invoerveld, passend bij de gekozen lijst. */
export function renderSidebar() {
  hideMore(); // de knoppen worden hieronder vervangen
  // Tijdens het hernoemen blijft het invoerveld staan; de volgende render zet de rest recht.
  if ($('#side-lists .rename-input')) { updateHeader(); return; }
  const all = lists();
  // Met de instellingen open is geen lijst gekozen in de zijbalk; ⚙ Instellingen is dan gemarkeerd.
  const current = (name) => !settingsOpen() && !calendarOpen() && !helpOpen() && !state.showDone && !state.showTrash && state.list === name;
  const item = (name, label, count, lead) =>
    el('button', {
      class: 'item' + (current(name) ? ' on' : ''),
      'data-list': name ?? '',
      'aria-current': current(name) ? 'true' : false,
    }, lead, el('span', { class: 'name' }, label), el('span', { class: 'count' }, String(count)));
  // Een lijst die alleen afgeronde taken heeft staat er gewoon met 0.
  const total = all.reduce((n, l) => n + l.open, 0);
  const inbox = all.find((l) => l.name === 'Inbox');
  // Blokken: Alle en Inbox, dan de eigen lijsten (met Nieuwe lijst eronder, in #side-new), elk met een vaste kleur.
  $('#side-lists').replaceChildren(
    el('div', { class: 'side-grp' },
      item(null, t('ui.all'), total, icon(ALL)),
      inbox ? item(inbox.name, inbox.name, inbox.open, icon(INBOX)) : null),
    el('p', { class: 'side-h' }, t('ui.lists')),
    el('div', { class: 'side-grp side-mine' }, ...all.filter((l) => l !== inbox).map((l) => item(l.name, l.name, l.open, dot(l.name, all.map((x) => x.name))))),
  );
  updateHeader();
}

const ALL = 'M4 6h2M4 12h2M4 18h2M9 6h11M9 12h11M9 18h11';
const INBOX = 'M4 13h4l1 3h6l1-3h4M4 13l2-8h12l2 8v6H4z';

/** Een lijnicoon (zoals Kalender, Afgerond en Prullenbak in index.html). */
function icon(d) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

/** Het kleurbolletje van een eigen lijst (de kleur volgt uit de naam, zie listColor). */
function dot(name, names) {
  const span = el('span', { class: 'dot', 'aria-hidden': 'true' });
  span.style.setProperty('--dot', listColor(name, names) ?? ''); // CSSOM: geen style-attribuut (CSP)
  return span;
}

const settingsOpen = () => document.body.classList.contains('settings-open');
const calendarOpen = () => document.body.classList.contains('calendar-open');
const helpOpen = () => document.body.classList.contains('help-open');

function updateHeader() {
  const open = settingsOpen();
  const cal = calendarOpen();
  const help = helpOpen();
  $('#btn-done').setAttribute('aria-pressed', String(state.showDone && !open && !cal && !help));
  $('#btn-trash').setAttribute('aria-pressed', String(state.showTrash && !open && !cal && !help));
  $('#btn-calendar').setAttribute('aria-pressed', String(cal));
  $('#btn-help')?.setAttribute('aria-pressed', String(help));
  $('#btn-settings')?.setAttribute('aria-pressed', String(open));
  $('#title').textContent = open ? t('set.title') : cal ? t('cal.title') : help ? t('help.title')
    : state.showTrash ? t('ui.trash') : state.showDone ? t('ui.completed') : state.list ?? t('ui.all');
  // Alleen een eigen lijst heeft een menu achter de titel; Alle, Inbox en de andere weergaven niet.
  /** @type {HTMLButtonElement} */ ($('#title')).disabled = open || cal || help || state.showTrash || state.showDone || !state.list || state.list === 'Inbox';
  // Afgerond toont alle lijsten; een nieuwe taak gaat daar naar Inbox, net als bij Alle.
  $('#add-title').placeholder = state.list && !state.showDone && !state.showTrash ? t('sidebar.add_to_list', { list: state.list }) : t('ui.new_task_placeholder');
  // Geen nieuwe taak in Afgerond, de prullenbak of de help, en niet tijdens zoeken (de lijst toont dan alleen treffers).
  $('#add').hidden = help || state.showDone || state.showTrash || !!state.query.trim();
}

const listButton = (e) => e.target.closest('button[data-list]');
const hasMenu = (b) => b && b.dataset.list && b.dataset.list !== 'Inbox';

// ⋯ bij hover (alleen met een muis): één zwevend knopje, omdat een knop in een knop niet kan.
let more = null;
let moreFor = null;
function hideMore() { if (more) more.hidden = true; moreFor = null; }
function showMore(b) {
  if (!more) {
    more = el('button', { class: 'list-more', type: 'button', 'aria-label': t('lists.menu'), 'aria-haspopup': 'menu', hidden: true,
      onclick: () => { if (moreFor) contextHandler(moreFor.dataset.list, moreFor); } }, '⋯');
    more.addEventListener('pointerleave', (e) => { if (!e.relatedTarget?.closest?.('#side-lists')) hideMore(); });
    document.body.append(more);
  }
  const r = b.getBoundingClientRect();
  more.style.left = r.right - 34 + 'px';
  more.style.top = r.top + 3 + 'px';
  more.style.height = r.height - 6 + 'px';
  more.hidden = false;
  moreFor = b;
}

// Lang drukken (mobiel) opent het lijstmenu; de klik die erop volgt mag de lijst niet kiezen.
const LONG_PRESS_MS = 500;
let pressTimer = 0;
let pressed = false;
let opened = { name: '', at: 0 };

/** Opent het lijstmenu, maar niet twee keer kort na elkaar voor dezelfde lijst (lang drukken plus contextmenu). */
function openMenu(b) {
  const name = b.dataset.list;
  if (opened.name === name && Date.now() - opened.at < 1000) return;
  opened = { name, at: Date.now() };
  contextHandler(name, b);
}

/** Koppelt de knoppen. Pas aanroepen vanuit app.js: render.js en dit bestand importeren elkaar. */
export function setupSidebar() {
  const side = $('#side-lists');
  side.addEventListener('click', (e) => {
    if (pressed) { pressed = false; return; }
    const b = listButton(e);
    if (b) selectList(b.dataset.list || null);
  });
  side.addEventListener('contextmenu', (e) => {
    const b = listButton(e);
    if (!hasMenu(b)) return;
    e.preventDefault();
    // Android stuurt bij lang drukken ook zelf een contextmenu: dat is hetzelfde drukken, dus één menu.
    if (start || pressed) { cancelPress(); pressed = true; }
    openMenu(b);
  });
  side.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const b = listButton(e);
    if (hasMenu(b)) { if (b !== moreFor) showMore(b); } else hideMore();
  });
  side.addEventListener('pointerleave', (e) => { if (!e.relatedTarget?.closest?.('.list-more')) hideMore(); });
  // Het ⋯ staat vast op het scherm en zou bij scrollen naast een andere lijst blijven hangen.
  $('#side').addEventListener('scroll', hideMore, { passive: true });

  let start = null;
  const cancelPress = () => { clearTimeout(pressTimer); start = null; };
  side.addEventListener('pointerdown', (e) => {
    const b = listButton(e);
    if (e.pointerType !== 'touch' || !hasMenu(b)) return;
    pressed = false;
    start = { x: e.clientX, y: e.clientY };
    pressTimer = setTimeout(() => { pressed = true; start = null; openMenu(b); }, LONG_PRESS_MS);
  });
  side.addEventListener('pointermove', (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancelPress();
  });
  for (const type of ['pointerup', 'pointercancel']) side.addEventListener(type, cancelPress);
  // Blijft het drukken zonder klik (vinger weggesleept), dan niet de volgende klik opeten.
  side.addEventListener('pointerup', () => setTimeout(() => { pressed = false; }, 400));

  $('#btn-menu').addEventListener('click', openDrawer);
  // Breder geworden met het menu open: de zijbalk staat dan vast, dus niets meer inert laten.
  matchMedia('(min-width: 1024px)').addEventListener('change', (e) => { if (e.matches) closeDrawer(); });
  $('.scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  $('#btn-done').addEventListener('click', () => {
    state.showDone = true;
    state.doneLoading = true;
    state.showTrash = false;
    closeDrawer();
    render();
    load();
  });
  $('#btn-trash').addEventListener('click', () => {
    state.showTrash = true;
    state.showDone = false;
    state.trash = null;
    closeDrawer();
    render();
    loadTrash();
  });

  // "+ Nieuwe lijst" wordt op zijn plek een invoerveld.
  const button = $('#btn-newlist');
  const input = $('#newlist-input');
  const stop = () => { input.hidden = true; input.value = ''; button.hidden = false; };
  button.addEventListener('click', () => {
    button.hidden = true;
    input.hidden = false;
    input.focus();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); stop(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const value = input.value.trim();
    stop();
    if (!value) return;
    state.list = createList(value);
    state.showDone = false;
    state.showTrash = false;
    closeDrawer();
    render();
    $('#add-title').focus();
  });
  input.addEventListener('blur', stop);
}
