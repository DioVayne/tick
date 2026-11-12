// Testfeature "Tijd voor een taak?" (freetime): het scherm met zes willekeurige taken (route #/freetime, een pagina in
// de middenkolom zoals de kalender: een taak opent erover, terug brengt je weer hier) en het blok in Instellingen.
// Alleen als de Tick hem aanheeft (CONFIG.testFeatures); anders doet alles hier niets. Rekenregels: freetime.js.
import CONFIG from './settings.js';
import { request } from './api.js';
import { selectTask } from './detail.js';
import { BATCH, MINUTES, candidates, shuffle } from './freetime.js';
import { t } from './i18n.js';
import { $, el, render, toast } from './render.js';
import { closeDrawer } from './sidebar.js';
import { state } from './store.js';

/** Staat de testfeature aan op deze Tick? */
export const freeTimeOn = () => Array.isArray(CONFIG.testFeatures) && CONFIG.testFeatures.includes('freetime');

/** order: alle kandidaten in geschudde volgorde (ids); pos: waar de huidige zes beginnen. */
const S = { open: false, root: /** @type {HTMLElement | null} */ (null), order: /** @type {string[]} */ ([]), pos: 0 };

export const isFreeTimeOpen = () => S.open;

let showPage = () => {};
/** Haak voor Bekijk het scherm in Instellingen: app.js sluit de andere pagina's en opent deze (zo importeert dit bestand app.js niet). */
export const onFreeTimeShow = (fn) => { showPage = fn; };

const pool = () => candidates(state.open, Date.now());

/** Houdt de volgorde bij: weg wat geen kandidaat meer is, nieuwe kandidaten achteraan. */
function sync() {
  const ids = new Set(pool().map((x) => x.id));
  S.order = S.order.filter((id) => ids.has(id));
  const known = new Set(S.order);
  S.order.push(...shuffle([...ids].filter((id) => !known.has(id))));
  if (S.pos >= S.order.length) S.pos = 0;
}

function more() {
  S.pos += BATCH;
  if (S.pos >= S.order.length) { S.order = shuffle(S.order); S.pos = 0; } // alles gezien: opnieuw schudden
  paint();
  $('#main').scrollTop = 0;
  window.scrollTo(0, 0);
}

function paint() {
  if (!S.root) return;
  const byId = new Map(state.open.map((x) => [x.id, x]));
  const shown = S.order.slice(S.pos, S.pos + BATCH).map((id) => byId.get(id)).filter(Boolean);
  const listName = (task) => task.list || 'Inbox';
  S.root.replaceChildren(
    el('p', { class: 'ftt-intro' }, shown.length ? t('ftt.intro') : t('ftt.empty')),
    el('ul', { class: 'ftt-list' }, ...shown.map((task) => el('li', {},
      el('button', { type: 'button', class: 'ftt-task', onclick: () => selectTask(task.id) },
        el('span', { class: 'ftt-name' }, task.title || '…'), el('small', { class: 'ftt-where' }, listName(task)))))),
    el('div', { class: 'ftt-actions' },
      S.order.length > BATCH ? el('button', { type: 'button', class: 'ftt-more', onclick: more }, t('ftt.more')) : null,
      el('button', { type: 'button', class: 'ftt-close', onclick: () => closeFreeTime() }, t('ftt.close'))));
}

/** Tekent opnieuw als de taken veranderen (een afgevinkte taak verdwijnt; de rest blijft staan). */
export function refreshFreeTime() {
  if (!S.open) return;
  sync();
  paint();
}

export function openFreeTime({ push = true } = {}) {
  if (!freeTimeOn()) return;
  closeDrawer();
  if (S.open) return;
  S.open = true;
  if (push) history.pushState({ freetime: true }, '');
  S.order = [];
  S.pos = 0;
  sync();
  S.root = el('section', { id: 'freetime', 'aria-label': t('ftt.title') });
  $('#main').append(S.root);
  document.body.classList.add('freetime-open');
  render();
  paint();
  $('#main').scrollTop = 0;
  window.scrollTo(0, 0);
}

/** Verbergt de pagina zonder de geschiedenis te raken (voor popstate). */
export function hideFreeTime() {
  if (!S.open) return;
  S.open = false;
  S.root?.remove();
  S.root = null;
  document.body.classList.remove('freetime-open');
  render();
}

export function closeFreeTime() {
  if (!S.open) return;
  if (history.state?.freetime) history.back(); // popstate verbergt de pagina
  else hideFreeTime();
}

// Esc buiten een veld sluit de pagina (niet als er een dialoog, het menu of een taak open is).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !S.open || state.selected) return;
  if (document.querySelector('dialog[open]') || document.body.classList.contains('drawer-open')) return;
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
  e.stopPropagation();
  closeFreeTime();
}, true);

// ---------- Instellingen ----------

const note = (text) => el('small', { class: 'set-note' }, text);
const row = (label, control, sub) => el('div', { class: 'set-row' },
  el('div', { class: 'set-label' }, label || null, sub ? note(sub) : null),
  control ? el('div', { class: 'set-control' }, control) : null);

/**
 * Vult het blok "Tijd voor een taak?" in Instellingen (settingsview.js maakt het blok, alleen met de testfeature aan).
 * Leest en bewaart via /api/freetime; offline een regel dat het alleen online kan.
 * @param {HTMLElement} host
 */
export async function paintFreeTimeSettings(host) {
  let s;
  try {
    s = await request('GET', '/api/freetime');
  } catch {
    host.replaceChildren(note(t('set.online_only')));
    return;
  }
  const draw = () => {
    const sw = /** @type {HTMLInputElement} */ (el('input', {
      type: 'checkbox', role: 'switch', class: 'set-switch', 'aria-label': t('ftt.title'), disabled: !s.on && !s.calendar,
    }));
    sw.checked = s.on;
    sw.addEventListener('change', () => save({ on: sw.checked }));
    const minutes = /** @type {HTMLSelectElement} */ (el('select', { class: 'set-select', 'aria-label': t('ftt.minutes_label'),
      onchange: () => save({ minutes: Number(minutes.value) }) },
    ...MINUTES.map((n) => el('option', { value: String(n), selected: n === s.minutes }, t('ftt.minutes', { n })))));
    const time = (key, label) => {
      const input = /** @type {HTMLInputElement} */ (el('input', { type: 'time', class: 'set-select ftt-time', 'aria-label': label, value: s[key] }));
      input.addEventListener('change', () => { if (input.value) save({ [key]: input.value }); });
      return input;
    };
    const btn = (label, onclick) => el('button', { type: 'button', class: 'set-btn ghost', onclick }, label);
    host.replaceChildren(
      row(t('ftt.title'), sw, s.calendar ? t('ftt.note') : `${t('ftt.note')} ${t('ftt.no_calendar')}`),
      row(t('ftt.minutes_label'), minutes),
      row(t('ftt.window'), el('span', { class: 'ftt-window' }, time('from', t('ftt.window_from')), '–', time('to', t('ftt.window_to')))),
      row('', [
        btn(t('ftt.test'), async () => {
          try {
            const r = await request('POST', '/api/freetime/test', {});
            toast(r.ok ? t('ftt.test_sent') : t('push.enabled_test_missing'), r.ok ? 'ok' : undefined);
          } catch (e) { toast(e.message); }
        }),
        btn(t('ftt.preview'), () => showPage()),
      ]));
  };
  const save = async (change) => {
    try {
      s = await request('PATCH', '/api/freetime', change);
      toast(t('set.saved'), 'ok');
    } catch (e) {
      toast(t('set.save_failed', { reason: e.message }));
    }
    draw();
  };
  draw();
}
