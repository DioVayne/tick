import { confetti, isCouple } from './confetti.js';
import { copyPills } from './copies.js';
import { bindTitle, renderDetail, selectTask, titleOf } from './detail.js';
import { autoGrow } from './editor.js';
import { icon } from './icons.js';
import { dateLocale, t, t as tr } from './i18n.js'; // tr waar t al een taak is
import { listColor } from './lists.js';
import { plainText } from './markdown.js';
import { toHash } from './route.js';
import { renderSidebar } from './sidebar.js';
import { UNDO_MS, claimedByOther, listNames, lists, sharedOf, state, toggleDone, update } from './store.js';
import { renderTrash, shareLabel, shareNames } from './trash.js';
import { renderInvites } from './share.js';
import { claimControl, doneBlock } from './sharedlist.js';
import { deleteWithUndo, enableSwipe, swipedAway } from './swipe.js';

export const $ = (s) => document.querySelector(s);

export function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k);
  return e;
}

export function status(msg) {
  $('#status').textContent = msg || '';
}

// Melding die even onderin verschijnt en vanzelf weer verdwijnt: standaard een fout, met kind 'ok' een bevestiging.
const toastEl = el('div', { class: 'toast', role: 'alert', hidden: true });
document.body.append(toastEl);
let toastTimer;
/** @param {string} msg @param {'ok'} [kind] */
// Met action ({ label, run, ms }) staat er een knop naast, bijvoorbeeld "Ongedaan maken".
export function toast(msg, kind, action) {
  toastEl.replaceChildren(el('span', {}, msg));
  if (action) {
    toastEl.append(el('button', { type: 'button', onclick: () => { toastEl.hidden = true; action.run(); } }, action.label));
  }
  toastEl.classList.toggle('ok', kind === 'ok');
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, action?.ms ?? 4000);
}

/** Afvinken of terugzetten; na afvinken een melding met "Ongedaan maken" zolang dat kan. */
export function checkOff(task) {
  const fresh = !task.done && !state.justDone.has(task.id);
  toggleDone(task);
  if (!fresh) return;
  toast(tr('render.checked_off'), 'ok', {
    label: tr('render.undo'), ms: UNDO_MS,
    run: () => { if (state.justDone.has(task.id)) toggleDone(task); },
  });
}

// ---------- tijd ----------
export const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
// toLocaleString met opties maakt per aanroep een nieuwe formatter; met veel taken met een datum is dat merkbaar.
let fmtCache = { locale: '', f: /** @type {Intl.DateTimeFormat | null} */ (null) };
export const fmt = (iso) => {
  if (fmtCache.locale !== dateLocale()) {
    fmtCache = { locale: dateLocale(), f: new Intl.DateTimeFormat(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) };
  }
  return fmtCache.f.format(new Date(iso));
};

// ---------- zoeken ----------
const norm = (s) => s.toLowerCase();

function matches(t, q) {
  return norm(t.title).includes(q) || norm(t.description).includes(q);
}

