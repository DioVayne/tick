import { autoGrow, createEditor } from './editor.js';
import { t as tr } from './i18n.js'; // tr: t is hier een taak
import { openListPicker } from './listpicker.js';
import { describeRule } from './repeat.js';
import { openRepeatPicker } from './repeatpicker.js';
import { openMap } from './map.js';
import { renderMarkdown } from './markdown.js';
import { locationLabel, wakeAndroidApp } from './places.js';
import { $, el, fmt, fromLocalInput, render, toLocalInput } from './render.js';
import { addSubtask, findDone, remove, snooze, state, toggleDone, update, updateQueued } from './store.js';

// Detailpaneel (desktop) en taakscherm (mobiel): één opbouw per gekozen taak, daarna alleen bijwerken.
// Zo overschrijft een verversing nooit het veld waarin je typt.

const SAVE_MS = 800;
const mobile = matchMedia('(max-width: 1023.98px)');

// Getypte titel en omschrijving per taak (id → { title?, description?, remind_at? }). Los van de DOM: wisselen van taak
// of het paneel opnieuw opbouwen raakt deze tekst niet kwijt, en hij gaat altijd naar de taak waarvoor hij getypt is.
// De reminder heeft geen timer: 'change' vuurt per segment (dag, uur, minuut) en elke PATCH zet notified terug, dus een
// tussenwaarde in het verleden kon een losse push geven. Hij gaat pas weg bij blur, taakwissel, sluiten, verbergen of
// opnieuw opbouwen van het paneel. Alleen blur is niet genoeg: het veld kan verdwijnen zonder blur.
/** @type {Map<string, { title?: string, description?: string, remind_at?: string | null }>} */
const pending = new Map();
/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const timers = new Map(); // `${id}\n${veld}` → timer
let saving = 0;
let saved = false;

/** @type {any} */
let view = null; // het opgebouwde paneel: { id, readOnly, ...elementen, editor }
/** @type {any} */
let snapshot = null; // de laatst getoonde taak: een afgevinkte taak blijft open, ook als hij uit de lijsten verdwijnt
let ready = false; // vóór de eerste load kan een taak (uit ?task=) nog ontbreken in de lokale kopie

/** Na de eerste load: pas dan betekent "niet gevonden" echt "elders verwijderd". */
export function detailReady() {
  ready = true;
  render();
}

const findTask = (id) => state.open.find((t) => t.id === id) ?? state.done.find((t) => t.id === id)
  ?? [...state.justDone.values()].find((v) => v.task.id === id)?.task;
const current = (id) => findTask(id) ?? (snapshot?.id === id ? snapshot : null);
const hasPending = (id, field) => !!pending.get(id) && field in pending.get(id);
const remindPending = () => [...pending.values()].some((p) => 'remind_at' in p);
/** De reminder zoals hij in het veld staat: de gekozen (nog niet opgeslagen) waarde, anders die van de taak. */
const remindOf = (t) => (hasPending(t.id, 'remind_at') ? pending.get(t.id).remind_at : t.remind_at);

// ---------- opslaan ----------

function setPending(id, field, value) {
  const p = pending.get(id) ?? {};
  p[field] = value;
  pending.set(id, p);
}

function queue(id, field, value) {
  setPending(id, field, value);
  const key = id + '\n' + field;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => flushField(id, field), SAVE_MS));
  showStatus();
}

/** Vergeet één wachtend veld, bijvoorbeeld een gekozen reminder die meteen daarna verzet of gewist wordt. */
function dropField(id, field) {
  const p = pending.get(id);
  if (!p || !(field in p)) return;
  delete p[field];
  if (!Object.keys(p).length) pending.delete(id);
  clearTimeout(timers.get(id + '\n' + field));
  timers.delete(id + '\n' + field);
  showStatus();
}

function dropPending(id) {
  for (const field of ['title', 'description']) {
    clearTimeout(timers.get(id + '\n' + field));
    timers.delete(id + '\n' + field);
  }
  pending.delete(id);
  showStatus();
}

