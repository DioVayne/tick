import { el } from './render.js';

// Kiezers (datum, ritme, lijst): op een breed scherm een vlak onder de knop, op een smal scherm een sheet van onderen
// met een donkere laag erachter. Hetzelfde breekpunt als het taakscherm.

export const narrow = matchMedia('(max-width: 1023.98px)');

/**
 * Zet een keuzemenu in beeld: smal als sheet (class `sheet`, met `.sheet-scrim` erachter die bij een tik `onScrim`
 * aanroept), breed onder de knop. Geeft de functie terug die het menu (en de laag) weer weghaalt.
 * @param {HTMLElement} menu
 * @param {HTMLElement} anchor
 * @param {() => void} onScrim
 */
export function showMenu(menu, anchor, onScrim) {
  if (!narrow.matches) {
    document.body.append(menu);
    place(menu, anchor);
    return () => menu.remove();
  }
  menu.classList.add('sheet');
  const scrim = el('div', { class: 'sheet-scrim', onclick: onScrim });
  document.body.append(scrim, menu);
  return () => { scrim.remove(); menu.remove(); };
}

/** Onder de knop (of erboven als daar geen plek is), binnen het scherm. Niets bij een sheet: die staat vast onderin. */
export function place(box, anchor) {
  if (box.classList.contains('sheet')) return;
  const r = anchor.getBoundingClientRect();
  const w = box.offsetWidth;
  const h = box.offsetHeight;
  const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
  const below = r.bottom + 4;
  const top = below + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : below;
  box.style.left = left + 'px';
  box.style.top = top + 'px';
}
