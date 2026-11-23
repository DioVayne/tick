// Kies in je agenda: een rooster met dagkolommen naast elkaar (smal 3 in beeld en vegen, breed 7 met pijlen per week),
// per kolom de hele dag in halve uren. Afspraken uit gekoppelde agenda's staan er gedempt in, met de titel; de voorstellen
// van de planner zijn gele halve uren met een ster; een taak met een herinnering staat als grijze tekst in zijn halfuur.
// Elk halfuur dat nog komt is te kiezen, ook tijdens een afspraak (eigen verantwoordelijkheid). Eén tik kiest en sluit.
// Het rekenwerk staat in agendagrid.js; de afspraken komen uit agenda.js.
import { allDayTitles, dayEvents, daySlots, gridDays, MAX_DAYS, openHour, PAGE_DAYS, tipSet } from './agendagrid.js';
import { busyNow } from './agenda.js';
import { dateLocale, t } from './i18n.js';
import { whenText } from './planner.js';
import { backCloses, narrow } from './popover.js';
import { getTimeZone } from './repeat.js';
import { el, fromLocalInput, toLocalInput } from './render.js';
import { icon } from './icons.js';
import { state } from './store.js';

/**
 * @param {HTMLElement} anchor de knop die de kiezer opent (focus gaat daar weer heen)
 * @param {string} current 'YYYY-MM-DDTHH:MM' (de huidige keuze) of leeg
 * @param {(value: string) => void} onPick met de gekozen wandklok 'YYYY-MM-DDTHH:MM'
 * @param {{ onOther?: () => void, onDismiss?: () => void }} [opts] onOther: "Andere dag of tijd…" (de gewone datumkiezer)
 */
