import { bindDrop, fillAttachmentsBox } from './attachments.js';
import { confetti, isCouple } from './confetti.js';
import { fillCopiesBox } from './copies.js';
import { ask } from './dialog.js';
import { autoGrow, createEditor } from './editor.js';
import { icon } from './icons.js';
import { t as tr } from './i18n.js'; // tr: t is hier een taak
import { openListPicker } from './listpicker.js';
import { describeRule } from './repeat.js';
import { openRepeatPicker } from './repeatpicker.js';
import { openMap } from './map.js';
import { renderMarkdown } from './markdown.js';
import { formatRadius, wakeAndroidApp } from './places.js';
import { $, checkOff, el, fmt, fromLocalInput, render, toLocalInput } from './render.js';
import { addSubtask, claimedByOther, findDone, remove, sharedOf, snooze, state, toggleDone, update, updateQueued, watchTask } from './store.js';
import { fillShareBox, openShareDialog, shareNames } from './share.js';
import { openWhenMenu, step } from './steps.js';

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

// Ook sharedDone: een taak die een ander in een gedeelde lijst afvinkte (geopend vanuit het blok Afgevinkt).
const findTask = (id) => state.open.find((t) => t.id === id) ?? state.done.find((t) => t.id === id)
  ?? [...state.justDone.values()].find((v) => v.task.id === id)?.task ?? state.sharedDone.find((t) => t.id === id);
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

// ---------- titelveld ----------
// Twee velden voor dezelfde titel: bovenin het paneel, en op desktop in de rij van de gekozen taak (zoals TickTick).
// Ze delen één wachtende waarde en lopen tijdens het typen met elkaar mee.

/** De titel zoals hij getypt is (nog niet opgeslagen), anders die van de taak. */
export const titleOf = (t) => pending.get(t.id)?.title ?? t.title;

/** Zet de titel in de andere velden voor deze taak, behalve het veld waarin je typt. */
function mirrorTitle(id, value, from) {
  const fields = [view?.id === id ? view.title : null, document.querySelector(`#list li.task[data-id="${CSS.escape(id)}"] > .row > .title-edit`)];
  for (const f of fields) {
    if (!f || f === from || f === document.activeElement) continue;
    f.value = value;
    autoGrow(f);
  }
}

/**
 * Maakt van een textarea een titelveld: een lange titel loopt door op de volgende regel, Enter maakt geen nieuwe
 * regel maar is klaar, Esc zet de opgeslagen titel terug. `skipBlur` slaat een blur over (het veld wordt vervangen).
 * @param {HTMLTextAreaElement} ta @param {string} id @param {{ skipBlur?: () => boolean }} [opts]
 */
export function bindTitle(ta, id, { skipBlur } = {}) {
  const restore = () => {
    dropField(id, 'title');
    ta.value = current(id)?.title ?? '';
    autoGrow(ta);
    mirrorTitle(id, ta.value, ta);
  };
  ta.addEventListener('input', () => {
    if (ta.value.includes('\n')) { // geplakt: regelovergangen worden spaties (textarea geeft altijd \n)
      const at = ta.selectionStart;
      ta.value = ta.value.replace(/\n/g, ' ');
      ta.setSelectionRange(at, at);
    }
    autoGrow(ta);
    queue(id, 'title', ta.value);
    mirrorTitle(id, ta.value, ta);
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); ta.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); restore(); ta.blur(); }
  });
  ta.addEventListener('blur', () => {
    if (skipBlur?.()) return;
    if (!ta.value.trim()) restore(); // lege titel: niet opslaan, de oude komt terug
    flushSoon();
  });
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

// Plakken of slepen van bestanden op het paneel: bijlagen voor de open taak (niet bij een afgeronde). Niet met $ uit
// render.js: die module importeert deze, en is hier nog niet klaar.
bindDrop(/** @type {HTMLElement} */ (document.getElementById('detail')), () => (view && !view.readOnly ? view.id : null));

