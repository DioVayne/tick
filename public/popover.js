import { t } from './i18n.js';
import { el } from './render.js';

// Kiezers (datum, ritme, lijst): op een breed scherm een vlak onder de knop, op een smal scherm een sheet van onderen
// met een donkere laag erachter. Hetzelfde breekpunt als het taakscherm.

export const narrow = matchMedia('(max-width: 1023.98px)');

/**
 * Eigen history-item voor een sheet (zoals de kaart): de terugknop van de telefoon sluit dan de sheet in plaats van de
 * app. Zolang hij er is, staat .sheet-open op body; de popstate-handler van app.js laat zo'n stap met rust.
 * Geeft `release` terug: na sluiten op een andere manier haalt die het item weg; resolvet als dat gebeurd is (dan kan
 * er veilig een volgende sheet open).
 * @param {() => void} onBack
 * @returns {() => Promise<void>}
 */
export function backCloses(onBack) {
  history.pushState({ tickSheet: true }, '');
  document.body.classList.add('sheet-open');
  let gone = false; // dicht (via terug of via release)
  let cleaned = false;
  let resolveGone = () => {};
  const goneP = new Promise((r) => { resolveGone = r; });
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    window.removeEventListener('popstate', onPop);
    document.body.classList.remove('sheet-open');
    resolveGone();
  };
  function onPop() {
    window.removeEventListener('popstate', onPop);
    setTimeout(cleanup); // na de andere popstate-listeners (app.js kijkt naar .sheet-open)
    if (!gone) { gone = true; onBack(); }
  }
  window.addEventListener('popstate', onPop);
  return () => {
    if (!gone) {
      gone = true;
      history.back(); // onPop ruimt op
      setTimeout(cleanup, 500); // vangnet als er geen popstate komt
    }
    return goneP;
  };
}

/**
 * Zet een keuzemenu in beeld: smal als sheet (class `sheet`, met `.sheet-scrim` erachter en onderaan Annuleren, die
 * net als de terugknop `onScrim` aanroepen), breed onder de knop. Geeft de functie terug die het menu (en de laag) weer
 * weghaalt; die resolvet als ook het history-item van de sheet weg is.
 * @param {HTMLElement} menu
 * @param {HTMLElement} anchor
 * @param {() => void} onScrim
 * @returns {() => Promise<void>}
 */
export function showMenu(menu, anchor, onScrim) {
  if (!narrow.matches) {
    document.body.append(menu);
    place(menu, anchor);
    return () => { menu.remove(); return Promise.resolve(); };
  }
  menu.classList.add('sheet');
  menu.append(el('button', { class: 'menu-item menu-cancel', type: 'button', onclick: onScrim }, t('dialog.cancel')));
  const scrim = el('div', { class: 'sheet-scrim', onclick: onScrim });
  document.body.append(scrim, menu);
  const release = backCloses(onScrim);
  return () => { scrim.remove(); menu.remove(); return release(); };
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