export function openAgendaPicker(anchor, current, onPick, { onOther, onDismiss } = {}) {
  const now = Date.now();
  const busy = busyNow();
  const tips = tipSet(busy, now);
  const tasks = state.open.filter((x) => x.remind_at && !x.done && !x.deleted_at).map((x) => ({ at: Date.parse(x.remind_at), title: x.title }));
  const pickedIso = current ? fromLocalInput(current) : null;
  const picked = pickedIso ? Date.parse(pickedIso) : null;
  let count = PAGE_DAYS;
  if (picked != null) while (count < MAX_DAYS && picked >= gridDays(now, count).at(-1).end) count += PAGE_DAYS;

  const wide = !narrow.matches;
  const locale = dateLocale();
  const fmtWd = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  const fmtMo = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  const fmtRange = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const hm = (/** @type {number} */ h, /** @type {number} */ mi) => `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;

  const grid = el('div', { class: 'apick-grid', role: 'grid', 'aria-label': t('apick.title') });
  const scroll = el('div', { class: 'apick-scroll' }, grid);
  const range = el('span', { class: 'apick-range', 'aria-live': 'polite' });
  const colW = () => {
    const tw = parseFloat(getComputedStyle(grid).getPropertyValue('--apick-timew')) || 48;
    return (scroll.clientWidth - tw) / (wide ? 7 : 3);
  };
  const go = (/** @type {number} */ n) => scroll.scrollBy({ left: n * colW() * 7, behavior: 'smooth' });
  const dialog = el('dialog', { class: 'apick' + (wide ? '' : ' sheet'), 'aria-label': t('apick.title') },
    el('div', { class: 'apick-top' },
      el('strong', { class: 'apick-title' }, t('apick.title')),
      wide ? el('span', { class: 'apick-nav' },
        el('button', { type: 'button', class: 'apick-arrow', 'aria-label': t('apick.prev'), onclick: () => go(-1) }, '‹'),
        range,
        el('button', { type: 'button', class: 'apick-arrow', 'aria-label': t('apick.next'), onclick: () => go(1) }, '›')) : null,
      el('button', { type: 'button', class: 'apick-close', 'aria-label': t('apick.close'), onclick: () => finish(null) }, '✕')),
    scroll,
    // Onderaan: een korte legenda (smal op één regel, zonder iets weg te laten) en "Andere dag of tijd" als echte knop.
    el('div', { class: 'apick-foot' },
      el('div', { class: 'apick-legend' },
        el('span', { class: 'apick-lg' }, el('i', { class: 'apick-sw free' }), t('apick.free')),
        busy ? el('span', { class: 'apick-lg' }, el('i', { class: 'apick-sw busy' }), t('apick.busy')) : null,
        tips.size ? el('span', { class: 'apick-lg' }, el('i', { class: 'apick-sw tip' }), t('apick.tip')) : null,
        el('span', { class: 'apick-lg' }, el('i', { class: 'apick-tk' }, '· ' + t('apick.task_word')), ' ', t('apick.task'))),
      onOther ? el('button', { type: 'button', class: 'apick-other', onclick: () => finish(null, onOther) }, icon('calendar'), t('apick.other')) : null));

  function draw() {
    const days = gridDays(now, count);
    grid.style.setProperty('--apick-days', String(days.length));
    const kids = [el('div', { class: 'apick-corner' })];
    days.forEach((day, i) => {
      const date = new Date(Date.UTC(day.y, day.m - 1, day.d));
      const label = i === 0 ? t('apick.today') : i === 1 ? t('apick.tomorrow') : fmtWd.format(date);
      const head = el('div', { class: 'apick-day' + (i === 0 ? ' today' : '') + (day.wd >= 5 ? ' weekend' : ''), role: 'columnheader' },
        el('span', { class: 'apick-wd' }, label),
        el('span', { class: 'apick-dn' }, String(day.d)),
        i === 0 || day.d === 1 ? el('span', { class: 'apick-mo' }, fmtMo.format(date)) : null,
        ...allDayTitles(day, busy).slice(0, 2).map((title) => el('span', { class: 'apick-allday', title: t('apick.allday') }, title || t('cal.busy'))));
      head.style.setProperty('--apick-col', String(i + 2));
      kids.push(head);
    });
    const more = el('div', { class: 'apick-morehead' }, count < MAX_DAYS ? el('button', {
      type: 'button', class: 'apick-more', onclick: () => {
        const left = scroll.scrollLeft;
        count = Math.min(count + PAGE_DAYS, MAX_DAYS);
        draw();
        scroll.scrollLeft = left + colW();
      },
    }, t('apick.more'), el('small', {}, t('apick.more_sub'))) : null);
    more.style.setProperty('--apick-col', String(days.length + 2));
    kids.push(more);
    kids.push(el('div', { class: 'apick-times', 'aria-hidden': 'true' },
      ...Array.from({ length: 48 }, (_, i) => el('div', { class: 'apick-t' }, i % 2 ? '' : hm(i / 2, 0)))));
    days.forEach((day, d) => {
      const col = el('div', { class: 'apick-col' + (day.wd >= 5 ? ' weekend' : ''), role: 'row' });
      col.style.setProperty('--apick-col', String(d + 2));
      for (const [i, s] of daySlots(day, { busy, tasks, now, tips }).entries()) {
        const hour = i % 2 ? '' : ' hour';
        const night = s.h < 6 || s.h >= 23 ? ' night' : '';
        if (s.past) { col.append(el('div', { class: 'apick-slot past' + hour, role: 'gridcell' })); continue; }
        const kind = s.at === picked ? 'picked' : s.busy ? 'busy' : s.tip ? 'tip' : 'free';
        const when = whenText(s.at, now);
        const label = s.busy ? t('apick.slot_busy', { when, title: s.busy.title || t('cal.busy') }) : when;
        col.append(el('button', {
          type: 'button', class: `apick-slot ${kind}${hour}${night}`, role: 'gridcell', 'data-d': d, 'data-i': i,
          'aria-label': label + (s.task ? ` · ${s.task}` : ''), 'aria-pressed': kind === 'picked' ? 'true' : false,
          onclick: () => finish(s.at),
        }, el('span', { class: 'apick-tm' }, hm(s.h, s.mi)), s.task ? el('span', { class: 'apick-tk' }, '· ' + s.task) : null));
      }
      for (const ev of dayEvents(day, busy)) {
        const box = el('div', { class: 'apick-ev', 'aria-hidden': 'true' },
          el('b', {}, ev.title || t('cal.busy')),
          ev.len >= 2 ? el('span', {}, `${whenTime(ev.start)}–${whenTime(ev.end)}`) : null);
        box.style.setProperty('--top', String(ev.top));
        box.style.setProperty('--len', String(ev.len));
        box.style.setProperty('--lane', String(ev.lane));
        box.style.setProperty('--lanes', String(ev.lanes));
        col.append(box);
      }
      if (d === 0) {
        const line = el('div', { class: 'apick-now', 'aria-hidden': 'true' });
        line.style.setProperty('--top', String((now - day.start) / (30 * 60_000)));
        col.append(line);
      }
      kids.push(col);
    });
    const tail = el('div', { class: 'apick-tail' });
    tail.style.setProperty('--apick-col', String(days.length + 2));
    kids.push(tail);
    grid.replaceChildren(...kids);
    showRange();
  }
  const fmtTime = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: getTimeZone() });
  function whenTime(/** @type {number} */ ms) { return fmtTime.format(ms); }

  function showRange() {
    if (!wide) return;
    const days = gridDays(now, count);
    const first = Math.max(0, Math.min(Math.round(scroll.scrollLeft / colW()), days.length - 1));
    const last = Math.min(first + 6, days.length - 1);
    const d = (/** @type {number} */ i) => new Date(Date.UTC(days[i].y, days[i].m - 1, days[i].d));
    range.textContent = `${fmtRange.format(d(first))} – ${fmtRange.format(d(last))}`;
  }
  scroll.addEventListener('scroll', showRange, { passive: true });
  const sizer = new ResizeObserver(() => { grid.style.setProperty('--apick-vw', scroll.clientWidth + 'px'); showRange(); });
  sizer.observe(scroll);

  // Pijltjes: een halfuur op en neer, een dag links en rechts.
  grid.addEventListener('keydown', (e) => {
    const b = /** @type {HTMLElement} */ (e.target);
    if (!b.dataset?.i) return;
    const step = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
    if (!step) return;
    e.preventDefault();
    let d = Number(b.dataset.d), i = Number(b.dataset.i);
    for (let n = 0; n < 96; n++) {
      d += step[0]; i += step[1];
      const next = /** @type {HTMLElement | null} */ (grid.querySelector(`[data-d="${d}"][data-i="${i}"]`));
      if (next) { next.focus(); return; }
      if (i < 0 || i > 47 || d < 0 || d >= count) return;
    }
  });

  let done = false;
  let release = /** @type {(() => Promise<void>) | null} */ (null);
  /**
   * @param {number | null} at gekozen moment, of null (dicht zonder keuze)
   * @param {() => void} [then] daarna (Andere dag of tijd), pas als ook het history-item van de sheet weg is
   */
  function finish(at, then) {
    if (done) return;
    done = true;
    sizer.disconnect();
    const gone = release?.() ?? Promise.resolve();
    if (dialog.open) dialog.close();
    dialog.remove();
    if (at != null) { anchor.focus(); onPick(toLocalInput(new Date(at).toISOString())); }
    else if (then) gone.then(then);
    else { anchor.focus(); onDismiss?.(); }
  }
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) finish(null); });
  dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopPropagation(); });

  draw();
  document.body.append(dialog);
  dialog.showModal();
  if (!wide) release = backCloses(() => finish(null));
  grid.style.setProperty('--apick-vw', scroll.clientWidth + 'px');
  // Open op de keuze (of vandaag), een uur ervoor.
  const days = gridDays(now, count);
  const col = picked != null ? Math.max(days.findIndex((d) => picked >= d.start && picked < d.end), 0) : 0;
  const rowH = /** @type {HTMLElement | null} */ (grid.querySelector('.apick-slot'))?.offsetHeight || 28;
  scroll.scrollTo({ top: openHour(picked, now) * 2 * rowH, left: Math.max(col - (wide ? 0 : 1), 0) * colW() });
  /** @type {HTMLElement | null} */ (grid.querySelector('.apick-slot.picked, .apick-slot.tip, .apick-slot.free'))?.focus({ preventScroll: true });
}
