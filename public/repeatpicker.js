import { place, showMenu } from './popover.js';
import { el } from './render.js';
import { ordinal, t } from './i18n.js';
import { zonedParts, buildRule, customState, quickRules, shortDay, chipDays, withUntil, untilOf } from './repeat.js';

// Ritmemenu onder de Herhalen-pil (op een smal scherm van onderen): Niet herhalen, de snelkeuzes, "Aangepast…" (een paneel in hetzelfde menu) en de einddatum.
// Een snelkeuze houdt de einddatum van het huidige ritme.

// De waarden blijven de interne eenheden van buildRule/customState; alleen de labels zijn vertaald.
const EENHEID = ['dag', 'week', 'maand', 'jaar'];

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
  const pick = (rule) => { close(); onPick(rule); };
  const s0 = zonedParts(Date.parse(start));
  const firstDay = `${String(s0.y).padStart(4, '0')}-${String(s0.m).padStart(2, '0')}-${String(s0.d).padStart(2, '0')}`;
  // Datumveld voor de einddatum (t/m); leeg = geen einde.
  const untilField = (value, onChange) => {
    const input = el('input', { class: 'rp-until-date', type: 'date', min: firstDay, value, 'aria-label': t('rep.ends'), title: t('rep.ends_hint') });
    if (onChange) input.addEventListener('change', () => onChange(input.value));
    return { input, row: el('label', { class: 'rp-row rp-until' }, el('span', {}, t('rep.ends')), input) };
  };
  const keepUntil = (rule) => (current ? withUntil(rule, untilOf(current)) : rule);

  const item = (label, onclick, extra = '') => el('button', { class: 'menu-item' + extra, type: 'button', role: 'menuitem', onclick }, label);
  const list = () => [
    item(t('rep.none'), () => pick(null), current ? '' : ' on'),
    ...quickRules(start).map((q) => item(q.label, () => pick(keepUntil(q.rule)), keepUntil(q.rule) === current ? ' on' : '')),
    el('div', { class: 'menu-sep' }),
    item(t('rep.custom'), () => { menu.replaceChildren(panel()); menu.setAttribute('role', 'dialog'); place(menu, anchor); focusFirst(); }, ' muted'),
    // Alleen bij een bestaand ritme: de einddatum direct aanpassen.
    ...(current ? [untilField(untilOf(current), (v) => pick(withUntil(current, v))).row] : []),
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

    unit.addEventListener('change', sync);
    n.addEventListener('input', sync);
    sync();

    const until = untilField(untilOf(current));
    const klaar = () => pick(withUntil(buildRule({ interval: Number(n.value), unit: /** @type {any} */ (unit.value), days: [...days], monthMode: /** @type {any} */ (mode.value) }, start), until.input.value));
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

