import CONFIG from './settings.js';
import { request } from './api.js';
import { t } from './i18n.js';
import { el, fmt, toast } from './render.js';
import { icon } from './icons.js';
import { placesOf, wakeAndroidApp } from './places.js';
import { haLinkedNames } from './hatrigger.js';

// Testfeature "condall" (src/condall.ts): bij een taak met voorwaarden van twee of drie soorten (tijd, plek, Home
// Assistant-trigger) kiest de eigenaar "Elke apart" (zoals altijd) of "Pas als alles klopt" (één melding: pas als het
// laatste gebeurt terwijl de rest klopt; de tijd wordt "vanaf"). Hier alleen de stand en de zin wat er gebeurt; de
// bediening (verbindingswoord "of"/"én" tussen de stappen, een venster, en de uitlegzin) staat onderaan. Alleen online (de keuze gaat direct
// naar de server, niet via de outbox), zoals de Home Assistant-stap.

export const condAllOn = () => Array.isArray(CONFIG.testFeatures) && CONFIG.testFeatures.includes('condall');

/**
 * `app`: een telefoon kent tijd + plek (≥ 1.15.7); `appBoth`: ook plek + trigger (≥ 1.15.8).
 * @type {{ tasks: string[], held: Record<string, { name: string, at: string, rep?: string | null }>, app: boolean, appBoth?: boolean }}
 */
let data = { tasks: [], held: {}, app: false, appBoth: false };
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
 * Welke combinatie: 'place' (tijd + plek), 'ha' (tijd + trigger), 'both' (plek + trigger, met of zonder tijd), of null
 * (maar één soort). Zelfde regel als `combo` in src/condall.ts.
 * @param {{ location?: any }} task @param {string | null} remindAt @param {string | null} ha
 * @returns {'place' | 'ha' | 'both' | null}
 */
export function comboOf(task, remindAt, ha) {
  const place = !!task.location;
  if (place && ha) return 'both';
  if (!remindAt || place === !!ha) return null;
  return place ? 'place' : 'ha';
}

/** De onthouden trigger van deze keer van de taak (een vorige keer van een herhalende taak telt niet). @param {any} task */
function heldFor(task) {
  const h = data.held[task.id];
  return h && (h.rep ?? null) === (task.repeat?.at ?? null) ? h : null;
}

/** Wat de stand toont; verandert dit, dan tekent het paneel de tijdlijn opnieuw. @param {any} task */
export const condKey = (task) => (condAllOn() ? JSON.stringify([data.tasks.includes(task.id), heldFor(task), data.app, !!data.appBoth]) : '');

/** "AH Centrum" of "AH Centrum of een van de 2 andere plekken". @param {any} loc */
function placeText(loc) {
  const all = placesOf(loc);
  return all.length > 1 ? t('condall.place_more', { name: all[0].name, n: String(all.length - 1) }) : all[0].name;
}

/**
 * De zin wat Tick gaat doen. `when` is null bij plek + trigger zonder tijd.
 * @param {'place' | 'ha' | 'both'} kind @param {boolean} all @param {string | null} when @param {any} loc @param {string | null} ha
 */
export function summary(kind, all, when, loc, ha) {
  const trigger = ha ?? '';
  if (kind === 'ha') return t(all ? 'condall.sum_all_ha' : 'condall.sum_each_ha', { when: when ?? '', trigger });
  const exit = loc.trigger === 'exit';
  const place = placeText(loc);
  if (kind === 'place') {
    if (all) return t(exit ? 'condall.sum_all_leave' : 'condall.sum_all_arrive', { when: when ?? '', place });
    return t(exit ? 'condall.sum_each_leave' : 'condall.sum_each_arrive', { when: when ?? '', place });
  }
  const key = `condall.sum_${all ? 'all' : 'each'}_both_${exit ? 'leave' : 'arrive'}${when ? '' : '_any'}`;
  return t(key, { when: when ?? '', place, trigger });
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
    // De telefoon moet het meteen weten: de plek pas na de tijd (en de trigger) bewaken, of weer meteen.
    if (task.location) wakeAndroidApp(null);
  } catch (e) {
    toast(/** @type {Error} */ (e).message, 'error');
    done();
  }
}

/**
 * Wat de bediening nodig heeft voor een taak, of null als er niets te kiezen valt (testfeature uit, subtaak, niet je
 * eigen taak, afgerond, of maar één soort voorwaarde).
 * - `blocked`: met een plek beslist de telefoon; zonder Android-app die het kent (1.15.7 voor tijd + plek, 1.15.8 voor
 *   plek + trigger) is "alles" niet te kiezen (`condall.need_app`), wel terug te zetten;
 * - `held`: een trigger die al afging en wacht op de tijd (tijd + trigger) of op de plek (plek + trigger);
 * - `summary`: de zin wat er gebeurt.
 * @param {any} task
 * @param {{ done: boolean, owner: boolean, remindAt: string | null }} o
 */
