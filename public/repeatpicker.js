import { el } from './render.js';
import { ordinal, t } from './i18n.js';
import { zonedParts, buildRule, customState, quickRules, shortDay, chipDays } from './repeat.js';

// Ritmemenu onder de 🔁-pil: Niet herhalen, de snelkeuzes en "Aangepast…" (een paneel in hetzelfde menu).

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

  const item = (label, onclick, extra = '') => el('button', { class: 'menu-item' + extra, type: 'button', role: 'menuitem', onclick }, label);
  const list = () => [
    item(t('rep.none'), () => pick(null), current ? '' : ' on'),
    ...quickRules(start).map((q) => item(q.label, () => pick(q.rule), q.rule === current ? ' on' : '')),
    el('div', { class: 'menu-sep' }),
    item(t('rep.custom'), () => { menu.replaceChildren(panel()); menu.setAttribute('role', 'dialog'); place(menu, anchor); focusFirst(); }, ' muted'),
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

    const klaar = () => pick(buildRule({ interval: Number(n.value), unit: /** @type {any} */ (unit.value), days: [...days], monthMode: /** @type {any} */ (mode.value) }, start));
    return el('div', { class: 'rp' },
      el('div', { class: 'rp-row' }, el('span', {}, t('rep.every')), n, unit),
      weeks, months,
      el('div', { class: 'rp-actions' },
        el('button', { class: 'pill mini', type: 'button', onclick: () => pick(null) }, t('rep.none')),
        el('button', { class: 'pill rp-done', type: 'button', onclick: klaar }, t('rep.done'))));
  }

  const menu = el('div', { class: 'menu rmenu', role: 'menu', 'aria-label': t('rep.repeat') }, ...list());
  document.body.append(menu);
  place(menu, anchor);

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
  const onDown = (e) => { if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); };
  function close() {
    if (closeOpen !== close) return;
    closeOpen = null;
    openAnchor = null;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onDown, true);
    menu.remove();
    anchor.setAttribute('aria-expanded', 'false');
  }
  closeOpen = close;
  openAnchor = anchor;
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onDown, true);
  anchor.setAttribute('aria-expanded', 'true');
  focusFirst();
}

/** Onder de knop, en binnen het scherm. */
function place(menu, anchor) {
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
  const below = r.bottom + 4;
  const top = below + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : below;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}