function flushField(id, field) {
  const key = id + '\n' + field;
  clearTimeout(timers.get(key));
  timers.delete(key);
  const p = pending.get(id);
  if (!p || !(field in p)) return;
  let value = p[field];
  delete p[field];
  if (!Object.keys(p).length) pending.delete(id);
  const t = current(id);
  if (field === 'title') value = value.trim();
  // Elders verwijderd, een lege titel, of niets veranderd (de editor meldt ook ongewijzigde tekst): geen PATCH.
  if (!t || !value && field === 'title' || value === t[field]) { showStatus(); return; }
  save(update(id, { [field]: value }));
}

/** Slaat een wachtende titel, omschrijving of reminder meteen op, voor de taak waarvoor hij bedoeld is. */
export function flushPending() {
  for (const [id, p] of [...pending]) for (const field of Object.keys(p)) flushField(id, field);
}

function save(promise) {
  saving++;
  saved = true;
  showStatus();
  Promise.resolve(promise).finally(() => { saving--; showStatus(); });
}

function showStatus() {
  if (!view) return;
  view.status.textContent = saving || timers.size || remindPending() ? tr('detail.saving')
    : !saved ? ''
    : state.offline ? tr('detail.saved_offline') : tr('detail.saved');
}

// Opslaan rendert de lijst opnieuw. Gebeurt dat bij een blur door een klik, dan verdwijnt de knop onder de muis
// en gaat de klik (bijvoorbeeld op een andere taak) verloren. Dus bij een klik: eerst de klik, dan opslaan.
let pointerDown = false;
let flushAfterPointer = false;
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
for (const type of ['pointerup', 'pointercancel']) {
  document.addEventListener(type, () => {
    pointerDown = false;
    if (!flushAfterPointer) return;
    flushAfterPointer = false;
    // Na de klik; op een touchscherm komt de klik soms pas een tik later, vandaar ook de reservetimer.
    document.addEventListener('click', () => setTimeout(flushPending, 0), { once: true, capture: true });
    setTimeout(flushPending, 300);
  }, true);
}
function flushSoon() {
  if (pointerDown) flushAfterPointer = true;
  else flushPending();
}

// ---------- kiezen en sluiten ----------

/** Kiest een taak (of null). Wachtende tekst gaat eerst naar de vorige taak. */
export function selectTask(id, { push = true } = {}) {
  flushPending();
  if (id === state.selected) return;
  state.selected = id;
  // Mobiel: een eigen stap in de geschiedenis, zodat de terugknop van Android teruggaat naar de lijst.
  if (push && id && mobile.matches) {
    if (history.state?.task) history.replaceState({ task: id }, '');
    else history.pushState({ task: id }, '');
  }
  render();
}

/** Paneel dicht, of op mobiel terug naar de lijst. */
export function closeTask() {
  flushPending();
  if (history.state?.task) history.back(); // popstate zet de keuze op null
  else selectTask(null);
}

const listTitle = () => (state.showDone ? tr('ui.completed') : state.list ?? tr('ui.all'));

// ---------- weergave ----------

// De gekozen taak staat niet meer in de lijsten: elders afgevinkt (dan alleen-lezen tonen) of verwijderd (dan sluiten).
let checking = null;
function vanished(id) {
  if (checking === id) return;
  checking = id;
  findDone(id).then((found) => {
    if (checking === id) checking = null;
    if (state.selected !== id || findTask(id)) { render(); return; } // iets anders gekozen, of hij is terug
    if (!found) {
      state.selected = null;
      if (history.state?.task) history.back();
    }
    render();
  });
}

/** Bij elke render(): alleen opnieuw opbouwen bij een andere taak, anders de velden bijwerken. */
export function renderDetail() {
  const root = $('#detail');
  let t = state.selected ? findTask(state.selected) : null;
  if (state.selected && !t) {
    if (snapshot?.id === state.selected) t = snapshot; // blijft staan tot duidelijk is wat er gebeurde
    if (ready && !t?.done) vanished(state.selected);
  }
  document.body.classList.toggle('task-open', !!state.selected);
  if (!t) {
    if (view || !root.querySelector('.detail-empty')) {
      view?.editor?.destroy();
      view?.titleSize.disconnect();
      view = null;
      root.replaceChildren(el('p', { class: 'detail-empty' }, state.selected ? '' : tr('ui.pick_task')));
    }
    return;
  }
  snapshot = t;
  const readOnly = !!(t.done || state.justDone.has(t.id));
  if (!view || view.id !== t.id || view.readOnly !== readOnly) build(t, readOnly);
  fill(t);
}

