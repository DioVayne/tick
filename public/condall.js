import CONFIG from './settings.js';
import { request } from './api.js';
import { t } from './i18n.js';
import { el, fmt, toast } from './render.js';
import { icon } from './icons.js';
import { placesOf, wakeAndroidApp } from './places.js';
import { haLinkedNames } from './hatrigger.js';

// Testfeature "condall" (src/condall.ts): bij een taak met een tijd én een plek, of een tijd én een Home
// Assistant-trigger, kiest de eigenaar "Elke apart" (zoals altijd) of "Pas als alles klopt" (één melding: pas als het
// laatste gebeurt terwijl de rest klopt; de tijd wordt "vanaf"). Hier alleen de stand en de zin wat er gebeurt; de
// bediening (verbindingswoord "of"/"én" tussen de stappen, een venster, en de uitlegzin) staat onderaan. Alleen online (de keuze gaat direct
// naar de server, niet via de outbox), zoals de Home Assistant-stap.

export const condAllOn = () => Array.isArray(CONFIG.testFeatures) && CONFIG.testFeatures.includes('condall');

/** @type {{ tasks: string[], held: Record<string, { name: string, at: string }>, app: boolean }} */
let data = { tasks: [], held: {}, app: false };
let loading = null;
/** @type {Set<() => void>} */
const waiting = new Set();

/**
 * Haalt de keuzes op (bij het openen van een taak); `done` loopt als er iets nieuws is.
 * @param {() => void} done
 */
export function refreshCond(done) {
  if (!condAllOn()) return;
  waiting.add(done);
  if (loading) return;
  loading = request('GET', '/api/condall')
    .then((next) => {
      const changed = JSON.stringify(next) !== JSON.stringify(data);
      data = next;
      if (changed) for (const fn of waiting) fn();
    })
    .catch(() => {}) // offline: alles blijft zoals het was
    .finally(() => { loading = null; waiting.clear(); });
}

/**
 * Welke soort met de tijd samengaat: 'place' of 'ha', of null (geen tijd, maar één soort, of plek én trigger samen:
 * dat kan Tick niet, want Tick weet niet waar je bent). Zelfde regel als `combo` in src/condall.ts.
 * @param {{ location?: any }} task @param {string | null} remindAt @param {string | null} ha
 * @returns {'place' | 'ha' | null}
 */
export function comboOf(task, remindAt, ha) {
  const place = !!task.location;
  if (!remindAt || place === !!ha) return null;
  return place ? 'place' : 'ha';
}

/** Wat de stand toont; verandert dit, dan tekent het paneel de tijdlijn opnieuw. @param {{ id: string }} task */
export const condKey = (task) => (condAllOn() ? JSON.stringify([data.tasks.includes(task.id), data.held[task.id] ?? null, data.app]) : '');

/** "AH Centrum" of "AH Centrum of een van de 2 andere plekken". @param {any} loc */
function placeText(loc) {
  const all = placesOf(loc);
  return all.length > 1 ? t('condall.place_more', { name: all[0].name, n: String(all.length - 1) }) : all[0].name;
}

/**
 * De zin wat Tick gaat doen.
 * @param {'place' | 'ha'} kind @param {boolean} all @param {string} when @param {any} loc @param {string | null} ha
 */
export function summary(kind, all, when, loc, ha) {
  if (kind === 'place') {
    const exit = loc.trigger === 'exit';
    const place = placeText(loc);
    if (all) return t(exit ? 'condall.sum_all_leave' : 'condall.sum_all_arrive', { when, place });
    return t(exit ? 'condall.sum_each_leave' : 'condall.sum_each_arrive', { when, place });
  }
  return t(all ? 'condall.sum_all_ha' : 'condall.sum_each_ha', { when, trigger: ha ?? '' });
}

/** Staat deze taak op "Pas als alles klopt"? @param {string} taskId */
export const isAll = (taskId) => data.tasks.includes(taskId);

/**
 * De keuze opslaan (`all` true = "Pas als alles klopt", false = "Elke apart"); `done` loopt daarna, ook bij een fout
 * (dan met een melding), zodat de bediening de juiste stand weer toont.
 * @param {any} task @param {boolean} all @param {() => void} done
 */
export async function setAll(task, all, done) {
  try {
    await request('PUT', `/api/condall/tasks/${encodeURIComponent(task.id)}`, { all });
    data.tasks = data.tasks.filter((id) => id !== task.id);
    if (all) data.tasks.push(task.id);
    delete data.held[task.id];
    done();
    // De telefoon moet het meteen weten: de plek pas na de tijd bewaken (of weer meteen).
    if (task.location) wakeAndroidApp(null);
  } catch (e) {
    toast(/** @type {Error} */ (e).message, 'error');
    done();
  }
}

