import { dateLocale, t } from './i18n.js';
import { el } from './render.js';

// Eigen datum- en tijdkiezer: een maand met de weekdagen erboven (ma–zo), drie vaste tijden of een eigen tijd.
// Op een smal scherm schuift hij van onderen in beeld, op een breed scherm staat hij onder de knop.
// Werkt met lokale tijd als 'YYYY-MM-DDTHH:MM' (zoals een datetime-local-veld); null is wissen.

const TIMES = ['09:00', '13:00', '19:00'];
const p2 = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const fromKey = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const narrow = matchMedia('(max-width: 1023.98px)');

/** Leeg: vandaag, op het volgende hele uur (na 23:00 wordt het 23:30, zodat het vandaag blijft). */
function defaultTime(now) {
  const h = now.getHours() + 1;
  return h > 23 ? '23:30' : `${p2(h)}:00`;
}

/**
 * @param {HTMLElement} anchor de knop die de kiezer opent (focus gaat daar weer heen)
 * @param {string} value 'YYYY-MM-DDTHH:MM', of '' voor geen datum
 * @param {(value: string | null) => void} onPick met de gekozen waarde, of null bij Wissen; niet bij annuleren
 */
export function openDatePicker(anchor, value, onPick) {
  const now = new Date();
  const today = dayKey(now);
  let day = value ? value.slice(0, 10) : today;
  let time = value ? value.slice(11, 16) : defaultTime(now);
  let month = fromKey(day);
  month.setDate(1);
  let ownOpen = !TIMES.includes(time);

  const locale = dateLocale();
  const fmtMonth = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
  const fmtWeekday = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const fmtDay = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtSum = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' });

  const title = el('span', { class: 'dp-month', 'aria-live': 'polite' });
  const grid = el('div', { class: 'dp-grid' });
  const times = el('div', { class: 'dp-times' });
  const own = /** @type {HTMLInputElement} */ (el('input', { type: 'time', class: 'dp-own', 'aria-label': t('dp.time') }));
  own.addEventListener('input', () => { if (own.value) { time = own.value; drawTimes(); } });
  const summary = el('span', { class: 'dp-sum' });
  const shift = (months) => { month = new Date(month.getFullYear(), month.getMonth() + months, 1); drawDays(); };

  // Maandag tot en met zondag: 1 januari 2024 was een maandag.
  const weekdays = el('div', { class: 'dp-wd', 'aria-hidden': 'true' },
    ...Array.from({ length: 7 }, (_, i) => el('span', {}, fmtWeekday.format(new Date(2024, 0, 1 + i)))));

  const dialog = /** @type {HTMLDialogElement} */ (el('dialog', { class: 'dpick' + (narrow.matches ? ' sheet' : ''), 'aria-label': t('dp.title') },
    el('div', { class: 'dp-head' },
      el('button', { class: 'dp-nav', type: 'button', 'aria-label': t('dp.prev'), onclick: () => shift(-1) }, '‹'),
      title,
      el('button', { class: 'dp-nav', type: 'button', 'aria-label': t('dp.next'), onclick: () => shift(1) }, '›')),
    weekdays,
    grid,
    times,
    el('div', { class: 'dp-foot' },
      summary,
      el('div', { class: 'dp-actions' },
        value ? el('button', { class: 'dp-clear', type: 'button', onclick: () => finish(null) }, t('dp.clear')) : null,
        el('button', { type: 'button', onclick: () => finish(`${day}T${time}`) }, t('dp.done'))))));

  function drawDays() {
    title.textContent = fmtMonth.format(month);
    const offset = (month.getDay() + 6) % 7; // maandag eerst
    const inMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells = Math.ceil((offset + inMonth) / 7) * 7;
    grid.replaceChildren(...Array.from({ length: cells }, (_, i) => {
      const d = new Date(month.getFullYear(), month.getMonth(), 1 - offset + i);
      const key = dayKey(d);
      const cls = ['dp-day'];
      if (d.getMonth() !== month.getMonth()) cls.push('out');
      if (key < today) cls.push('past');
      if (key === today) cls.push('today');
      return el('button', {
        class: cls.join(' '), type: 'button', 'data-day': key, 'aria-label': fmtDay.format(d), 'aria-pressed': String(key === day),
        tabindex: key === day ? '0' : '-1',
        onclick: () => pick(key),
      }, String(d.getDate()));
    }));
    drawSummary();
  }

  function drawTimes() {
    own.value = time;
    times.replaceChildren(
      ...TIMES.map((tm) => el('button', {
        type: 'button', 'aria-pressed': String(tm === time),
        onclick: () => { time = tm; ownOpen = false; drawTimes(); },
      }, tm)),
      ownOpen ? own : el('button', { class: 'dp-other', type: 'button', onclick: () => { ownOpen = true; drawTimes(); own.focus(); } }, t('dp.other_time')),
    );
    drawSummary();
  }

  function drawSummary() {
    summary.textContent = `${fmtSum.format(fromKey(day))} · ${time}`;
  }

  /** Een dag kiezen; buiten de getoonde maand bladert de kiezer mee. */
  function pick(key, focus = false) {
    day = key;
    const d = fromKey(key);
    if (d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear()) month = new Date(d.getFullYear(), d.getMonth(), 1);
    drawDays();
    if (focus) /** @type {HTMLElement | null} */ (grid.querySelector(`[data-day="${key}"]`))?.focus();
  }

  // Pijltjes verplaatsen de gekozen dag (een dag of een week), Enter op een dag is al een klik.
  grid.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    e.preventDefault();
    const d = fromKey(day);
    d.setDate(d.getDate() + step);
    pick(dayKey(d), true);
  });

  let done = false;
  function finish(result) {
    if (done) return;
    done = true;
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
  /** @type {HTMLElement | null} */ (grid.querySelector('[aria-pressed="true"]'))?.focus();
}

/** Onder de knop (of erboven als daar geen plek is), binnen het scherm. */
function place(dialog, anchor) {
  const r = anchor.getBoundingClientRect();
  const w = dialog.offsetWidth;
  const h = dialog.offsetHeight;
  const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
  const top = r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4;
  dialog.style.left = left + 'px';
  dialog.style.top = top + 'px';
}