function build(t, readOnly) {
  const id = t.id;
  if (view?.id !== id && !saving && !timers.size) saved = false;
  view?.editor?.destroy();
  view?.titleSize.disconnect();
  // Een gekozen reminder gaat mee, ook als het veld verdwijnt zonder blur. Niet nu: opslaan rendert, en we zitten in render.
  if (remindPending()) setTimeout(() => { for (const pid of [...pending.keys()]) flushField(pid, 'remind_at'); }, 0);

  // Een textarea zodat een lange titel doorloopt op de volgende regel; Enter maakt geen nieuwe regel.
  const title = el('textarea', { class: 'dt', rows: '1', 'aria-label': tr('detail.title'), maxlength: '500', enterkeyhint: 'done', disabled: readOnly });
  title.value = pending.get(id)?.title ?? t.title;
  title.addEventListener('input', () => {
    if (title.value.includes('\n')) { // geplakt: regelovergangen worden spaties (textarea geeft altijd \n)
      const at = title.selectionStart;
      title.value = title.value.replace(/\n/g, ' ');
      title.setSelectionRange(at, at);
    }
    autoGrow(title);
    queue(id, 'title', title.value);
  });
  // Andere breedte (paneel versleept, scherm gedraaid): andere hoogte.
  let titleWidth = 0;
  const titleSize = new ResizeObserver(() => {
    if (title.offsetWidth === titleWidth) return;
    titleWidth = title.offsetWidth;
    autoGrow(title);
  });
  titleSize.observe(title);
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  title.addEventListener('blur', () => {
    if (!title.value.trim()) { // lege titel: niet opslaan, de oude komt terug
      if (hasPending(id, 'title')) { delete pending.get(id).title; clearTimeout(timers.get(id + '\n' + 'title')); timers.delete(id + '\n' + 'title'); }
      title.value = current(id)?.title ?? '';
      showStatus();
    }
    flushSoon();
  });

  const remind = el('input', { type: 'datetime-local', 'aria-label': tr('ui.reminder'), disabled: readOnly });
  remind.addEventListener('change', () => {
    setPending(id, 'remind_at', fromLocalInput(remind.value));
    showStatus();
  });
  remind.addEventListener('blur', flushSoon);
  const remindPill = el('label', { class: 'pill remind', title: tr('ui.reminder') }, el('span', { 'aria-hidden': 'true' }, '🔔'), remind);
  // Verzetten en wissen winnen van een gekozen, nog niet opgeslagen tijd (die anders na de klik alsnog zou gaan).
  const plusHour = el('button', { class: 'pill mini', type: 'button', onclick: () => { dropField(id, 'remind_at'); save(snooze(id, 60)); } }, tr('push.snooze'));
  const clearRemind = el('button', {
    class: 'pill mini', type: 'button', title: tr('detail.remove_reminder'),
    onclick: () => { dropField(id, 'remind_at'); save(update(id, { remind_at: null })); },
  }, tr('detail.clear'));

  // Ritme: een gekozen, nog niet opgeslagen reminder gaat in dezelfde wijziging mee en wordt de nieuwe start.
  const repeatLabel = el('span', { class: 'lbl' });
  const repeatPill = el('button', {
    class: 'pill repeat', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', hidden: readOnly || !!t.parent_id,
    onclick: () => {
      const task = current(id);
      if (!task) return;
      const unsaved = hasPending(id, 'remind_at') ? pending.get(id).remind_at : null;
      openRepeatPicker(repeatPill, task, (rule) => {
        const body = { repeat: rule };
        if (unsaved) { body.remind_at = unsaved; dropField(id, 'remind_at'); }
        save(update(id, body));
      }, unsaved);
    },
  }, repeatLabel);

  // De Android-app pas wekken als de wijziging in de outbox staat: de intent kan de pagina laten navigeren.
  const setLocation = (location, since) => save(updateQueued(id, { location }).then(() => wakeAndroidApp(id, since)));
  const locLabel = el('span', { class: 'lbl' });
  const locPill = el('button', {
    class: 'pill loc', type: 'button', disabled: readOnly,
    onclick: async () => {
      const task = current(id);
      if (!task) return;
      const since = task.updated_at ?? '';
      const location = await openMap(task);
      if (location) setLocation(location, since);
    },
  }, locLabel);
  const clearLoc = el('button', {
    class: 'pill mini', type: 'button', title: tr('detail.remove_location'),
    onclick: () => setLocation(null, current(id)?.updated_at ?? ''),
  }, tr('detail.clear'));

  const listLabel = el('span', { class: 'lbl' });
  const listPill = el('button', {
    class: 'pill list', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    disabled: readOnly || !!t.parent_id, title: t.parent_id ? tr('detail.follows_parent') : false,
    onclick: () => {
      const task = current(id);
      if (task) openListPicker(listPill, task.list, (name) => save(update(id, { list: name })));
    },
  }, listLabel);

  const desc = el('div', { class: 'desc' });
  let editor = null;
  if (!readOnly) {
    editor = createEditor(desc, {
      value: pending.get(id)?.description ?? t.description,
      placeholder: tr('detail.add_description'),
      onChange: (text) => queue(id, 'description', text),
      onCommit: (text) => { setPending(id, 'description', text); flushSoon(); },
    });
  }

  const check = el('button', {
    class: 'check', role: 'checkbox',
    onclick: () => {
      flushPending();
      const task = current(id);
      if (task) toggleDone(task);
    },
  });

  let subs = null, subList = null;
  if (!t.parent_id) {
    subList = el('ul');
    const subInput = el('input', { placeholder: tr('detail.add_subtask_placeholder'), 'aria-label': tr('detail.add_subtask'), maxlength: '500' });
    subs = el('div', { class: 'subs' },
      el('h3', {}, tr('detail.subtasks')),
      subList,
      readOnly ? null : el('form', {
        autocomplete: 'off',
        onsubmit: (e) => {
          e.preventDefault();
          const value = subInput.value.trim();
          const task = current(id);
          if (!value || !task) return;
          subInput.value = '';
          save(addSubtask(task, value));
        },
      }, subInput));
  }

  const crumb = t.parent_id ? el('button', { class: 'crumb', type: 'button', onclick: () => selectTask(t.parent_id) }) : null;
  const back = el('button', { class: 'dback', type: 'button', onclick: closeTask });
  const status = el('span', { class: 'dstatus', role: 'status' });
  const reopen = el('button', { class: 'ghost', type: 'button', hidden: !readOnly, onclick: () => { const task = current(id); if (task) toggleDone(task); } }, tr('render.reopen'));
  const del = el('button', {
    class: 'danger', type: 'button',
    onclick: () => {
      const task = current(id);
      if (!task) return;
      // Een gedeelde taak (of een subtaak ervan) gaat voor iedereen naar de prullenbak.
      const top = task.parent_id ? current(task.parent_id) : task;
      if (!confirm(tr(top?.share ? 'detail.confirm_delete_shared' : 'detail.confirm_delete', { title: task.title }))) return;
      dropPending(id);
      const pushed = !!history.state?.task;
      remove(id); // zet de keuze op null
      if (pushed) history.back();
    },
  }, tr('detail.delete'));

  $('#detail').replaceChildren(...[
    back,
    crumb,
    el('div', { class: 'dhead' }, check, title),
    el('div', { class: 'pills' }, remindPill, plusHour, clearRemind, repeatPill, locPill, clearLoc, listPill),
    desc,
    subs,
    el('div', { class: 'dfoot' }, status, el('div', { class: 'actions' }, reopen, del)),
  ].filter(Boolean));
  view = { id, readOnly, title, titleSize, remind, remindPill, plusHour, clearRemind, repeatPill, repeatLabel, locLabel, clearLoc, listLabel, desc, editor, descValue: undefined, check, subs, subList, crumb, back, status };
}