/**
 * Wat de bediening nodig heeft voor een taak, of null als er niets te kiezen valt (testfeature uit, subtaak, niet je
 * eigen taak, afgerond, of geen combinatie die samen kan).
 * - `blocked`: met een plek beslist de telefoon; zonder Android-app die het kent is "alles" niet te kiezen
 *   (`condall.need_app`), wel terug te zetten;
 * - `held`: een trigger die vóór de tijd afging en op de tijd meldt (`condall.held`);
 * - `summary`: de zin wat er gebeurt.
 * @param {any} task
 * @param {{ done: boolean, owner: boolean, remindAt: string | null }} o
 */
export function condState(task, { done, owner, remindAt }) {
  if (!condAllOn() || task.parent_id || !owner || done) return null;
  const ha = haLinkedNames(task.id);
  // Tijd + plek + trigger: niets te kiezen (altijd "elk apart"), wel een grijs "of" met uitleg waarom (explainMixed).
  if (remindAt && task.location && ha) return { kind: /** @type {'mixed'} */ ('mixed'), all: false, blocked: true, held: null, summary: '' };
  const kind = comboOf(task, remindAt, ha);
  if (!kind) return null;
  const all = isAll(task.id);
  return {
    kind, all,
    blocked: kind === 'place' && !data.app,
    held: all && kind === 'ha' ? data.held[task.id] ?? null : null,
    summary: summary(kind, all, fmt(/** @type {string} */ (remindAt)), task.location, ha),
  };
}

// ---------- de bediening: verbindingswoord, venster en uitlegzin ----------

/**
 * Het venster na een tik op een verbindingswoord: "Wanneer wil je een melding?" met de twee keuzes, elk met de zin voor
 * deze taak. Klaar slaat op (geldt voor alle verbindingswoorden van de taak), Annuleren/Esc laat alles staan.
 * @param {any} task @param {NonNullable<ReturnType<typeof condState>>} st @param {string} remindAt @param {() => void} done
 */
export function chooseMode(task, st, remindAt, done) {
  const when = fmt(remindAt);
  const ha = haLinkedNames(task.id);
  const kind = /** @type {'place' | 'ha'} */ (st.kind);
  const option = (all, title) => {
    const input = /** @type {HTMLInputElement} */ (el('input', { type: 'radio', name: 'condall-mode', value: all ? 'all' : 'each', checked: all === st.all,
      disabled: all && st.blocked && !st.all }));
    return el('label', { class: 'condall-opt' + (input.disabled ? ' off' : '') }, input,
      el('span', {}, el('b', {}, title), el('span', {}, summary(kind, all, when, task.location, ha) + (all ? ' ' + t('condall.from_note') : ''))));
  };
  let settled = false;
  // Na het venster terug naar het verbindingswoord (na opslaan is dat een nieuw knopje: de tijdlijn is opnieuw getekend).
  const back = () => /** @type {HTMLElement | null} */ (document.querySelector('#detail .condall-conn'))?.focus({ preventScroll: true });
  const finish = (all) => {
    if (settled) return;
    settled = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    if (all !== null && all !== st.all) setAll(task, all, () => { done(); back(); });
    else back();
  };
  const each = option(false, t('condall.each_title'));
  const all = option(true, t('condall.all_title'));
  const dialog = /** @type {HTMLDialogElement} */ (el('dialog', { class: 'dialog condall-dialog', 'aria-labelledby': 'condall-title' },
    el('h2', { id: 'condall-title' }, t('condall.dialog_title')),
    el('p', {}, t('condall.dialog_text')),
    el('div', { role: 'radiogroup', 'aria-labelledby': 'condall-title' }, each, all),
    st.blocked ? el('p', { class: 'condall-need' }, t('condall.need_app')) : null,
    el('div', { class: 'dialog-buttons' },
      el('button', { type: 'button', class: 'ghost', onclick: () => finish(null) }, t('condall.cancel')),
      el('button', { type: 'button', onclick: () => finish(/** @type {HTMLInputElement | null} */ (dialog.querySelector('input:checked'))?.value === 'all') }, t('condall.done')))));
  dialog.addEventListener('click', (e) => { if (e.target === dialog) finish(null); });
  dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopPropagation(); });
  dialog.addEventListener('close', () => finish(null));
  document.body.append(dialog);
  dialog.showModal();
  /** @type {HTMLElement | null} */ (dialog.querySelector('input:checked'))?.focus();
}