/** Bij elke render(): alleen opnieuw opbouwen bij een andere taak, anders de velden bijwerken. */
export function renderDetail() {
  const root = $('#detail');
  let t = state.selected ? findTask(state.selected) : null;
  if (state.selected && !t) {
    if (snapshot?.id === state.selected) t = snapshot; // blijft staan tot duidelijk is wat er gebeurde
    if (ready && !t?.done) vanished(state.selected);
  }
  document.body.classList.toggle('task-open', !!state.selected);
  // Het skelet van theme.js blijft tot de taak er is, of tot na de eerste load duidelijk is dat hij er niet is.
  if (t || ready || !state.selected) delete document.documentElement.dataset.bootTask;
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
  title.value = titleOf(t);
  bindTitle(title, id);
  // Andere breedte (paneel versleept, scherm gedraaid): andere hoogte.
  let titleWidth = 0;
  const titleSize = new ResizeObserver(() => {
    if (title.offsetWidth === titleWidth) return;
    titleWidth = title.offsetWidth;
    autoGrow(title);
  });
  titleSize.observe(title);

  // Wanneer, ritme, plek, lijst en delen: de tijdlijn van de invoerkaart (steps.js), getekend in fill(). Hier de acties.
  // De reminder: eerst het korte menu, dan pas de datumkiezer; wissen daar is hetzelfde als Wissen ernaast.
  const pickWhen = (anchor) => {
    const task = current(id);
    if (!task) return;
    openWhenMenu(anchor, toLocalInput(remindOf(task)), (value) => {
      if (!value) { dropField(id, 'remind_at'); save(update(id, { remind_at: null })); return; }
      setPending(id, 'remind_at', fromLocalInput(value));
      flushSoon();
      render(); // de stap en Herhalen meteen bijwerken, niet pas na het opslaan
    }, { note: task.repeat ? tr('dp.only_this_time') : undefined }); // het ritme (repeat_at) blijft staan
  };
  // Verzetten en wissen winnen van een gekozen, nog niet opgeslagen tijd (die anders na de klik alsnog zou gaan).
  const snoozeRemind = () => { dropField(id, 'remind_at'); save(snooze(id, 60)); };
  const clearRemind = () => { dropField(id, 'remind_at'); save(update(id, { remind_at: null })); };

  // Ritme: een gekozen, nog niet opgeslagen reminder gaat in dezelfde wijziging mee en wordt de nieuwe start.
  const pickRepeat = (anchor) => {
    const task = current(id);
    if (!task) return;
    const unsaved = hasPending(id, 'remind_at') ? pending.get(id).remind_at : null;
    openRepeatPicker(anchor, task, (rule) => {
      const body = { repeat: rule };
      if (unsaved) { body.remind_at = unsaved; dropField(id, 'remind_at'); }
      save(update(id, body));
    }, unsaved);
  };
  const clearRepeat = () => save(update(id, { repeat: null }));

  // De Android-app pas wekken als de wijziging in de outbox staat: de intent kan de pagina laten navigeren.
  const setLocation = (location, since) => save(updateQueued(id, { location }).then(() => wakeAndroidApp(id, since)));
  const pickPlace = async () => {
    const task = current(id);
    if (!task) return;
    const since = task.updated_at ?? '';
    const location = await openMap(task);
    if (location) setLocation(location, since);
  };
  const clearLoc = () => setLocation(null, current(id)?.updated_at ?? '');
  // Al gemeld: een regel onder de plek, met de status als tekst en alleen "Opnieuw melden" als knop. Een tik zet de
  // plek weer klaar (de Android-app zet de geofence terug via de wake); de regel zegt dat nog even (.flash).
  const rearmLoc = el('button', {
    class: 'linkbtn', type: 'button',
    onclick: () => {
      const since = current(id)?.updated_at ?? '';
      locSub.classList.add('flash');
      clearTimeout(locSub.timer);
      locSub.timer = setTimeout(() => { locSub.classList.remove('flash'); render(); }, 2000);
      save(updateQueued(id, { location_notified: false }).then(() => wakeAndroidApp(id, since)));
    },
  }, tr('detail.rearm_location'));
  const locSubIdle = el('span', {}, tr('detail.already_notified'), ' · ', rearmLoc);
  const rearmDone = el('span', { class: 'loc-done', hidden: true }, tr('detail.rearmed'));
  const locSub = el('div', { class: 'loc-sub', hidden: true }, locSubIdle, rearmDone);

  const pickList = (anchor) => {
    const task = current(id);
    if (task) openListPicker(anchor, task.list, (name) => save(update(id, { list: name })));
  };
  // Gedeelde lijst: per taak een melding bij afvinken, alleen als die voor de hele lijst uit staat (zie drawRail).
  const toggleWatch = () => { const task = current(id); if (task) save(watchTask(id, !task.watch)); };
  const pickShare = () => { const task = current(id); if (task) openShareDialog(task); };

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
    onclick: (e) => {
      flushPending();
      const task = current(id);
      if (task && !task.done && !state.justDone.has(task.id)) confetti(e.currentTarget, isCouple(task.share ?? findTask(task.parent_id)?.share));
      if (task) checkOff(task);
    },
  });

  let subs = null, subList = null;
  if (!t.parent_id) {
    subList = el('ul');
    const subInput = el('input', { placeholder: tr('detail.add_subtask_placeholder'), 'aria-label': tr('detail.add_subtask'), maxlength: '500' });
    subs = el('section', { class: 'subs dsect sect-subs' },
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

  // Vastpinnen: alleen een open hoofdtaak.
  const pin = t.parent_id || readOnly ? null : el('button', {
    class: 'dpin', type: 'button',
    onclick: () => { const task = current(id); if (task) save(update(id, { pinned: !task.pinned })); },
  }, icon('pin'));
  const crumb = t.parent_id ? el('button', { class: 'crumb', type: 'button', onclick: () => selectTask(t.parent_id) }) : null;
  const back = el('button', { class: 'dback', type: 'button', onclick: closeTask });
  const status = el('span', { class: 'dstatus', role: 'status' });
  const reopen = el('button', { class: 'ghost', type: 'button', hidden: !readOnly, onclick: () => { const task = current(id); if (task) toggleDone(task); } }, tr('render.reopen'));
  const del = el('button', {
    class: 'danger', type: 'button',
    onclick: async () => {
      const task = current(id);
      if (!task) return;
      // Een gedeelde taak (of een subtaak ervan) gaat voor iedereen naar de prullenbak.
      const top = task.parent_id ? current(task.parent_id) : task;
      // Alleen als er echt iemand meedoet (de eigenaar met een geaccepteerde deelnemer, of jij als deelnemer).
      const s = top?.share;
      const shared = !!s && (!s.mine || s.members.some((m) => m.status === 'accepted'));
      const answer = await ask({
        title: tr('detail.delete_title'),
        text: tr(shared ? 'detail.confirm_delete_shared' : 'detail.confirm_delete', { title: task.title }),
        buttons: [{ label: tr('detail.delete'), value: 'delete', kind: 'danger' }, { label: tr('dialog.cancel'), value: null, kind: 'ghost' }],
      });
      // Tijdens de vraag kan de taak al weg zijn (verversing of ander apparaat).
      if (answer !== 'delete' || !current(id)) return;
      dropPending(id);
      const pushed = !!history.state?.task;
      remove(id); // zet de keuze op null
      if (pushed) history.back();
    },
  }, tr('detail.delete'));

  const rail = el('div', { class: 'rail' });
  // Onder de stappen Samen met en Kopieën: wie er op zitten (share.js, copies.js).
  const shareBox = el('div', { class: 'step-body dshare', hidden: true });
  const copiesBox = el('div', { class: 'step-body dcopies', hidden: true });
  // Omschrijving, subtaken en bijlagen: secties over de volle breedte, met een gekleurd puntje in de kop.
  const filesBox = el('section', { class: 'dfiles dsect sect-file', hidden: true });
  const noteSect = el('section', { class: 'dsect sect-note' }, el('h3', {}, tr('detail.description')), desc,
    readOnly ? null : el('p', { class: 'md-hint' }, tr('detail.markdown_hint') + ' ',
      el('a', { href: 'https://www.markdownguide.org/cheat-sheet/', target: '_blank', rel: 'noopener' }, tr('detail.markdown_link'))));
  $('#detail').replaceChildren(...[
    back,
    crumb,
    el('div', { class: 'dhead' }, check, title, pin),
    rail,
    noteSect,
    subs,
    filesBox,
    el('div', { class: 'dfoot' }, status, el('div', { class: 'actions' }, reopen, del)),
  ].filter(Boolean));
  view = {
    id, readOnly, rail, railKey: '', lastKind: null, reopen, filesBox, shareBox, copiesBox, noteSect, pin, title, titleSize,
    locSub, locSubIdle, rearmLoc, rearmDone, desc, editor, descValue: undefined, check, subs, subList, crumb, back, status,
    pickWhen, snoozeRemind, clearRemind, pickRepeat, clearRepeat, pickPlace, clearLoc, pickList, toggleWatch, pickShare,
  };
}

function fill(t) {
  const v = view;
  const done = v.readOnly;
  v.back.textContent = '‹ ' + listTitle();
  if (v.crumb) v.crumb.textContent = '‹ ' + (current(t.parent_id)?.title ?? tr('detail.parent_task'));
  v.check.setAttribute('aria-checked', String(done));
  // Op naam van een ander (gedeelde lijst): alleen die vinkt hem af of heropent hem.
  const lockedBy = claimedByOther(t) ? (t.claimed_by ?? current(t.parent_id)?.claimed_by) : null;
  v.check.disabled = !!lockedBy;
  v.reopen.disabled = !!lockedBy;
  v.check.setAttribute('aria-label', lockedBy ? tr('slist.claimed_by', { name: lockedBy.name })
    : tr(state.justDone.has(t.id) ? 'render.undo_named' : done ? 'render.reopen_named' : 'render.check_named', { title: t.title }));
  v.check.title = lockedBy ? tr('slist.claimed_by', { name: lockedBy.name }) : '';
  if (v.pin) {
    v.pin.setAttribute('aria-pressed', String(!!t.pinned));
    v.pin.title = tr(t.pinned ? 'detail.unpin' : 'detail.pin');
    v.pin.setAttribute('aria-label', v.pin.title);
  }

  // Het veld waarin je typt (focus of nog niet opgeslagen) blijft staan; de rest volgt de server.
  if (document.activeElement !== v.title && !hasPending(t.id, 'title') && v.title.value !== t.title) v.title.value = t.title;
  autoGrow(v.title);
  fillShareBox(v.shareBox, t, done);
  fillCopiesBox(v.copiesBox, t);
  drawRail(t);
  // Al gemeld: de plek doet niets meer tot hij opnieuw gekozen wordt of "Opnieuw melden" eronder getikt.
  const flash = v.locSub.classList.contains('flash');
  v.locSub.hidden = done || !t.location || !(t.location_notified || flash);
  v.locSubIdle.hidden = flash;
  v.rearmDone.hidden = !flash;
  v.rearmLoc.hidden = v.readOnly;

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
    const key = JSON.stringify([done, t.claimed_by?.id ?? null, kids.map((k) => [k.id, k.title, !!k.done, state.justDone.has(k.id)])]);
    if (v.subKey !== key) {
      v.subKey = key;
      v.subList.replaceChildren(...kids.map((k) => {
        const kDone = !!(k.done || state.justDone.has(k.id));
        return el('li', { class: kDone ? 'done' : '' },
          el('button', {
            class: 'check', role: 'checkbox', 'aria-checked': String(kDone), disabled: done || claimedByOther(k),
            'aria-label': tr(state.justDone.has(k.id) ? 'render.undo_named' : kDone ? 'render.reopen_named' : 'render.check_named', { title: k.title }),
            onclick: (e) => { if (!kDone) confetti(e.currentTarget, isCouple(t.share)); checkOff(current(k.id) ?? k); }, // de rij kan ouder zijn dan de taak na een verversing
          }),
          el('button', { class: 'subtitle', type: 'button', onclick: () => selectTask(k.id) }, k.title));
      }));
    }
    v.subs.hidden = done && !kids.length; // afgerond zonder subtaken: geen leeg kopje
    v.subs.classList.toggle('on', kids.length > 0);
  }
  v.noteSect.hidden = done && !text.trim(); // afgerond zonder omschrijving: geen leeg kopje
  // Het puntje in de kop krijgt pas kleur als er iets in staat, net als de stippen van de tijdlijn.
  v.noteSect.classList.toggle('on', !!text.trim());
  v.filesBox.classList.toggle('on', !!t.attachments?.length);
  fillAttachmentsBox(v.filesBox, t, done);
  showStatus();
}

