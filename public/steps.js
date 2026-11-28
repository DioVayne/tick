import { t } from './i18n.js';
import { icon } from './icons.js';
import { el, fromLocalInput, toLocalInput } from './render.js';
import { openDatePicker } from './datepicker.js';
import { showMenu } from './popover.js';
import { busyAt, freeOfTasks, quickWhen, takenMinutes, whenText } from './planner.js';
import { state } from './store.js';
import { busyNow } from './agenda.js';
import { openAgendaPicker } from './agendapick.js';

// De tijdlijn van de invoerkaart (composer.js) en het detailpaneel (detail.js): per eigenschap een zin met een gekleurde
// stip ("Herinner me morgen 09:00", "In Inbox"). Hier staan de stap zelf, het keuzemenu en het korte herinneringsmenu,
// zodat kaart en paneel één ontwerp blijven. Wat er gebeurt bij kiezen of wissen bepaalt de aanroeper.

/**
 * Eén stap: stip met icoon, een zin (vaste woorden en de gekozen waarde, vet in de kleur) en rechts acties zoals Wissen.
 * Zonder `open` is de zin gewone tekst (alleen-lezen, of een subtaak die de lijst van de ouder volgt).
 * `stack`: de gekozen waarde op een eigen regel onder de vaste woorden ("Herinner me" / "vr 27 nov, 17:30"), zodat een lange
 * datum niet midden in de zin afbreekt. Een actie met `line` staat op een eigen regel onder de zin (zoals "Herinner me over 1 uur"),
 * als een echte knop (een pil, met `icon` ervoor), niet als stille tekst zoals Wissen.
 * @param {{
 *   kind: string, icon: Parameters<typeof icon>[0], on: boolean, lead: string, value?: string | null, note?: string | null,
 *   open?: ((anchor: HTMLElement) => void) | null, actions?: ({ label: string, title?: string, run: () => void, line?: boolean, icon?: Parameters<typeof icon>[0] } | null)[],
 *   sub?: HTMLElement | null, body?: HTMLElement | null, past?: boolean, pressed?: boolean, expanded?: boolean, stack?: boolean,
 * }} s
 */
export function step(s) {
  const content = [
    el('span', { class: 'step-dot' }, icon(s.icon)),
    s.stack && s.value
      ? el('span', { class: 'step-txt' }, s.lead, ' ', el('span', { class: 'step-val' }, el('b', {}, s.value), s.note ? el('small', {}, ' · ' + s.note) : null))
      : el('span', { class: 'step-txt' }, s.lead, s.lead && s.value ? ' ' : '', s.value ? el('b', {}, s.value) : null, s.note ? el('small', {}, ' · ' + s.note) : null),
  ];
  const head = s.open
    ? el('button', {
      type: 'button', class: 'step-head', onclick: (e) => s.open?.(e.currentTarget),
      'aria-expanded': s.expanded == null ? false : String(s.expanded), 'aria-pressed': s.pressed == null ? false : String(s.pressed),
    }, ...content)
    : el('div', { class: 'step-head' }, ...content);
  const button = (a) => el('button', { type: 'button', class: 'step-act', title: a.title ?? false, onclick: a.run }, a.label);
  // De knop is 44 px hoog (touch, zie style.css); de pil erin is het zichtbare deel.
  const pill = (a) => el('button', { type: 'button', class: 'step-act step-pill', title: a.title ?? false, onclick: a.run },
    el('span', { class: 'step-pill-in' }, a.icon ? icon(a.icon, 'sm') : null, a.label));
  const all = /** @type {{ label: string, title?: string, run: () => void, line?: boolean, icon?: Parameters<typeof icon>[0] }[]} */ ((s.actions ?? []).filter(Boolean));
  const below = all.filter((a) => a.line);
  return el('div', { class: `step step-${s.kind}` + (s.on ? ' on' : '') + (s.past ? ' past' : '') + (s.stack ? ' stack' : '') },
    el('div', { class: 'step-row' }, head, ...all.filter((a) => !a.line).map(button)),
    below.length ? el('div', { class: 'step-line' }, ...below.map(pill)) : null, s.sub ?? null, s.body ?? null);
}

let closeMenu = null;
/**
 * Een keuzemenu bij een stap: breed onder de stap, smal als sheet met Annuleren en de terugknop (popover.js).
 * `build` krijgt `choose(apply, then)`: menu dicht, `apply` loopt meteen, en `then` pas als ook het history-item van de
 * sheet weg is (zodat er veilig een volgende kiezer open kan). `onDismiss`: dicht zonder keuze (Esc, Annuleren, terug).
 * Nog een keer op dezelfde stap tikken sluit het menu.
 * @param {HTMLElement} anchor
 * @param {string} label
 * @param {(choose: (apply: (() => void) | null, then?: () => void) => void) => (HTMLElement | null)[]} build
 * @param {() => void} [onDismiss]
 */