/**
 * Het venster na een tik op het grijze "of" (tijd + plek + trigger): alleen de uitleg waarom "Alles tegelijk" niet kan, en
 * Oké. Geen keuzes: een uitgeschakelde keuze zou suggereren dat er iets te regelen valt.
 */
function explainMixed() {
  const back = () => /** @type {HTMLElement | null} */ (document.querySelector('#detail .condall-conn'))?.focus({ preventScroll: true });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    back();
  };
  const dialog = /** @type {HTMLDialogElement} */ (el('dialog', { class: 'dialog condall-dialog', 'aria-labelledby': 'condall-title' },
    el('h2', { id: 'condall-title' }, t('condall.dialog_title')),
    el('p', {}, t('condall.mixed_text')),
    el('div', { class: 'dialog-buttons' }, el('button', { type: 'button', onclick: close }, t('condall.ok')))));
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopPropagation(); });
  dialog.addEventListener('close', close); // Esc
  document.body.append(dialog);
  dialog.showModal();
  /** @type {HTMLElement | null} */ (dialog.querySelector('button'))?.focus();
}

/**
 * De tijdlijn van het detailpaneel met en/of (marked "condall" in public/detail.js): het verbindingswoord "of" / "én" op
 * de lijn boven elke voorwaarde van een andere soort dan de tijd, de uitlegzin direct onder de voorwaarden, en de
 * stappen die geen voorwaarde zijn (Herhalen, Zet in je agenda, een lege stap van de andere soort) daaronder, zodat de keten niet breekt. Zonder `st` blijft
 * alles zoals het was.
 * @param {HTMLElement[]} props de stappen, in de volgorde van detail.js
 * @param {any} task
 * @param {ReturnType<typeof condState>} st
 * @param {{ remindAt: string | null, onChange: () => void }} o
 * @returns {HTMLElement[]}
 */
export function chain(props, task, st, { remindAt, onChange }) {
  if (!st || !remindAt) return props;
  const is = (s, kind) => s.classList.contains(`step-${kind}`);
  if (st.kind === 'mixed') {
    // Tijd + plek + trigger: één grijs "of" tussen de tijd en de eerste voorwaarde; Agenda en Herhalen eronder.
    const conds = props.filter((s) => (is(s, 'place') || is(s, 'hatrigger')) && s.classList.contains('on'));
    if (!props.some((s) => is(s, 'when')) || !conds.length) return props;
    conds[0].classList.add('condall-step');
    conds[0].prepend(el('button', {
      type: 'button', class: 'condall-conn off', 'aria-haspopup': 'dialog', 'aria-label': t('condall.conn_mixed_label'), onclick: explainMixed,
    }, t('condall.or')));
    const moved = props.filter((s) => is(s, 'addcal') || is(s, 'repeat'));
    const rest = props.filter((s) => !moved.includes(s));
    const last = rest.indexOf(conds[conds.length - 1]);
    return [...rest.slice(0, last + 1), ...moved, ...rest.slice(last + 1)];
  }
  const condKind = st.kind === 'place' ? 'place' : 'hatrigger';
  const when = props.find((s) => is(s, 'when'));
  const conds = props.filter((s) => is(s, condKind));
  if (!when || !conds.length) return props;
  const word = t(st.all ? 'condall.and' : 'condall.or');
  for (const s of conds) {
    s.classList.add('condall-step');
    s.prepend(el('button', {
      type: 'button', class: 'condall-conn' + (st.all ? ' and' : ''), 'aria-haspopup': 'dialog',
      'aria-label': t('condall.conn_label', { word }), onclick: () => chooseMode(task, st, remindAt, onChange),
    }, word));
  }
  const sum = el('div', { class: 'condall-sum' }, icon('bell'), el('span', {}, st.summary,
    st.held ? ' ' + t('condall.held', { trigger: st.held.name, at: fmt(st.held.at) }) : ''));
  // Ook de lege stap van de andere soort ("Herinner me bij een plek" naast een trigger, of andersom): geen voorwaarde.
  const other = st.kind === 'place' ? 'hatrigger' : 'place';
  const moved = props.filter((s) => is(s, 'addcal') || is(s, 'repeat') || is(s, other) && !s.classList.contains('on'));
  const rest = props.filter((s) => !moved.includes(s));
  const last = rest.indexOf(conds[conds.length - 1]);
  return [...rest.slice(0, last + 1), sum, ...moved, ...rest.slice(last + 1)];
}