export function condState(task, { done, owner, remindAt }) {
  if (!condAllOn() || task.parent_id || !owner || done) return null;
  const ha = haLinkedNames(task.id);
  const kind = comboOf(task, remindAt, ha);
  if (!kind) return null;
  const all = isAll(task.id);
  return {
    kind, all,
    blocked: kind === 'place' ? !data.app : kind === 'both' ? !data.appBoth : false,
    held: all && kind !== 'place' ? heldFor(task) : null,
    summary: summary(kind, all, remindAt ? fmt(remindAt) : null, task.location, ha),
  };
}

// ---------- de bediening: verbindingswoord, venster en uitlegzin ----------

/**
 * Het venster na een tik op een verbindingswoord: "Wanneer wil je een melding?" met de twee keuzes, elk met de zin voor
 * deze taak. Klaar slaat op (geldt voor alle verbindingswoorden van de taak), Annuleren/Esc laat alles staan.
 * @param {any} task @param {NonNullable<ReturnType<typeof condState>>} st @param {string | null} remindAt @param {() => void} done
 */
export function chooseMode(task, st, remindAt, done) {
  const when = remindAt ? fmt(remindAt) : null;
  const ha = haLinkedNames(task.id);
  // Bij "alles": de tijd wordt "vanaf"; met plek + trigger hoort de telefoon pas bij de volgende sync van de trigger.
  const notes = [when ? t('condall.from_note') : '', st.kind === 'both' ? t('condall.both_note') : ''].filter(Boolean).join(' ');
  const option = (all, title) => {
    const input = /** @type {HTMLInputElement} */ (el('input', { type: 'radio', name: 'condall-mode', value: all ? 'all' : 'each', checked: all === st.all,
      disabled: all && st.blocked && !st.all }));
    return el('label', { class: 'condall-opt' + (input.disabled ? ' off' : '') }, input,
      el('span', {}, el('b', {}, title), el('span', {}, summary(st.kind, all, when, task.location, ha) + (all && notes ? ' ' + notes : ''))));
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
 * De tijdlijn van het detailpaneel met en/of (marked "condall" in public/detail.js): het verbindingswoord "of" / "én" op
 * de lijn boven elke voorwaarde die op een andere volgt (tijd → plek, tijd → trigger, en bij alle drie tijd → plek →
 * trigger: twee woordjes, altijd hetzelfde woord), de uitlegzin direct onder de voorwaarden, en de stappen die geen
 * voorwaarde zijn (Herhalen, Zet in je agenda, een lege stap) daaronder, zodat de keten niet breekt. Zonder `st` blijft
 * alles zoals het was.
 * @param {HTMLElement[]} props de stappen, in de volgorde van detail.js
 * @param {any} task
 * @param {ReturnType<typeof condState>} st
 * @param {{ remindAt: string | null, onChange: () => void }} o
 * @returns {HTMLElement[]}
 */
export function chain(props, task, st, { remindAt, onChange }) {
  if (!st || !remindAt && st.kind !== 'both') return props;
  const is = (s, kind) => s.classList.contains(`step-${kind}`);
  const on = (s) => s.classList.contains('on');
  const when = remindAt ? props.find((s) => is(s, 'when')) : null;
  const conds = st.kind === 'place' ? props.filter((s) => is(s, 'place'))
    : st.kind === 'ha' ? props.filter((s) => is(s, 'hatrigger'))
      : props.filter((s) => (is(s, 'place') || is(s, 'hatrigger')) && on(s));
  if (remindAt && !when || !conds.length) return props;
  // Zonder tijd (plek + trigger) staat er niets boven de eerste voorwaarde: daar geen woordje.
  const linked = when ? conds : conds.slice(1);
  if (!linked.length) return props;
  const word = t(st.all ? 'condall.and' : 'condall.or');
  for (const s of linked) {
    s.classList.add('condall-step');
    s.prepend(el('button', {
      type: 'button', class: 'condall-conn' + (st.all ? ' and' : ''), 'aria-haspopup': 'dialog',
      'aria-label': t('condall.conn_label', { word }), onclick: () => chooseMode(task, st, remindAt, onChange),
    }, word));
  }
  const held = st.held ? ' ' + t(st.kind === 'both' ? 'condall.held_place' : 'condall.held', { trigger: st.held.name, at: fmt(st.held.at) }) : '';
  const sum = el('div', { class: 'condall-sum' }, icon('bell'), el('span', {}, st.summary, held));
  // Ook een lege stap ("Herinner me bij een plek" naast een trigger, of andersom, of een lege tijd): geen voorwaarde.
  const empty = (s) => !on(s) && (is(s, 'place') || is(s, 'hatrigger') || is(s, 'when'));
  const moved = props.filter((s) => is(s, 'addcal') || is(s, 'repeat') || empty(s));
  const rest = props.filter((s) => !moved.includes(s));
  const last = rest.indexOf(conds[conds.length - 1]);
  return [...rest.slice(0, last + 1), sum, ...moved, ...rest.slice(last + 1)];
}
