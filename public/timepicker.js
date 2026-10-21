import { parseTime } from './calendar.js';
import { t } from './i18n.js';
import { narrow, place } from './popover.js';
import { el } from './render.js';

// Eigen tijdkiezer in plaats van <input type="time">: de klok van Chrome op Android valt met grote letters buiten
// beeld. Eerst een raster met de uren, dan de minuten per vijf; of zelf typen. Twee tabs (uur en minuten) tonen
// steeds wat er gekozen is.

const p2 = (n) => String(n).padStart(2, '0');
const COLS = 6;

/**
 * @param {string} value 'HH:MM'
 * @param {(time: string, final: boolean) => void} onChange final: de minuten zijn gekozen of de tijd is getypt
 */
export function timeGrid(value, onChange) {
  let [h, m] = value.split(':').map(Number);
  let tab = 'h'; // 'h' uren, 'm' minuten, 't' typen

  const hourVal = el('b', {});
  const minVal = el('b', {});
  const hourTab = el('button', { type: 'button', class: 'tp-tab', onclick: () => show('h') }, el('small', {}, t('tp.hour')), hourVal);
  const minTab = el('button', { type: 'button', class: 'tp-tab', onclick: () => show('m') }, el('small', {}, t('tp.minutes')), minVal);
  const typeBtn = el('button', { type: 'button', class: 'tp-type', onclick: () => show(tab === 't' ? 'h' : 't') });
  const body = el('div', { class: 'tp-body' });
  const input = /** @type {HTMLInputElement} */ (el('input', { class: 'tp-input', inputmode: 'numeric', placeholder: t('tp.placeholder'), 'aria-label': t('tp.type'), autocomplete: 'off', enterkeyhint: 'done' }));
  const error = el('p', { class: 'tp-error', role: 'alert', hidden: true }, t('tp.invalid'));
  input.addEventListener('input', () => { error.hidden = true; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  const root = el('div', { class: 'tp' },
    el('div', { class: 'tp-head' }, hourTab, el('span', { class: 'tp-colon', 'aria-hidden': 'true' }, ':'), minTab, typeBtn),
    body);

  const time = () => `${p2(h)}:${p2(m)}`;

  function cell(label, pressed, aria, onclick) {
    return el('button', { type: 'button', 'aria-pressed': String(pressed), 'aria-label': aria, tabindex: pressed ? '0' : '-1', onclick }, label);
  }

  function show(next) {
    tab = next;
    hourVal.textContent = p2(h);
    minVal.textContent = p2(m);
    hourTab.setAttribute('aria-pressed', String(tab === 'h'));
    minTab.setAttribute('aria-pressed', String(tab === 'm'));
    typeBtn.textContent = t(tab === 't' ? 'tp.grid' : 'tp.type');
    if (tab === 't') {
      input.value = time();
      error.hidden = true;
      body.replaceChildren(input, error, el('p', { class: 'tp-note' }, t('tp.enter_note')));
      input.focus();
      input.select();
      return;
    }
    let cells;
    if (tab === 'h') {
      cells = Array.from({ length: 24 }, (_, i) => cell(p2(i), i === h, t('tp.hour_aria', { h: i }), () => { h = i; onChange(time(), false); show('m'); focusPressed(); }));
    } else {
      // Een tijd die niet op vijf minuten valt (07:12) blijft als eigen knop staan, anders verdwijnt hij.
      const mins = [...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), m])].sort((a, b) => a - b);
      cells = mins.map((i) => cell(`${p2(h)}:${p2(i)}`, i === m, undefined, () => { m = i; onChange(time(), true); show('m'); focusPressed(); }));
    }
    body.replaceChildren(el('div', { class: 'tp-grid', role: 'group', 'aria-label': t(tab === 'h' ? 'tp.hour' : 'tp.minutes') }, ...cells));
  }

  function focusPressed() {
    /** @type {HTMLElement | null} */ (body.querySelector('[aria-pressed="true"]'))?.focus();
  }

  // Pijltjes lopen door het raster (een knop of een rij), zoals in de kalender.
  body.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS }[e.key];
    const buttons = [...body.querySelectorAll('.tp-grid button')];
    const i = buttons.indexOf(/** @type {Element} */ (e.target));
    if (!step || i < 0) return;
    e.preventDefault();
    const next = /** @type {HTMLElement | undefined} */ (buttons[Math.max(0, Math.min(buttons.length - 1, i + step))]);
    next?.focus();
  });

  /** Neemt een getypte tijd over. Geeft false (met een melding) als het geen tijd is. */
  function commit() {
    if (tab !== 't') return true;
    const v = parseTime(input.value);
    if (!v) { error.hidden = false; input.focus(); return false; }
    [h, m] = v.split(':').map(Number);
    onChange(v, true);
    show('h');
    return true;
  }

  show('h');
  return {
    root,
    commit,
    focus: focusPressed,
    /** Van buiten (een snelknop): nieuwe tijd, terug naar de uren. */
    set(v) { [h, m] = v.split(':').map(Number); show('h'); },
  };
}

/**
 * Knop die zich als tijdveld gedraagt: `value` is 'HH:MM' en na een keuze komt er een `change`-event, net als bij
 * <input type="time">. Opent de tijdkiezer onder de knop of, op een smal scherm, van onderen.
 * @param {{ value: string, label: string, disabled?: boolean }} opts
 */
export function timeButton({ value, label, disabled = false }) {
  const b = /** @type {HTMLButtonElement} */ (el('button', { type: 'button', class: 'time-btn', 'aria-label': label, disabled }));
  let v = value;
  Object.defineProperty(b, 'value', { get: () => v, set: (x) => { v = x; b.textContent = x; } });
  b.value = value;
  b.addEventListener('click', () => openTimeDialog(b, v, label, (x) => { b.value = x; b.dispatchEvent(new Event('change')); }));
  return b;
}

/** Losse tijdkiezer (bij de instellingen): klaar zodra de minuten gekozen of de tijd getypt is. Esc annuleert. */
function openTimeDialog(anchor, value, label, onPick) {
  const grid = timeGrid(value, (time, final) => { if (final) finish(time); });
  const dialog = /** @type {HTMLDialogElement} */ (el('dialog', { class: 'dpick tpick' + (narrow.matches ? ' sheet' : ''), 'aria-label': label }, grid.root));
  let done = false;
  function finish(result) {
    if (done) return;
    done = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    anchor.focus();
    if (result !== undefined) onPick(result);
  }
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(undefined); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) finish(undefined); });
  dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopPropagation(); });
  document.body.append(dialog);
  dialog.showModal();
  if (!narrow.matches) place(dialog, anchor);
  grid.focus();
}
