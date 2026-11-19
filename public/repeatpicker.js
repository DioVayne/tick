import { place, showMenu } from './popover.js';
import { el } from './render.js';
import { ordinal, t } from './i18n.js';
import { zonedParts, buildRule, customState, quickRules, shortDay, chipDays, withUntil, untilOf, isSubDay } from './repeat.js';

// Ritmemenu onder de Herhalen-pil (op een smal scherm van onderen): Niet herhalen, de snelkeuzes, "Aangepast…" (een paneel in hetzelfde menu) en de einddatum.
// Een snelkeuze houdt de einddatum van het huidige ritme.

// De waarden blijven de interne eenheden van buildRule/customState; alleen de labels zijn vertaald.
const EENHEID = ['minuut', 'uur', 'dag', 'week', 'maand', 'jaar'];

let closeOpen = null;
let openAnchor = null;

/**
 * @param {HTMLElement} anchor
 * @param {{ remind_at?: string | null, repeat?: { rule: string, start: string } | null }} task
 * @param {(rule: string | null) => void} onPick
 * @param {string | null} [remindAt] een nog niet opgeslagen reminder (wint van task.remind_at)
 */
export function openRepeatPicker(anchor, task, onPick, remindAt) {
  if (closeOpen && openAnchor === anchor) { closeOpen(); return; }
  closeOpen?.();
  const start = remindAt ?? task.remind_at ?? task.repeat?.start ?? new Date().toISOString();
  const current = task.repeat?.rule ?? null;
  // Een einde dat in het menu is getypt maar nog niet bevestigd: wordt opgeslagen zodra het menu sluit (niet bij Esc).
  /** @type {(() => void) | null} */
  let pendingUntil = null;
  const pick = (rule) => { pendingUntil = null; close(); onPick(rule); };
  const s0 = zonedParts(Date.parse(start));
  const firstDay = `${String(s0.y).padStart(4, '0')}-${String(s0.m).padStart(2, '0')}-${String(s0.d).padStart(2, '0')}`;
  // Het einde (t/m): een datumveld, plus een tijdveld bij een ritme per uur of minuut. Leeg = geen einde.
  // Alleen een tijd telt op de eerste dag; alleen een datum met tijd telt t/m 23:59.
  /**
   * @param {string} value YYYY-MM-DD of YYYY-MM-DDTHH:MM
   * @param {((v: string) => void) | null} onChange in het menu: opslaan (een datum direct, een tijd bij Enter, weg of sluiten)
   * @param {boolean} timed
   */
  const untilField = (value, onChange, timed) => {
    const date = el('input', { class: 'rp-until-date', type: 'date', min: firstDay, value: value.slice(0, 10), 'aria-label': t('rep.ends'), title: t('rep.ends_hint') });
    const time = el('input', { class: 'rp-until-time', type: 'time', value: value.slice(11, 16), 'aria-label': t('rep.ends_time') });
    const read = () => {
      if (time.hidden) return date.value;
      if (!date.value && !time.value) return '';
      return `${date.value || firstDay}T${time.value || '23:59'}`;
    };
    const setTimed = (on) => {
      time.hidden = !on;
      if (on && date.value && !time.value) time.value = '23:59';
    };
    setTimed(timed || value.includes('T'));
    const row = el('div', { class: 'rp-row rp-until' }, el('span', {}, t('rep.ends')), date, time);
    if (onChange) {
      const save = () => { if (read() !== value) onChange(read()); };
      date.addEventListener('change', () => { if (time.hidden) save(); else pendingUntil = save; });
      time.addEventListener('input', () => { pendingUntil = save; });
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
      row.addEventListener('focusout', (e) => { if (pendingUntil && !row.contains(/** @type {Node | null} */ (e.relatedTarget))) save(); });
    }
    return { row, read, setTimed, isTimed: () => !time.hidden };
  };
  const keepUntil = (rule) => (current ? withUntil(rule, untilOf(current)) : rule);

  const item = (label, onclick, extra = '') => el('button', { class: 'menu-item' + extra, type: 'button', role: 'menuitem', onclick }, label);
  const list = () => [
    item(t('rep.none'), () => pick(null), current ? '' : ' on'),
    ...quickRules(start).map((q) => item(q.label, () => pick(keepUntil(q.rule)), keepUntil(q.rule) === current ? ' on' : '')),
    el('div', { class: 'menu-sep' }),
    item(t('rep.custom'), () => { menu.replaceChildren(panel()); menu.setAttribute('role', 'dialog'); place(menu, anchor); focusFirst(); }, ' muted'),
    // Alleen bij een bestaand ritme: de einddatum direct aanpassen.
    ...(current ? [untilField(untilOf(current), (v) => pick(withUntil(current, v)), isSubDay(current)).row] : []),
  ];

  function panel() {
    const st = customState(current, start);
    const s = zonedParts(Date.parse(start));
    const n = el('input', { class: 'rp-num', type: 'number', min: '1', max: '99', value: String(st.interval), 'aria-label': t('rep.count') });
    const unit = el('select', { class: 'rp-unit', 'aria-label': t('rep.unit') },
      ...EENHEID.map((u) => el('option', { value: u }, t(`rep.unit.${u}_one`))));
    const sync = () => { // enkelvoud/meervoud volgt het getal; de opties houden hun waarde
      [...unit.options].forEach((o, i) => { o.textContent = t(`rep.unit.${EENHEID[i]}_${Number(n.value) === 1 ? 'one' : 'many'}`); });
      weeks.hidden = unit.value !== 'week';
      months.hidden = unit.value !== 'maand';
      const timed = unit.value === 'minuut' || unit.value === 'uur';
      if (until.isTimed() !== timed) until.setTimed(timed);
    };
    unit.value = st.unit;

    const days = new Set(st.days);
    const chips = chipDays().map((wd) => {
      const chip = el('button', {
        class: 'rp-chip' + (days.has(wd) ? ' on' : ''), type: 'button', role: 'checkbox', 'aria-checked': String(days.has(wd)),
        onclick: () => {
          if (days.has(wd) && days.size === 1) return; // minstens één dag
          days.has(wd) ? days.delete(wd) : days.add(wd);
          chip.classList.toggle('on', days.has(wd));
          chip.setAttribute('aria-checked', String(days.has(wd)));
        },
      }, shortDay(wd));
      return chip;
    });
    const weeks = el('div', { class: 'rp-chips', role: 'group', 'aria-label': t('rep.weekdays') }, ...chips);

    const nth = ordinal(s.d > 28 ? -1 : Math.ceil(s.d / 7));
    const mode = el('select', { class: 'rp-mode', 'aria-label': t('rep.monthly_on') },
      el('option', { value: 'dag' }, t('rep.opt_day', { ord: ordinal(s.d) })),
      el('option', { value: 'weekdag' }, t('rep.opt_nth', { ord: nth, wd: shortDay(s.wd) })));
    mode.value = st.monthMode;
    const months = el('div', { class: 'rp-months' }, mode);

    const until = untilField(untilOf(current), null, false);
    unit.addEventListener('change', sync);
    n.addEventListener('input', sync);
    sync();

    const klaar = () => pick(withUntil(buildRule({ interval: Number(n.value), unit: /** @type {any} */ (unit.value), days: [...days], monthMode: /** @type {any} */ (mode.value) }, start), until.read()));
    until.row.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); klaar(); } });
    return el('div', { class: 'rp' },
      el('div', { class: 'rp-row' }, el('span', {}, t('rep.every')), n, unit),
      weeks, months, until.row,
      el('div', { class: 'rp-actions' },
        el('button', { class: 'pill mini', type: 'button', onclick: () => pick(null) }, t('rep.none')),
        el('button', { class: 'pill rp-done', type: 'button', onclick: klaar }, t('rep.done'))));
  }

  const menu = el('div', { class: 'menu rmenu', role: 'menu', 'aria-label': t('rep.repeat') }, ...list());
  const hide = showMenu(menu, anchor, () => { close(); anchor.focus(); });

  const focusFirst = () => /** @type {HTMLElement | null} */ (menu.querySelector('.menu-item.on, .menu-item, input'))?.focus();
  // Capture op document: Esc sluit alleen het menu, niet ook het paneel eronder.
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      pendingUntil = null; // Esc: niet opslaan
      close();
      anchor.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...menu.querySelectorAll('.menu-item')];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(/** @type {any} */ (document.activeElement));
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
    /** @type {HTMLElement} */ (items[next]).focus();
  };
  // De laag achter een sheet sluit zelf bij een klik; hier niet al bij het neerdrukken, anders valt de klik op wat eronder ligt.
  const onDown = (e) => { if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target) && !e.target.classList?.contains('sheet-scrim')) close(); };
  function close() {
    if (closeOpen !== close) return;
    if (pendingUntil) { // eerst het getypte einde opslaan; dat sluit via pick() ook het menu
      const save = pendingUntil;
      pendingUntil = null;
      save();
      if (closeOpen !== close) return;
    }
    closeOpen = null;
    openAnchor = null;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onDown, true);
    hide();
    anchor.setAttribute('aria-expanded', 'false');
  }
  closeOpen = close;
  openAnchor = anchor;
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onDown, true);
  anchor.setAttribute('aria-expanded', 'true');
  focusFirst();
}