function fill(t) {
  const v = view;
  const done = v.readOnly;
  v.back.textContent = '‹ ' + listTitle();
  if (v.crumb) v.crumb.textContent = '‹ ' + (current(t.parent_id)?.title ?? tr('detail.parent_task'));
  v.check.setAttribute('aria-checked', String(done));
  v.check.setAttribute('aria-label', state.justDone.has(t.id) ? tr('render.undo') : done ? tr('render.reopen') : tr('render.check'));

  // Het veld waarin je typt (focus of nog niet opgeslagen) blijft staan; de rest volgt de server.
  if (document.activeElement !== v.title && !hasPending(t.id, 'title') && v.title.value !== t.title) v.title.value = t.title;
  autoGrow(v.title);
  const remindAt = remindOf(t);
  if (document.activeElement !== v.remind) v.remind.value = toLocalInput(remindAt);
  const past = remindAt && new Date(remindAt) < new Date();
  v.remindPill.classList.toggle('b', !!remindAt && !past);
  v.remindPill.classList.toggle('past', !!past);
  v.remindPill.title = remindAt ? tr('detail.reminder_at', { when: fmt(remindAt) }) : tr('ui.reminder');
  v.plusHour.hidden = done || !remindAt;
  v.clearRemind.hidden = done || !remindAt;
  const rep = t.repeat;
  v.repeatLabel.textContent = '🔁 ' + (rep ? describeRule(rep.rule, rep.start) : tr('rep.none'));
  // Al gemeld: de plek doet niets meer tot hij opnieuw gekozen wordt.
  v.locLabel.textContent = t.location ? locationLabel(t.location) + (t.location_notified ? tr('detail.already_notified') : '') : tr('detail.no_location');
  v.clearLoc.hidden = done || !t.location;
  v.listLabel.textContent = '📁 ' + t.list + ' ▾';

  const text = t.description ?? '';
  if (v.descValue !== text) {
    if (v.editor) {
      if (!v.editor.isEditing() && !hasPending(t.id, 'description')) { v.editor.setValue(text); v.descValue = text; }
    } else {
      // Alleen-lezen: de opgemaakte tekst, met uitgeschakelde vinkjes.
      const md = el('div', { class: 'md' + (text.trim() ? '' : ' empty') });
      if (text.trim()) md.append(renderMarkdown(text));
      md.querySelectorAll('input').forEach((i) => { i.disabled = true; });
      v.desc.replaceChildren(md);
      v.descValue = text;
    }
  }

  if (v.subList) {
    const kids = [...state.open, ...state.done]
      .filter((x, i, all) => x.parent_id === t.id && all.findIndex((y) => y.id === x.id) === i)
      .filter((x) => done || !x.done || state.justDone.has(x.id))
      .sort((a, b) => a.position - b.position);
    // Alleen opnieuw opbouwen als er echt iets veranderde: een rij die onder je vinger vervangen wordt, slikt op
    // een touchscherm de eerste tik (bijvoorbeeld als een veld net zijn focus verliest en opslaan rendert).
    const key = JSON.stringify([done, kids.map((k) => [k.id, k.title, !!k.done, state.justDone.has(k.id)])]);
    if (v.subKey !== key) {
      v.subKey = key;
      v.subList.replaceChildren(...kids.map((k) => {
        const kDone = !!(k.done || state.justDone.has(k.id));
        return el('li', { class: kDone ? 'done' : '' },
          el('button', {
            class: 'check', role: 'checkbox', 'aria-checked': String(kDone), disabled: done,
            'aria-label': state.justDone.has(k.id) ? tr('render.undo') : kDone ? tr('render.reopen') : tr('render.check'),
            onclick: () => toggleDone(current(k.id) ?? k), // de rij kan ouder zijn dan de taak na een verversing
          }),
          el('button', { class: 'subtitle', type: 'button', onclick: () => selectTask(k.id) }, k.title));
      }));
    }
    v.subs.hidden = done && !kids.length; // afgerond zonder subtaken: geen leeg kopje
  }
  showStatus();
}