/** Tekst met elke treffer van de zoekterm in een <mark>, als losse nodes (geen innerHTML). */
function highlight(text) {
  const q = norm(state.query.trim());
  if (!q) return [text];
  const out = [];
  const lower = norm(text);
  let i = 0;
  for (let j = lower.indexOf(q); j !== -1; j = lower.indexOf(q, i)) {
    if (j > i) out.push(text.slice(i, j));
    out.push(el('mark', {}, text.slice(j, j + q.length)));
    i = j + q.length;
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

/** Stukje omschrijving: de eerste regel, of bij zoeken het stuk rond de treffer. */
function snippet(description) {
  const q = norm(state.query.trim());
  const j = q ? norm(description).indexOf(q) : -1;
  if (j === -1) return description.split('\n')[0].slice(0, 60);
  const start = Math.max(0, j - 20);
  const part = description.slice(start, start + 60).replace(/\s+/g, ' ');
  return (start > 0 ? '…' : '') + part + (start + 60 < description.length ? '…' : '');
}

// ---------- weergave ----------

/** "Wordt opgeslagen…" zolang er iets niet bij de server is; offline "offline" of "Nog niet opgeslagen – geen verbinding". */
function renderNet() {
  const waiting = state.pending > 0;
  const text = state.offline ? t(waiting ? 'render.pending_offline' : 'render.offline') : waiting ? t('render.pending') : '';
  const net = $('#net');
  net.textContent = text;
  net.hidden = !text;
  net.classList.toggle('offline', state.offline);
}

// Desktop: de gekozen taak heeft in de lijst een titelveld, zoals in TickTick. Klik je op een titel, dan staat de
// cursor meteen op de plek waar je klikte.
let rebuilding = false; // de lijst wordt opnieuw opgebouwd: de blur van het oude veld is geen "klaar met typen"

function titleField(t) {
  const f = el('textarea', { class: 'title title-edit', rows: '1', 'aria-label': tr('detail.title'), 'aria-current': 'true', maxlength: '500', enterkeyhint: 'done' });
  f.value = titleOf(t);
  bindTitle(f, t.id, { skipBlur: () => rebuilding });
  return f;
}

/** Hoeveel tekens van de titelknop vóór het klikpunt staan (een klik met het toetsenbord: het einde). */
function clickOffset(button, e) {
  const pos = document.caretPositionFromPoint?.(e.clientX, e.clientY);
  const range = pos ? null : document.caretRangeFromPoint?.(e.clientX, e.clientY);
  const node = pos ? pos.offsetNode : range?.startContainer;
  if (!node || !button.contains(node)) return button.textContent.length;
  const before = document.createRange();
  before.setStart(button, 0);
  before.setEnd(node, pos ? pos.offset : range.startOffset);
  return before.toString().length;
}

function openTask(e, id) {
  const at = wide.matches ? clickOffset(e.currentTarget, e) : null;
  selectTask(id);
  const f = at == null ? null : $('#list .title-edit');
  if (!f) return;
  f.focus({ preventScroll: true });
  f.setSelectionRange(at, at);
}

function taskItem(t, children) {
  const selected = state.selected === t.id;
  const done = t.done || state.justDone.has(t.id);
  const li = el('li', { class: 'task' + (done ? ' done' : '') + (selected ? ' sel' : ''), 'data-id': t.id });
  // Op naam van een ander (in een gedeelde lijst): alleen die vinkt hem af.
  const locked = claimedByOther(t);
  const lockedBy = locked ? (t.claimed_by ?? state.open.find((p) => p.id === t.parent_id)?.claimed_by) : null;
  const row = el('div', { class: 'row' },
    done || state.query.trim() ? null : el('span', { class: 'grip', 'aria-hidden': 'true', title: tr('render.drag'), 'aria-label': tr('render.drag') }, '⋮⋮'),
    el('button', {
      class: 'check', role: 'checkbox', 'aria-checked': String(done), disabled: locked,
      'aria-label': lockedBy ? tr('slist.claimed_by', { name: lockedBy.name })
        : tr(state.justDone.has(t.id) ? 'render.undo_named' : t.done ? 'render.reopen_named' : 'render.check_named', { title: t.title }),
      title: lockedBy ? tr('slist.claimed_by', { name: lockedBy.name }) : false,
      onclick: (e) => { if (!done) confetti(e.currentTarget, isCouple(t.share ?? state.open.find((p) => p.id === t.parent_id)?.share)); checkOff(t); },
    }),
    selected && !done && wide.matches ? titleField(t)
      : el('button', { class: 'title', 'aria-current': selected ? 'true' : false, onclick: (e) => openTask(e, t.id) }, ...highlight(t.title)),
    // Waar taken uit meer lijsten samen staan (Alle, Afgerond): de lijst als pilletje in zijn kleur. Subtaken volgen hun hoofdtaak.
    !t.parent_id && (!state.list || state.showDone) ? listPill(t.list) : null,
    // Rechts in de rij; een klik maakt de taak los.
    t.pinned && !t.parent_id && !done
      ? el('button', { class: 'pinned', type: 'button', title: tr('render.pinned'), 'aria-label': tr('render.pinned'), onclick: () => update(t.id, { pinned: false }) }, icon('pin', 'sm'))
      : null,
  );
  li.append(row);

  const meta = [];
  // Gedeelde lijst: wie het meeneemt, vooraan in de metaregel (alleen bij een open hoofdtaak). Wie de taak per taak
  // deelt zonder lid te zijn, heeft hem in een eigen lijst (geen sharedOf) en neemt hem niet mee.
  if (t.shared_list && sharedOf(t.list) && !t.parent_id && !done) meta.push(claimControl(t));
  if (t.remind_at && !done) {
    const past = new Date(t.remind_at) < new Date();
    meta.push(el('span', { class: 'bell' + (past ? ' past' : '') }, icon('bell', 'sm'), fmt(t.remind_at), t.repeat ? icon('repeat', 'sm') : null));
  }
  if (t.location && !t.location_notified && !done) meta.push(el('span', { class: 'loc' }, icon('place', 'sm'), t.location.name));
  // In een gedeelde lijst is elke taak gedeeld met de leden; dat staat al bij de lijst.
  if (t.share && !t.shared_list) {
    const label = shareLabel(t);
    const names = shareNames(t) || label;
    meta.push(el('span', { class: 'shared', title: label, 'aria-label': label }, icon('users', 'sm'), names));
  }
  if (!t.parent_id && t.copies) meta.push(...copyPills(t));
  if (t.attachments?.length) {
    const label = tr('att.count', { n: t.attachments.length });
    meta.push(el('span', { class: 'att', title: label, 'aria-label': label }, icon('clip', 'sm'), String(t.attachments.length)));
  }
  // Zonder markdowntekens; zoeken gebeurt wel in de ruwe tekst.
  const plain = t.description ? plainText(t.description) : '';
  if (plain.trim()) meta.push(el('span', {}, ...highlight(snippet(plain))));
  if (meta.length) li.append(el('div', { class: 'meta' }, ...meta));

  if (children && children.length) {
    const ul = el('ul', { class: 'tasks sub', 'data-parent': t.id });
    children.forEach((c) => ul.append(taskItem(c)));
    li.append(ul);
  }
  if (!done && !state.showDone) enableSwipe(li, t);
  return li;
}

// De lijstnamen voor de kleuren: één keer per render, niet per taak.
let pillNames = null;
function listPill(name) {
  const pill = el('span', { class: 'lpill' }, name);
  const color = listColor(name, pillNames ??= listNames());
  if (color) pill.style.setProperty('--lc', color); // CSSOM: geen style-attribuut (CSP)
  return pill;
}

/** De taken zonder parent in de lijst zelf: een subtaak zonder haar parent staat los. */
function topTasks(tasks) {
  const ids = new Set(tasks.map((t) => t.id));
  return tasks.filter((t) => !t.parent_id || !ids.has(t.parent_id));
}

/** Een <ul> met de taken, subtaken onder hun parent (als die erbij is). */
function taskList(tasks) {
  const byParent = new Map();
  for (const t of tasks) if (t.parent_id) (byParent.get(t.parent_id) ?? byParent.set(t.parent_id, []).get(t.parent_id)).push(t);
  const ul = el('ul', { class: 'tasks', 'data-parent': '' });
  topTasks(tasks).forEach((t) => ul.append(taskItem(t, byParent.get(t.id))));
  return ul;
}

/** Vastgepinde hoofdtaken staan bovenaan, elk deel in zijn eigen volgorde. */
const pinnedOf = (t) => !!t?.pinned && !t.parent_id;

/** Open taken, plus net afgevinkte die tijdens de ongedaan-maken-periode zichtbaar blijven. */
function openTasks() {
  const shown = state.open.filter((t) => (!t.done || state.justDone.has(t.id)) && !swipedAway(t));
  for (const { task } of state.justDone.values()) if (!shown.some((t) => t.id === task.id)) shown.push(task);
  return shown.sort((a, b) => Number(pinnedOf(b)) - Number(pinnedOf(a)) || a.position - b.position);
}

export function render() {
  renderNet();
  renderSidebar();
  renderDetail(); // eerst: kan de keuze wissen als de taak elders verwijderd is
  writeHash();
  const root = $('#list');
  // Typ je in het titelveld van de lijst (opslaan rendert ook), dan blijven focus en cursor staan.
  const a = document.activeElement;
  const typing = a instanceof HTMLTextAreaElement && a.classList.contains('title-edit') && root.contains(a)
    ? { start: a.selectionStart, end: a.selectionEnd, dir: a.selectionDirection } : null;
  rebuilding = true;
  try { renderList(root); } finally { rebuilding = false; pillNames = null; }
  const f = root.querySelector('.title-edit');
  if (!(f instanceof HTMLTextAreaElement)) return;
  autoGrow(f);
  if (!typing) return;
  f.focus({ preventScroll: true });
  f.setSelectionRange(typing.start, typing.end, typing.dir);
}

/**
 * Het adres volgt wat je ziet (zie route.js). Zonder nieuwe stap in de geschiedenis; de stap onthoudt zijn adres, zodat
 * app.js bij terug een eigen stap kan onderscheiden van een bladwijzer.
 */
function writeHash() {
  const on = (c) => document.body.classList.contains(c);
  const page = on('settings-open') ? 'settings' : on('help-open') ? 'help' : on('calendar-open') ? 'calendar' : null;
  const listId = state.list ? lists().find((l) => l.name === state.list)?.id : undefined;
  const hash = toHash({ page, task: state.selected, showDone: state.showDone, showTrash: state.showTrash, list: state.list, listId });
  if (hash === location.hash && history.state?.hash === hash) return;
  history.replaceState({ ...history.state, hash }, '', hash || location.pathname + location.search);
}

function renderList(root) {
  root.replaceChildren();
  if (state.showTrash) { renderTrash(root); return; }
  if (!state.showDone) renderInvites(root);
  // Afgerond toont alle lijsten; de zijbalk markeert dan alleen "Afgerond".
  let visible = state.showDone ? state.done : openTasks().filter((t) => !state.list || t.list === state.list);
  const q = norm(state.query.trim());
  if (q && !state.showDone) {
    // Een subtaak die matcht, neemt haar parent mee.
    const hit = new Set(visible.filter((t) => matches(t, q)).flatMap((t) => (t.parent_id ? [t.id, t.parent_id] : [t.id])));
    visible = visible.filter((t) => hit.has(t.id));
  }
  const ids = new Set(visible.map((t) => t.id));
  // Zoeken buiten Afgerond: daaronder de afgeronde treffers van de server (alleen als ze bij deze zoekterm horen;
  // offline of mislukt: geen). Wat al bij de open taken staat, zoals een net afgevinkte taak, niet nog eens.
  const doneHits = q && !state.showDone && state.doneHits?.q === state.query.trim()
    ? state.doneHits.tasks.filter((t) => t.done && !ids.has(t.id) && !state.justDone.has(t.id) && (!state.list || t.list === state.list))
    : [];
  const tops = topTasks(visible);
  // Een gedeelde lijst: onder de open taken het blok Afgevinkt (niet in Alle, Afgerond, zoeken of de prullenbak).
  const block = state.list && !state.showDone && !q && sharedOf(state.list) ? doneBlock(state.list) : null;
  if (!tops.length && !doneHits.length) {
    const empty = q ? t('render.nothing_found')
      : state.showDone ? (state.offline ? t('render.done_offline') : state.doneLoading ? t('render.loading') : t('render.nothing_done'))
      : t('render.nothing_to_do');
    root.append(el('p', { class: 'empty' }, empty));
    if (block) root.append(block);
    return;
  }
  if (tops.length) root.append(taskList(visible));
  if (doneHits.length) root.append(el('h2', { class: 'list-head' }, t('ui.completed')), taskList(doneHits));
  if (!state.showDone && !q) enableSorting(root); // in een gefilterde lijst zou slepen posities verkeerd berekenen
  if (block) root.append(block); // na enableSorting: het blok sorteert niet mee
}

// ---------- handmatig sorteren ----------
const wide = matchMedia('(min-width: 1024px)');
let dragging = null; // { id, hit, off } tijdens een sleep van een hoofdtaak op desktop

/** De lijst of de prullenbak in de zijbalk onder de cursor, of null: Alle, Afgerond en de huidige lijst van de taak nemen niets aan. */
function dropTarget(e, id) {
  const over = document.elementFromPoint(e.clientX, e.clientY);
  const bin = over?.closest('#btn-trash');
  if (bin) return bin;
  const b = over?.closest('#side-lists button.item[data-list]');
  const name = b?.dataset.list;
  if (!b || !name || name === state.open.find((t) => t.id === id)?.list) return null;
  return b;
}

function startListDrop(id) {
  stopListDrop(); // een eerdere sleepactie zonder dragend mag geen luisteraars achterlaten
  const move = (e) => {
    if (e.clientX == null) return;
    const b = dropTarget(e, id);
    if (b === dragging.hit) return;
    dragging.hit?.classList.remove('drop');
    b?.classList.add('drop');
    dragging.hit = b;
  };
  // Sortable gebruikt native slepen (dragover) of, als terugval, pointer-events.
  const events = ['dragover', 'pointermove'];
  events.forEach((t) => document.addEventListener(t, move));
  dragging = { id, hit: null, off: () => events.forEach((t) => document.removeEventListener(t, move)) };
}

/** Ruimt de markering op en geeft de knop waarop is neergezet (een lijst of de prullenbak), of null. */
function stopListDrop() {
  if (!dragging) return null;
  const { hit, off } = dragging;
  off();
  hit?.classList.remove('drop');
  dragging = null;
  return hit;
}

const findOpen = (id) => state.open.find((t) => t.id === id);

const isTouch = (evt) => evt.pointerType === 'touch' || evt.type === 'touchstart';

// Een vinger die na het slepen loslaat op het vinkje mag de taak niet afvinken.
let dragEnded = 0;
document.addEventListener('click', (e) => {
  if (performance.now() - dragEnded < 350) { e.stopPropagation(); e.preventDefault(); }
}, true);

// Tijdens het slepen met een vinger mag de pagina niet meescrollen (touch-action wordt al bij het aanraken vastgelegd).
document.addEventListener('touchmove', (e) => { if (e.cancelable && document.querySelector('.sortable-chosen')) e.preventDefault(); }, { passive: false });

function enableSorting(root) {
  root.querySelectorAll('ul.tasks').forEach((ul) => {
    const sortable = new Sortable(ul, {
      // Muis: alleen aan het greepje. Aanraking: ook de rij vasthouden en slepen (kort scrollen of vegen blijft gewoon werken).
      filter: (evt) => !isTouch(evt) && !evt.target.closest('.grip') || isTouch(evt) && !!evt.target.closest('input, textarea, button:not(.title, .check), a, select'),
      preventOnFilter: false,
      delay: 250, delayOnTouchOnly: true, touchStartThreshold: 8,
      animation: 150, direction: 'vertical',
      onStart: (evt) => { if (ul.dataset.parent === '' && wide.matches) startListDrop(evt.item.dataset.id); },
      // Slepen blijft binnen het eigen deel: een vastgepinde taak niet tussen de andere, en andersom.
      onMove: (evt) => pinnedOf(findOpen(evt.dragged.dataset.id)) === pinnedOf(findOpen(evt.related.dataset.id)),
      onEnd: (evt) => {
        dragEnded = performance.now();
        const target = stopListDrop();
        if (target) {
          // Neergezet op een lijst of de prullenbak: de taak blijft in Sortable op zijn plek (geen positiewijziging).
          // Tellen zonder de taak zelf: stond hij al hoger, dan schuift children[oldIndex] anders één plek op.
          const rest = [...ul.children].filter((c) => c !== evt.item);
          ul.insertBefore(evt.item, rest[evt.oldIndex] ?? null);
          const task = findOpen(evt.item.dataset.id);
          if (target.id === 'btn-trash') { if (task) deleteWithUndo(task); } // net als vegen: bevestigen bij delen, Ongedaan maken
          else update(evt.item.dataset.id, { list: target.dataset.list });
          return;
        }
        if (evt.oldIndex === evt.newIndex) return; // op dezelfde plek losgelaten: niets te bewaren
        // Alleen de buren in hetzelfde deel (vastgepind of niet) tellen voor de nieuwe positie.
        const pinned = pinnedOf(findOpen(evt.item.dataset.id));
        const items = [...ul.children].filter((li) => pinnedOf(findOpen(li.dataset.id)) === pinned);
        const idx = items.indexOf(evt.item);
        const pos = (li) => findOpen(li.dataset.id)?.position;
        const prev = idx > 0 ? pos(items[idx - 1]) : null;
        const next = idx < items.length - 1 ? pos(items[idx + 1]) : null;
        let p;
        if (prev != null && next != null) p = (prev + next) / 2;
        else if (prev != null) p = prev + 1_000_000;
        else if (next != null) p = next - 1_000_000;
        else return;
        // De server verdeelt de posities opnieuw als ze te dicht bij elkaar komen; de volgende load haalt dat op.
        update(items[idx].dataset.id, { position: p });
      },
    });
    // Aan het greepje meteen slepen (dat scrolt niet, dus de vinger beweegt direct); elders eerst vasthouden.
    // In de capture-fase, zodat dit gebeurt voordat Sortable zelf op de aanraking reageert.
    ul.addEventListener('pointerdown', (e) => sortable.option('delay', e.target.closest('.grip') ? 0 : 250), true);
    ul.addEventListener('touchstart', (e) => sortable.option('delay', e.target.closest('.grip') ? 0 : 250), true);
  });
}
