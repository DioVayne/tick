import { Offline } from './api.js';
import { t } from './i18n.js';
import { ask } from './dialog.js';
import { RADIUS, deletePlace, formatRadius, geocode, loadPlaces, renamePlace, savePlace, updatePlace } from './places.js';
import { el, toast } from './render.js';

// Schermvullend kaartscherm om een plek voor een taak te kiezen, of (vanuit de instellingen) een favoriete plek toe te
// voegen of te wijzigen. De pin staat vast in het midden; je schuift de kaart eronder.

const NL = [52.2, 5.3];
const ZOOM = 15;
const LONG_PRESS_MS = 600;
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

let leaflet = null;
/** Leaflet (css en js) pas laden als de kaart voor het eerst opengaat, en daarna niet opnieuw. */
function loadLeaflet() {
  leaflet ??= Promise.all([
    addToHead('link', { rel: 'stylesheet', href: '/leaflet.css' }),
    addToHead('script', { src: '/leaflet.js' }),
  ]).then(() => window.L, (e) => { leaflet = null; throw e; });
  return leaflet;
}

/** Voegt een <link> of <script> toe en wacht tot hij geladen is. Mislukt het, dan gaat hij weer weg (opnieuw proberen kan). */
function addToHead(tag, props) {
  return new Promise((resolve, reject) => {
    const node = el(tag, { ...props, onload: resolve, onerror: () => { node.remove(); reject(new Error(t('map.load_failed'))); } });
    document.head.append(node);
  });
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;
const clampRadius = (r) => Math.min(RADIUS.max, Math.max(RADIUS.min, Math.round(r / RADIUS.step) * RADIUS.step));

/** Melding bij een mislukte actie op de favorieten. */
function placeError(e) {
  if (e.status === 409) toast(t('map.favorite_exists'));
  else if (e instanceof Offline) toast(t('map.online_only'));
  else toast(e.status ? e.message : t('map.something_wrong'));
}

let isOpen = false;

/** Opent het kaartscherm. Geeft de gekozen plek ({ name, lat, lng, radius, trigger }), of undefined bij Sluiten. */
export const openMap = (task) => openScreen({ loc: task.location ?? null, place: undefined });

/**
 * Kaartscherm voor een favoriete plek: `null` voegt er een toe, een plek wijzigt of verwijdert die.
 * Geeft true als er iets is opgeslagen of verwijderd.
 */
export const editPlace = async (place) => !!(await openScreen({ loc: place, place }));

async function openScreen(mode) {
  if (navigator.onLine === false) {
    toast(t('map.map_online_only'));
    return undefined;
  }
  if (isOpen) return undefined;
  isOpen = true;
  try {
    const L = await loadLeaflet();
    return await new Promise((resolve) => buildScreen(L, mode, resolve));
  } catch {
    // Ging het mis halverwege het opbouwen, dan mag het scherm niet half blijven staan.
    document.querySelector('.mapscreen')?.remove();
    document.body.classList.remove('map-open');
    toast(t('map.could_not_load'));
    return undefined;
  } finally {
    isOpen = false;
  }
}

/** mode.place: undefined bij een taak; null (nieuw) of een plek bij het beheren van favorieten. */
function buildScreen(L, { loc, place }, resolve) {
  const managing = place !== undefined;
  let trigger = loc?.trigger ?? 'enter';
  // Een favoriet heeft geen trigger; die krijgt de standaard van aankomst.
  let radius = clampRadius(loc?.radius ?? RADIUS.default[managing ? 'enter' : trigger]);
  // Zolang je de straal niet zelf kiest, schuift hij mee met de trigger. Een bestaande plek heeft al een eigen straal.
  let radiusChosen = !!loc;
  let chosenFav = null; // gekozen favoriet; vervalt als je de kaart of de straal daarna zelf verandert
  let autoName = loc?.name ?? ''; // naam voor de taak: van de bestaande plek of het laatste zoekresultaat
  let userMoved = false; // na een eigen actie springt de kaart niet meer naar je huidige locatie
  let result, closing = false, finished = false;

  // ---------- elementen ----------
  const query = el('input', { type: 'search', placeholder: t('map.search_placeholder'), 'aria-label': t('map.search_label'), enterkeyhint: 'search', autocomplete: 'off' });
  const results = el('ul', { class: 'mapresults', hidden: true });
  const mapEl = el('div', { class: 'map' });
  const myLoc = el('button', { type: 'button', class: 'ghost myloc' }, el('span', { 'aria-hidden': 'true' }, '◎'), t('map.my_location'));
  const chips = el('div', { class: 'chips favs', role: 'group', 'aria-label': t('map.favorites') });
  const favEmpty = el('p', { class: 'mapnote' }, t('map.no_favorites'));
  const range = el('input', { type: 'range', min: RADIUS.min, max: RADIUS.max, step: RADIUS.step, value: radius, 'aria-label': t('map.radius') });
  const radiusValue = el('strong', {}, formatRadius(radius));
  const radiusHint = el('p', { class: 'mapnote' });
  const whenNote = el('p', { class: 'mapnote' });
  const enterBtn = el('button', { type: 'button', class: 'ghost' }, t('map.on_arrive'));
  const exitBtn = el('button', { type: 'button', class: 'ghost' }, t('map.on_leave'));
  // Alleen bij het beheren van een favoriet een vast naamveld; bij een taak krijgt de plek vanzelf een naam.
  const name = el('input', { value: loc?.name ?? '', placeholder: t('map.favorite_name'), maxlength: 100, autocomplete: 'off' });
  const favName = el('input', { maxlength: 100, autocomplete: 'off', enterkeyhint: 'done' });
  const favRow = el('form', { class: 'favsave', hidden: true, onsubmit: (e) => { e.preventDefault(); saveFavorite(); } },
    el('label', {}, t('map.favorite_name'), favName),
    el('button', { type: 'submit' }, t('map.save')),
    el('button', { type: 'button', class: 'ghost', 'aria-label': t('map.cancel'), onclick: () => { favRow.hidden = true; } }, '✕'));
  const actions = managing
    ? [el('button', { type: 'button', onclick: saveManaged }, t('map.save')),
      place ? el('button', { type: 'button', class: 'danger', onclick: deleteManaged }, t('map.delete')) : null,
      el('button', { type: 'button', class: 'ghost', onclick: () => close(undefined) }, t('map.cancel'))]
    : [el('button', { type: 'button', onclick: use }, t('map.use_place')),
      el('button', { type: 'button', class: 'ghost', onclick: openFavRow }, t('map.save_favorite')),
      el('button', { type: 'button', class: 'ghost', onclick: () => close(undefined) }, t('map.close'))];
  const title = managing ? (place ? t('map.edit_place') : t('map.new_place')) : t('map.choose_place');

  const screen = el('div', { class: 'mapscreen', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
    el('form', { class: 'mapsearch', onsubmit: (e) => { e.preventDefault(); search(); } },
      query, el('button', { type: 'submit' }, t('map.search_button'))),
    results,
    el('div', { class: 'mapwrap' }, mapEl, el('div', { class: 'pin', 'aria-hidden': 'true' }, '📍'), myLoc),
    el('div', { class: 'mappanel' },
      el('div', { class: 'mapbody' },
        managing
          ? el('label', { class: 'mapsec' }, el('span', { class: 'maph' }, t('map.favorite_name')), name)
          : el('section', { class: 'mapsec' }, el('h3', { class: 'maph' }, t('map.favorites')), chips, favEmpty),
        managing ? null : el('section', { class: 'mapsec' },
          el('h3', { class: 'maph' }, t('map.when')),
          el('div', { class: 'seg', role: 'group', 'aria-label': t('map.when') }, enterBtn, exitBtn),
          whenNote),
        el('section', { class: 'mapsec' },
          el('h3', { class: 'maph' }, el('span', {}, t('map.radius')), radiusValue),
          range, radiusHint)),
      el('div', { class: 'mapfoot' }, managing ? null : favRow, el('div', { class: 'actions' }, ...actions))),
  );
  document.body.append(screen);
  document.body.classList.add('map-open');

  // ---------- kaart ----------
  // De pin staat vast midden op het scherm en de plek is het midden van de kaart: zoomen moet dus rond dat midden,
  // niet rond je vinger of muis, anders schuift de plek onder de pin vandaan.
  const map = L.map(mapEl, { zoomControl: true, scrollWheelZoom: 'center', doubleClickZoom: 'center', touchZoom: 'center' });
  L.tileLayer(TILES, { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin', attribution: '© OpenStreetMap' }).addTo(map);
  if (loc) map.setView([loc.lat, loc.lng], ZOOM);
  else map.setView(NL, 7);
  const circle = L.circle(map.getCenter(), { radius, className: 'loc-circle', interactive: false }).addTo(map);
  map.on('move', () => circle.setLatLng(map.getCenter()));
  map.on('dragstart zoomstart', () => { userMoved = true; });
  map.on('dragstart', () => markFav(null));

  const go = (lat, lng) => {
    if (finished) return; // antwoord van zoeken of GPS kwam pas na het sluiten
    userMoved = true;
    map.setView([lat, lng], Math.max(map.getZoom(), ZOOM));
  };

  if (!loc && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (p) => { if (!userMoved && !finished) map.setView([p.coords.latitude, p.coords.longitude], ZOOM); },
      () => {}, // dan blijft Nederland staan
      { timeout: 5000 },
    );
  }

  myLoc.addEventListener('click', () => {
    if (!navigator.geolocation) { toast(t('map.location_unavailable')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => go(p.coords.latitude, p.coords.longitude),
      () => toast(t('map.location_unavailable')),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });

  // ---------- straal en trigger ----------
  const showHints = () => {
    whenNote.textContent = t(trigger === 'exit' ? 'map.when_exit_note' : 'map.when_enter_note');
    radiusHint.textContent = t(!managing && trigger === 'enter' ? 'map.radius_enter_hint' : 'map.radius_exit_hint');
  };
  const setRadius = (r) => {
    radius = clampRadius(r);
    range.value = radius;
    radiusValue.textContent = formatRadius(radius);
    circle.setRadius(radius);
  };
  range.addEventListener('input', () => { radiusChosen = true; markFav(null); setRadius(Number(range.value)); });

  const setTrigger = (v) => {
    trigger = v;
    enterBtn.setAttribute('aria-pressed', String(v === 'enter'));
    exitBtn.setAttribute('aria-pressed', String(v === 'exit'));
    if (!radiusChosen) setRadius(RADIUS.default[v]);
    showHints();
  };
  enterBtn.addEventListener('click', () => setTrigger('enter'));
  exitBtn.addEventListener('click', () => setTrigger('exit'));
  setTrigger(trigger);

  // ---------- zoeken ----------
  async function search() {
    const q = query.value.trim();
    if (q.length < 2) return;
    let found;
    try {
      found = await geocode(q);
    } catch (e) {
      toast(e instanceof Offline ? t('map.search_offline') : e.status ? e.message : t('map.something_wrong'));
      return;
    }
    results.replaceChildren(...(found.length
      ? found.map((r) => el('li', {}, el('button', { type: 'button', class: 'ghost', onclick: () => pick(r) }, r.name)))
      : [el('li', { class: 'none' }, t('map.nothing_found'))]));
    results.hidden = false;
  }

  function pick(r) {
    go(r.lat, r.lng);
    markFav(null);
    autoName = r.name.split(',')[0].trim();
    if (managing && !name.value.trim()) name.value = autoName;
    results.hidden = true;
    results.replaceChildren();
  }

  // ---------- favorieten ----------
  async function refreshPlaces(select) {
    let places;
    try {
      places = await loadPlaces();
    } catch {
      places = [];
    }
    chips.replaceChildren(...places.map(favChip));
    chips.hidden = !places.length;
    favEmpty.hidden = !!places.length;
    if (select) markFav(places.find((p) => p.name === select) ?? null);
    // Een bestaande plek die precies een favoriet is: die favoriet staat dan al gekozen.
    else if (loc && !chosenFav && !userMoved && radius === loc.radius) {
      markFav(places.find((p) => p.name === loc.name && p.lat === loc.lat && p.lng === loc.lng && p.radius === loc.radius) ?? null);
    }
  }

  /** Markeert de gekozen favoriet (of geen). */
  function markFav(p) {
    chosenFav = p;
    for (const b of chips.querySelectorAll('.fav > button:first-child')) b.setAttribute('aria-pressed', String(!!p && b.dataset.id === p.id));
  }

  function favChip(p) {
    let pressTimer, longPressed = false;
    const choose = el('button', {
      type: 'button',
      'data-id': p.id,
      'aria-pressed': String(chosenFav?.id === p.id),
      onclick: () => {
        if (longPressed) { longPressed = false; return; }
        go(p.lat, p.lng);
        radiusChosen = true;
        setRadius(p.radius);
        markFav(p);
      },
      onpointerdown: () => { longPressed = false; pressTimer = setTimeout(() => { longPressed = true; editPlace(p); }, LONG_PRESS_MS); },
      onpointerup: () => clearTimeout(pressTimer),
      onpointerleave: () => clearTimeout(pressTimer),
      onpointercancel: () => clearTimeout(pressTimer),
      oncontextmenu: (e) => e.preventDefault(),
    }, p.name);
    const edit = el('button', { type: 'button', class: 'edit-fav', title: t('map.edit_favorite'), 'aria-label': t('map.edit_favorite_label', { name: p.name }), onclick: () => editPlace(p) }, '✎');
    return el('span', { class: 'fav' }, choose, edit);
  }

  /** Hernoemen, of met een lege naam verwijderen. Taken met een kopie van deze plek houden die gewoon. */
  async function editPlace(p) {
    const answer = prompt(t('map.rename_prompt', { name: p.name }), p.name);
    if (answer === null) return;
    const newName = answer.trim();
    try {
      if (!newName) {
        const yes = await ask({ title: t('map.confirm_delete', { name: p.name }), text: t('map.delete_note'), buttons: [
          { label: t('map.delete'), value: 'yes', kind: 'danger' }, { label: t('map.cancel'), value: null, kind: 'ghost' }] });
        if (!yes) return;
        await deletePlace(p.id);
      } else if (newName !== p.name) {
        await renamePlace(p.id, newName);
      } else return;
    } catch (e) {
      placeError(e);
      return;
    }
    refreshPlaces();
  }

  /** Klapt onderin de regel open om de plek als favoriet te bewaren, met de naam die de plek nu zou krijgen. */
  function openFavRow() {
    favRow.hidden = false;
    favName.value = chosenFav?.name ?? autoName;
    favName.focus();
    favName.select();
  }

  async function saveFavorite() {
    const n = favName.value.trim();
    if (!n) { toast(t('map.name_needed')); favName.focus(); return; }
    const c = center();
    try {
      await savePlace({ name: n, lat: c.lat, lng: c.lng, radius });
    } catch (e) {
      placeError(e);
      return;
    }
    favRow.hidden = true;
    await refreshPlaces(n);
  }

  // Bij het beheren van een favoriet horen de knoppen van de andere favorieten er niet bij.
  if (!managing) refreshPlaces();

  /** Favoriet opslaan vanuit de instellingen; het scherm blijft open als het niet lukt. */
  async function saveManaged() {
    const n = name.value.trim();
    if (!n) { toast(t('map.name_needed')); name.focus(); return; }
    const p = { name: n, ...center(), radius };
    try {
      if (place) await updatePlace(place.id, p);
      else await savePlace(p);
    } catch (e) {
      placeError(e);
      return;
    }
    close(true);
  }

  async function deleteManaged() {
    const yes = await ask({ title: t('map.confirm_delete', { name: place.name }), text: t('map.delete_note'), buttons: [
      { label: t('map.delete'), value: 'yes', kind: 'danger' }, { label: t('map.cancel'), value: null, kind: 'ghost' }] });
    if (!yes) return;
    try {
      await deletePlace(place.id);
    } catch (e) {
      placeError(e);
      return;
    }
    close(true);
  }

  // ---------- klaar ----------
  function center() {
    const c = map.getCenter().wrap();
    return { lat: round6(c.lat), lng: round6(c.lng) };
  }

  function use() {
    close({ name: chosenFav?.name ?? (autoName || t('map.pinned_place')), ...center(), radius, trigger });
  }

  // Eigen history-item: de terugknop sluit dan de kaart in plaats van de app te verlaten.
  history.pushState({ tickMap: true }, '');

  function close(value) {
    if (closing) return;
    closing = true;
    result = value;
    history.back(); // onPop ruimt op; wacht daarop zodat er daarna geen navigatie meer loopt
    setTimeout(finish, 500); // vangnet als er geen popstate komt
  }

  function finish() {
    if (finished) return;
    finished = true;
    window.removeEventListener('popstate', finish);
    document.removeEventListener('keydown', onKey);
    map.remove();
    screen.remove();
    document.body.classList.remove('map-open');
    resolve(result);
  }

  function onKey(e) {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (e.target === query && query.value) { // net als het zoekveld van de lijst: eerst alleen leegmaken
      query.value = '';
      results.hidden = true;
      return;
    }
    close(undefined);
  }

  window.addEventListener('popstate', finish);
  document.addEventListener('keydown', onKey);
  screen.focus();
}
