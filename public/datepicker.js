import { monthGrid, pickerDefault, quickDays } from './calendar.js';
import { dateLocale, t } from './i18n.js';
import { backCloses, narrow, place } from './popover.js';
import { el } from './render.js';
import { chipDays, getDefaultTime, zonedParts } from './repeat.js';
import { timeGrid } from './timepicker.js';

// Eigen datum- en tijdkiezer: snelknoppen (vandaag, morgen, volgende week), een maand met de weekdagen erboven
// (in de volgorde van "week begint op"), het tijdveld en drie vaste tijden. Het tijdveld opent de tijdkiezer op de
// plek van de maand, zodat de knoppen onderaan in beeld blijven.
// Op een smal scherm schuift hij van onderen in beeld, op een breed scherm staat hij onder de knop.
// Werkt met de wandklok 'YYYY-MM-DDTHH:MM' in de ingestelde tijdzone (zie toLocalInput/fromLocalInput in render.js);
// daarom rekent ook "nu" hier in die zone, niet met de klok van het apparaat. null is wissen.
// Kalenderdagen zijn hier kale datums: als UTC-middernacht, getoond met timeZone 'UTC', zodat de zone van het apparaat
// (en een zomertijdwissel daarin) niet meetelt.

const TIMES = ['09:00', '13:00', '19:00'];
const p2 = (n) => String(n).padStart(2, '0');
/** Kalenderdag als UTC-middernacht. `m` is 1-12; d mag buiten de maand lopen. */
const dayDate = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const dayKey = (d) => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
const fromKey = (key) => { const [y, m, d] = key.split('-').map(Number); return dayDate(y, m, d); };

/**
 * @param {HTMLElement} anchor de knop die de kiezer opent (focus gaat daar weer heen)
 * @param {string} value 'YYYY-MM-DDTHH:MM', of '' voor geen datum
 * @param {(value: string | null) => void} onPick met de gekozen waarde, of null bij Wissen; niet bij annuleren
 * @param {{ note?: string, quick?: boolean }} [opts] note: een korte uitleg bovenaan (bij een herhalende taak: alleen deze keer);
 *   quick: false laat Vandaag/Morgen/Volgende week weg (de invoerkaart heeft die al in zijn eigen menu)
 */
