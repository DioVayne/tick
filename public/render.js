import { confetti, isCouple } from './confetti.js';
import { bindTitle, renderDetail, selectTask, titleOf } from './detail.js';
import { autoGrow } from './editor.js';
import { dateLocale, t, t as tr } from './i18n.js'; // tr waar t al een taak is
import { plainText } from './markdown.js';
import { renderSidebar } from './sidebar.js';
import { state, toggleDone, update } from './store.js';
import { renderTrash, shareLabel, shareNames } from './trash.js';
import { renderInvites } from './share.js';

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
export function toast(msg, kind) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('ok', kind === 'ok');
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4000);
}

// ---------- tijd ----------
export const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
/** Een leeg tijdveld toont in de kiezer vandaag als gekozen; vul daarom bij openen het volgende hele uur in. */
export function prefillOnOpen(input, onPrefill) {
  input.addEventListener('pointerdown', () => {
    if (input.value || input.disabled) return;
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    input.value = toLocalInput(d.toISOString());
    onPrefill?.();
  });
}
export const fmt = (iso) =>
  new Date(iso).toLocaleString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

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

/** "offline · 3 wijzigingen wachten" zolang er iets niet bij de server is. */
function renderNet() {
  const n = state.pending;
  const waiting = n ? t(n === 1 ? 'render.pending_one' : 'render.pending_many', { n }) : '';
  const text = [state.offline ? t('render.offline') : '', waiting].filter(Boolean).join(' · ');
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
  const row = el('div', { class: 'row' },
    done || state.query.trim() ? null : el('span', { class: 'grip', 'aria-hidden': 'true' }, '⋮⋮'),
    el('button', {
      class: 'check', role: 'checkbox', 'aria-checked': String(done),
      'aria-label': state.justDone.has(t.id) ? tr('render.undo') : t.done ? tr('render.reopen') : tr('render.check'),
      onclick: (e) => { if (!done) confetti(e.currentTarget, isCouple(t.share ?? state.open.find((p) => p.id === t.parent_id)?.share)); toggleDone(t); },
    }),
    selected && !done && wide.matches ? titleField(t)
      : el('button', { class: 'title', 'aria-current': selected ? 'true' : false, onclick: (e) => openTask(e, t.id) }, ...highlight(t.title)),
  );
  li.append(row);

  const meta = [];
  if (t.remind_at && !done) {
    const past = new Date(t.remind_at) < new Date();
    meta.push(el('span', { class: 'bell' + (past ? ' past' : '') }, '🔔 ' + fmt(t.remind_at) + (t.repeat ? ' 🔁' : '')));
  }
  if (t.location && !t.location_notified && !done) meta.push(el('span', { class: 'loc' }, '📍 ' + t.location.name));
  if (t.share) {
    const label = shareLabel(t);
    const names = shareNames(t) || label;
    meta.push(el('span', { class: 'shared', title: label, 'aria-label': label }, '👥 ' + names));
  }
  if (!state.list && t.list !== 'Inbox') meta.push(el('span', {}, t.list));
  // Zonder markdowntekens; zoeken gebeurt wel in de ruwe tekst.
  const plain = t.description ? plainText(t.description) : '';
  if (plain.trim()) meta.push(el('span', {}, ...highlight(snippet(plain))));
  if (meta.length) li.append(el('div', { class: 'meta' }, ...meta));

  if (children && children.length) {
    const ul = el('ul', { class: 'tasks sub', 'data-parent': t.id });
    children.forEach((c) => ul.append(taskItem(c)));
    li.append(ul);
  }
  return li;
}

/** Open taken, plus net afgevinkte die tijdens de ongedaan-maken-periode zichtbaar blijven. */
function openTasks() {
  const shown = state.open.filter((t) => !t.done || state.justDone.has(t.id));
  for (const { task } of state.justDone.values()) if (!shown.some((t) => t.id === task.id)) shown.push(task);
  return shown.sort((a, b) => a.position - b.position);
}

export function render() {
  renderNet();
  renderSidebar();
  renderDetail(); // eerst: kan de keuze wissen als de taak elders verwijderd is
  const root = $('#list');
  // Typ je in het titelveld van de lijst (opslaan rendert ook), dan blijven focus en cursor staan.
  const a = document.activeElement;
  const typing = a instanceof HTMLTextAreaElement && a.classList.contains('title-edit') && root.contains(a)
    ? { start: a.selectionStart, end: a.selectionEnd, dir: a.selectionDirection } : null;
  rebuilding = true;
  try { renderList(root); } finally { rebuilding = false; }
  const f = root.querySelector('.title-edit');
  if (!(f instanceof HTMLTextAreaElement)) return;
  autoGrow(f);
  if (!typing) return;
  f.focus({ preventScroll: true });
  f.setSelectionRange(typing.start, typing.end, typing.dir);
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
  const byParent = new Map();
  for (const t of visible) if (t.parent_id) (byParent.get(t.parent_id) ?? byParent.set(t.parent_id, []).get(t.parent_id)).push(t);
  const ids = new Set(visible.map((t) => t.id));
  const tops = visible.filter((t) => !t.parent_id || !ids.has(t.parent_id));
  if (!tops.length) {
    const empty = q ? t('render.nothing_found')
      : state.showDone ? (state.offline ? t('render.done_offline') : t('render.nothing_done'))
      : t('render.nothing_to_do');
    root.append(el('p', { class: 'empty' }, empty));
    return;
  }
  const ul = el('ul', { class: 'tasks', 'data-parent': '' });
  tops.forEach((t) => ul.append(taskItem(t, byParent.get(t.id))));
  root.append(ul);
  if (!state.showDone && !q) enableSorting(root); // in een gefilterde lijst zou slepen posities verkeerd berekenen
}

// ---------- handmatig sorteren ----------
const wide = matchMedia('(min-width: 1024px)');
let dragging = null; // { id, hit, off } tijdens een sleep van een hoofdtaak op desktop

/** De lijst in de zijbalk onder de cursor, of null: Alle, Afgerond en de huidige lijst van de taak nemen niets aan. */
function dropTarget(e, id) {
  const b = document.elementFromPoint(e.clientX, e.clientY)?.closest('#side-lists button.item[data-list]');
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

/** Ruimt de markering op en geeft de naam van de lijst waarop is neergezet (of null). */
function stopListDrop() {
  if (!dragging) return null;
  const { hit, off } = dragging;
  off();
  hit?.classList.remove('drop');
  dragging = null;
  return hit?.dataset.list ?? null;
}

function enableSorting(root) {
  root.querySelectorAll('ul.tasks').forEach((ul) => {
    new Sortable(ul, {
      handle: '.grip', animation: 150, delay: 0, direction: 'vertical',
      onStart: (evt) => { if (ul.dataset.parent === '' && wide.matches) startListDrop(evt.item.dataset.id); },
      onEnd: (evt) => {
        const target = stopListDrop();
        if (target) {
          // Neergezet op een lijst: de taak gaat erheen en blijft in Sortable op zijn plek (geen positiewijziging).
          // Tellen zonder de taak zelf: stond hij al hoger, dan schuift children[oldIndex] anders één plek op.
          const rest = [...ul.children].filter((c) => c !== evt.item);
          ul.insertBefore(evt.item, rest[evt.oldIndex] ?? null);
          update(evt.item.dataset.id, { list: target });
          return;
        }
        const items = [...ul.children];
        const idx = evt.newIndex;
        const pos = (li) => state.open.find((t) => t.id === li.dataset.id)?.position;
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
  });
}