export function openMenu(anchor, label, build, onDismiss = () => {}) {
  if (closeMenu) { closeMenu(); return; }
  const choose = (apply, then) => {
    const gone = close();
    apply?.();
    if (then) gone.then(then);
  };
  const menu = el('div', { class: 'menu', role: 'menu', 'aria-label': label }, ...build(choose));
  // Dicht zonder keuze: de focus stond in het menu, dat nu weg is. Terug naar de knop waarmee het openging (als de
  // aanroeper hem niet zelf ergens anders neerzette), anders belandt hij op <body>.
  const dismiss = () => {
    close();
    onDismiss();
    const a = document.activeElement;
    if (anchor.isConnected && (!a || a === document.body)) anchor.focus();
  };
  const hide = showMenu(menu, anchor, dismiss);
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss(); } };
  const onDown = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target) && !e.target.classList?.contains('sheet-scrim')) close(); };
  function close() {
    closeMenu = null;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onDown, true);
    return hide();
  }
  closeMenu = close;
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onDown, true);
  /** @type {HTMLElement | null} */ (menu.querySelector('.menu-item.on, .menu-item, input'))?.focus();
}

/** Is er een menu van een stap open? Dan sluit een tweede tik het eerst. */
export const menuOpen = () => !!closeMenu;
export const closeStepMenu = () => closeMenu?.();


/**
 * Herinnering kiezen: bovenaan "Kies dag en tijd" (opent de volledige datumkiezer, zonder de snelknoppen die hier al
 * staan), daaronder als hulp hooguit drie snelkeuzes (vandaag, morgen, volgende week). Met een gekoppelde agenda vallen
 * die nooit op een afspraak en staat eronder dat ze op je agenda gebaseerd zijn. Een snelkeuze valt ook nooit op de
 * herinnering van een andere open taak (dezelfde minuut): dan schuift hij een kwartier op. Zelf kiezen mag wel.
 * `current` en de waarde voor `set` zijn 'YYYY-MM-DDTHH:MM' zoals de datumkiezer; leeg (of null) is wissen.
 * @param {HTMLElement} anchor
 * @param {string} current
 * @param {(value: string) => void} set
 * @param {{ note?: string, onDismiss?: () => void, self?: string | null }} [opts] self: de taak zelf (telt niet als bezet)
 */
export function openWhenMenu(anchor, current, set, { note, onDismiss, self } = {}) {
  // Alles in de ingestelde zone (wandklok), niet met de klok van het apparaat.
  const now = Date.now();
  const quick = quickWhen(now);
  // Met een gekoppelde agenda schuift elke snelkeuze naar het eerste vrije moment die dag (of valt weg als de dag vol
  // zit): een voorstel valt nooit op een afspraak. Zonder agenda: de vaste tijden. En nooit op een tijd die al bij een
  // andere open taak hoort (uit wat de app al geladen heeft: je eigen taken en die met je gedeeld zijn).
  const busy = busyNow();
  const taken = takenMinutes(state.open, self);
  const values = [quick.today, quick.tomorrow, quick.nextWeek].map((value) => {
    const iso = value ? fromLocalInput(value) : null;
    if (!iso || (!busy && !taken.size)) return value;
    const at = freeOfTasks(Date.parse(iso), taken, busy);
    return at == null ? null : toLocalInput(new Date(at).toISOString());
  }).filter((v) => !!v);
  const label = (value) => {
    const when = whenText(Date.parse(/** @type {string} */ (fromLocalInput(value))), now);
    return when.charAt(0).toUpperCase() + when.slice(1);
  };
  openMenu(anchor, t('add.when'), (choose) => [
    el('button', {
      class: 'menu-item when-pick', type: 'button', role: 'menuitem',
      onclick: () => choose(null, () => openDatePicker(anchor, current, (value) => set(value ?? ''), { quick: false, note })),
    }, icon('calendar'), el('span', {}, t('when.pick'))),
    // Met een gekoppelde agenda: het rooster met dagkolommen (agendapick.js); "Andere dag of tijd" daar opent de datumkiezer.
    busy ? el('button', {
      class: 'menu-item when-agenda', type: 'button', role: 'menuitem',
      onclick: () => choose(null, () => openAgendaPicker(anchor, current, set, {
        onDismiss,
        onOther: () => openDatePicker(anchor, current, (value) => set(value ?? ''), { quick: false, note }),
      })),
    }, icon('agenda'), el('span', {}, t('when.agenda')), el('small', {}, t('when.agenda_sub'))) : null,
    values.length ? el('div', { class: 'when-head', role: 'presentation' }, t('when.quick')) : null,
    values.length ? el('div', { class: 'when-chips', role: 'presentation' }, ...values.map((value) => el('button', {
      class: 'menu-item when-chip' + (current === value ? ' on' : ''), type: 'button', role: 'menuitem',
      onclick: () => choose(() => set(value)),
    }, label(value)))) : null,
    busy ? el('div', { class: 'when-note', role: 'presentation' }, t('when.from_calendar')) : null,
  ], onDismiss);
}

/**
 * "tijdens Overleg" als een herinnering op een afspraak uit een gekoppelde agenda valt (dat mag; het is alleen een
 * opmerking bij de stap), anders null. `value` is 'YYYY-MM-DDTHH:MM' of een ISO-moment.
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function duringNote(value) {
  const busy = busyNow();
  if (!value || !busy) return null;
  const iso = value.length <= 16 ? fromLocalInput(value) : value;
  const hit = iso ? busyAt(Date.parse(iso), busy, 60_000) : null;
  return hit ? t('when.during', { title: hit.title || t('cal.busy') }) : null;
}