/**
 * De tijdlijn: herinnering, ritme, plek, lijst, en delen of de melding bij afvinken in een gedeelde lijst. Alleen
 * opnieuw opbouwen als er iets veranderde: een stap die onder je vinger vervangen wordt, slikt op een touchscherm de tik.
 */
function drawRail(t) {
  const v = view;
  const done = v.readOnly;
  const remindAt = remindOf(t);
  const past = !!remindAt && new Date(remindAt) < new Date();
  const loc = t.location;
  const list = t.shared_list ? sharedOf(t.list) : null; // geen lid: geen sharedOf
  const watchable = !done && !t.parent_id && !!list && !list.notify_done;
  const names = shareNames(t);
  const owner = !t.share || t.share.mine;
  // In een gedeelde lijst staan de leden bij de lijst; de eigenaar kan wel een kopie geven aan iemand anders.
  const shareShown = !t.parent_id && (list ? list.mine && !done : !!t.share || !done);
  const key = JSON.stringify([done, remindAt, past, t.repeat, loc, t.list, t.parent_id, watchable, !!t.watch, shareShown, names, owner, !!t.copies && !t.parent_id]);
  if (v.railKey === key) return;
  v.railKey = key;
  // Na een keuze is de knop waarmee de kiezer openging vervangen: de focus gaat terug naar dezelfde stap.
  const active = /** @type {HTMLElement | null} */ (document.activeElement);
  const refocus = v.rail.contains(active) ? active?.closest('.step')?.className.match(/step-(\w+)/)?.[1]
    : !active || active === document.body ? v.lastKind : null;
  v.lastKind = null;
  const opener = (kind, fn) => (done ? null : (anchor) => { v.lastKind = kind; fn(anchor); });
  const clear = (run, title) => ({ label: tr('detail.clear'), title, run });
  v.rail.replaceChildren(...[
    // Afgerond: alleen wat er was, geen lege zinnen.
    done && !remindAt ? null : step({
      kind: 'when', icon: 'bell', on: !!remindAt, past, lead: tr(remindAt ? 'add.when_set' : 'add.when'), value: remindAt ? fmt(remindAt) : null,
      open: opener('when', v.pickWhen),
      actions: done || !remindAt ? [] : [{ label: tr('push.snooze'), run: v.snoozeRemind }, clear(v.clearRemind, tr('detail.remove_reminder'))],
    }),
    // Een subtaak herhaalt niet; afgerond alleen als er een ritme was.
    t.parent_id || done && !t.repeat ? null : step({
      kind: 'repeat', icon: 'repeat', on: !!t.repeat, lead: t.repeat ? '' : tr('add.repeat'), value: t.repeat ? describeRule(t.repeat.rule, t.repeat.start) : null,
      open: opener('repeat', v.pickRepeat), actions: done || !t.repeat ? [] : [clear(v.clearRepeat)],
    }),
    done && !loc ? null : step({
      kind: 'place', icon: 'place', on: !!loc, lead: loc ? tr(loc.trigger === 'exit' ? 'add.leave' : 'add.arrive') : tr('add.place'),
      value: loc?.name ?? null, note: loc ? formatRadius(loc.radius) : null, sub: v.locSub,
      open: opener('place', v.pickPlace), actions: done || !loc ? [] : [clear(v.clearLoc, tr('detail.remove_location'))],
    }),
    // Een subtaak volgt de lijst van de hoofdtaak: gewone tekst, geen knop.
    step({ kind: 'list', icon: 'folder', on: false, lead: tr('add.in'), value: t.list, note: t.parent_id ? tr('detail.follows_parent') : null, open: t.parent_id ? null : opener('list', v.pickList) }),
    watchable ? step({ kind: 'watch', icon: 'eye', on: !!t.watch, lead: tr('slist.watch'), open: opener('watch', v.toggleWatch), pressed: !!t.watch }) : null,
    shareShown ? step({
      kind: 'share', icon: 'users', on: names.length > 0, lead: tr(names.length ? 'add.share_set' : list ? 'share.with_someone' : 'add.share'),
      value: names.join(', ') || null, open: owner ? opener('share', v.pickShare) : null, body: v.shareBox,
    }) : null,
    t.copies && !t.parent_id ? step({ kind: 'copies', icon: 'users', on: true, lead: tr('copy.heading'), body: v.copiesBox }) : null,
  ].filter(Boolean));
  if (refocus) /** @type {HTMLElement | null} */ (v.rail.querySelector(`.step-${refocus} button.step-head`))?.focus({ preventScroll: true });
}