export function openDatePicker(anchor, value, onPick, opts = {}) {
  const now = zonedParts(Date.now()); // wandklok in de ingestelde zone
  const nowTime = `${p2(now.h)}:${p2(now.mi)}`;
  const today = dayKey(dayDate(now.y, now.m, now.d));
  const start = pickerDefault(now, getDefaultTime());
  const weekStart = chipDays()[0] === 6 ? 'sun' : 'mon';
  const quick = quickDays(now, weekStart);
  let day = value ? value.slice(0, 10) : start.day;
  let time = value ? value.slice(11, 16) : start.time;
  let month = fromKey(day);
  month = dayDate(month.getUTCFullYear(), month.getUTCMonth() + 1, 1);

  const locale = dateLocale();
  const fmtMonth = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const fmtWeekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  const fmtDay = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const fmtSum = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

  const title = el('span', { class: 'dp-month', 'aria-live': 'polite' });
  const grid = el('div', { class: 'dp-grid' });
  const timeValue = el('b', {});
  const timeField = el('button', { type: 'button', class: 'dp-field', 'aria-expanded': 'false', onclick: () => showTime(calArea.hidden ? false : true) },
    el('span', { class: 'dp-field-ico', 'aria-hidden': 'true' }, '🕒'),
    el('span', { class: 'dp-field-main' }, el('small', {}, t('dp.time')), timeValue),
    el('span', { class: 'dp-field-act' }, t('dp.change'), ' ›'));
  const timeButtons = TIMES.map((tm) => el('button', {
    type: 'button', onclick: () => { time = tm; tgrid.set(tm); drawTimes(); },
  }, tm));
  const times = el('div', { class: 'dp-times', role: 'group', 'aria-label': t('dp.quick_times') }, el('span', { class: 'dp-times-label' }, t('dp.quick')), ...timeButtons);
  const tgrid = timeGrid(time, (tm) => { time = tm; drawTimes(); });
  const quickButtons = /** @type {const} */ ([['today', 'dp.today'], ['tomorrow', 'dp.tomorrow'], ['nextWeek', 'dp.next_week']])
    .map(([k, label]) => el('button', { type: 'button', 'data-day': quick[k], onclick: () => pickQuick(quick[k]) }, t(label)));
  const summary = el('span', { class: 'dp-sum' });
  const shift = (months) => { month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + months, 1)); drawDays(); };

  // In de volgorde van de weekstart; 1 januari 2024 was een maandag (wd 0).
  const weekdays = el('div', { class: 'dp-wd', 'aria-hidden': 'true' },
    ...chipDays(weekStart).map((wd) => el('span', {}, fmtWeekday.format(dayDate(2024, 1, 1 + wd)))));

  const calArea = el('div', { class: 'dp-cal' },
    el('div', { class: 'dp-head' },
      el('button', { class: 'dp-nav', type: 'button', 'aria-label': t('dp.prev'), onclick: () => shift(-1) }, '‹'),
      title,
      el('button', { class: 'dp-nav', type: 'button', 'aria-label': t('dp.next'), onclick: () => shift(1) }, '›')),
    weekdays,
    grid);
  const timeArea = el('div', { class: 'dp-timearea', hidden: true },
    tgrid.root,
    el('button', { type: 'button', class: 'dp-back', onclick: () => showTime(false) }, '‹ ', t('dp.back_calendar')));

  const dialog = /** @type {HTMLDialogElement} */ (el('dialog', { class: 'dpick' + (narrow.matches ? ' sheet' : ''), 'aria-label': t('dp.title') },
    opts.note ? el('p', { class: 'dp-note' }, opts.note) : null,
    opts.quick === false ? null : el('div', { class: 'dp-quick' }, ...quickButtons),
    calArea,
    timeArea,
    timeField,
    times,
    el('div', { class: 'dp-foot' },
      summary,
      el('div', { class: 'dp-actions' },
        value ? el('button', { class: 'dp-clear', type: 'button', onclick: () => finish(null) }, t('dp.clear')) : null,
        el('button', { class: 'ghost', type: 'button', onclick: () => finish(undefined) }, t('dialog.cancel')),
        el('button', { type: 'button', onclick: () => { if (tgrid.commit()) finish(`${day}T${time}`); } }, t('dp.done'))))));

  function drawDays() {
    title.textContent = fmtMonth.format(month);
    const cells = monthGrid(month.getUTCFullYear(), month.getUTCMonth() + 1, weekStart).flat();
    grid.replaceChildren(...cells.map(({ key, d, inMonth }) => {
      const cls = ['dp-day'];
      if (!inMonth) cls.push('out');
      if (key < today) cls.push('past');
      if (key === today) cls.push('today');
      return el('button', {
        class: cls.join(' '), type: 'button', 'data-day': key, 'aria-label': fmtDay.format(fromKey(key)), 'aria-pressed': String(key === day),
        tabindex: key === day ? '0' : '-1',
        onclick: () => pick(key),
      }, String(d));
    }));
    for (const b of quickButtons) b.setAttribute('aria-pressed', String(b.dataset.day === day));
    drawSummary();
  }

  function drawTimes() {
    timeValue.textContent = time;
    timeButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(TIMES[i] === time)));
    drawSummary();
  }

  /** Tijdkiezer of maand: ze staan op dezelfde plek. */
  function showTime(open) {
    calArea.hidden = open;
    timeArea.hidden = !open;
    timeField.setAttribute('aria-expanded', String(open));
    if (open) { tgrid.set(time); tgrid.focus(); } else /** @type {HTMLElement | null} */ (grid.querySelector('[aria-pressed="true"]'))?.focus();
  }

  function drawSummary() {
    summary.textContent = `${fmtSum.format(fromKey(day))} · ${time}`;
  }

  /** Een dag kiezen; buiten de getoonde maand bladert de kiezer mee. */
  function pick(key, focus = false) {
    day = key;
    const d = fromKey(key);
    if (d.getUTCMonth() !== month.getUTCMonth() || d.getUTCFullYear() !== month.getUTCFullYear()) month = dayDate(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    drawDays();
    if (focus) /** @type {HTMLElement | null} */ (grid.querySelector(`[data-day="${key}"]`))?.focus();
  }

  /** Snelknop: de dag, en bij Vandaag met een tijd die al geweest is het volgende hele uur (als dat nog vandaag is). */
  function pickQuick(key) {
    pick(key);
    if (key === today && time <= nowTime && start.day === today) { time = start.time; tgrid.set(time); drawTimes(); }
  }

  // Pijltjes verplaatsen de gekozen dag (een dag of een week), Enter op een dag is al een klik.
  grid.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    e.preventDefault();
    const d = fromKey(day);
    pick(dayKey(dayDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate() + step)), true);
  });

  let done = false;
  let release = null; // op een smal scherm: de terugknop sluit de kiezer (zie backCloses)
  function finish(result) {
    if (done) return;
    done = true;
    release?.();
    if (dialog.open) dialog.close();
    dialog.remove();
    anchor.focus();
    if (result !== undefined) onPick(result);
  }
  // Esc, of een klik naast de kiezer: annuleren.
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(undefined); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) finish(undefined); });
  dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopPropagation(); }); // niet ook het paneel sluiten

  drawDays();
  drawTimes();
  document.body.append(dialog);
  dialog.showModal();
  if (!narrow.matches) place(dialog, anchor);
  else release = backCloses(() => finish(undefined));
  /** @type {HTMLElement | null} */ (grid.querySelector('[aria-pressed="true"]'))?.focus();
}

