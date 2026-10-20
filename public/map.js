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
const radiusText = (r) => t('map.radius_value', { radius: formatRadius(r) });

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
  let radius = loc?.radius ?? RADIUS.default;
  let trigger = loc?.trigger ?? 'enter';
  let userMoved = false; // na een eigen actie springt de kaart niet meer naar je huidige locatie
  let result, closing = false, finished = false;

  // ---------- elementen ----------
  const query = el('input', { type: 'search', placeholder: t('map.search_placeholder'), 'aria-label': t('map.search_label'), enterkeyhint: 'search', autocomplete: 'off' });
  const results = el('ul', { class: 'mapresults', hidden: true });
  const mapEl = el('div', { class: 'map' });
  const myLoc = el('button', { type: 'button', class: 'ghost myloc', title: t('map.my_location'), 'aria-label': t('map.my_location') }, '◎');
  const chips = el('div', { class: 'chips favs', role: 'group', 'aria-label': t('map.favorites'), hidden: true });
  const range = el('input', { type: 'range', min: RADIUS.min, max: RADIUS.max, step: RADIUS.step, value: radius, 'aria-label': t('map.radius') });
  const rangeLabel = el('span', {}, radiusText(radius));
  const enterBtn = el('button', { type: 'button', class: 'ghost' }, t('map.on_arrive'));
  const exitBtn = el('button', { type: 'button', class: 'ghost' }, t('map.on_leave'));
  const name = el('input', { value: loc?.name ?? '', placeholder: managing ? t('map.favorite_name') : t('map.pinned_place'), maxlength: 100, autocomplete: 'off' });
  const actions = managing
    ? [el('button', { type: 'button', onclick: saveManaged }, t('map.save')),
      place ? el('button', { type: 'button', class: 'danger', onclick: deleteManaged }, t('map.delete')) : null,
      el('button', { type: 'button', class: 'ghost', onclick: () => close(undefined) }, t('map.cancel'))]
    : [el('button', { type: 'button', onclick: use }, t('map.use_place')),
      el('button', { type: 'button', class: 'ghost', onclick: saveFavorite }, t('map.save_favorite')),
      el('button', { type: 'button', class: 'ghost', onclick: () => close(undefined) }, t('map.close'))];
  const title = managing ? (place ? t('map.edit_place') : t('map.new_place')) : t('map.choose_place');

  const screen = el('div', { class: 'mapscreen', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
    el('form', { class: 'mapsearch', onsubmit: (e) => { e.preventDefault(); search(); } },
      query, el('button', { type: 'submit' }, t('map.search_button'))),
    results,
    el('div', { class: 'mapwrap' }, mapEl, el('div', { class: 'pin', 'aria-hidden': 'true' }, '📍'), myLoc),
    el('div', { class: 'mappanel' },
      chips,
      el('label', {}, rangeLabel, range),
      managing ? null : el('div', { class: 'seg', role: 'group', 'aria-label': t('map.when') }, enterBtn, exitBtn),
      el('label', {}, t('map.name'), name),
      el('div', { class: 'actions' }, ...actions)),
  );
  document.body.append(screen);
  document.body.classList.add('map-open');

  // ---------- kaart ----------
  const map = L.map(mapEl, { zoomControl: true });
  L.tileLayer(TILES, { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin', attribution: '© OpenStreetMap' }).addTo(map);
  if (loc) map.setView([loc.lat, loc.lng], ZOOM);
  else map.setView(NL, 7);
  const circle = L.circle(map.getCenter(), { radius, className: 'loc-circle', interactive: false }).addTo(map);
  map.on('move', () => circle.setLatLng(map.getCenter()));
  map.on('dragstart zoomstart', () => { userMoved = true; });

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
  const setRadius = (r) => {
    radius = clampRadius(r);
    range.value = radius;
    rangeLabel.textContent = radiusText(radius);
    circle.setRadius(radius);
  };
  range.addEventListener('input', () => setRadius(Number(range.value)));

  const setTrigger = (v) => {
    trigger = v;
    enterBtn.setAttribute('aria-pressed', String(v === 'enter'));
    exitBtn.setAttribute('aria-pressed', String(v === 'exit'));
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
    name.value = r.name.split(',')[0].trim();
    results.hidden = true;
    results.replaceChildren();
  }

  // ---------- favorieten ----------
  async function refreshPlaces() {
    let places;
    try {
      places = await loadPlaces();
    } catch {
      places = [];
    }
    chips.replaceChildren(...places.map(favChip));
    chips.hidden = !places.length;
  }

  function favChip(p) {
    let pressTimer, longPressed = false;
    const choose = el('button', {
      type: 'button',
      onclick: () => {
        if (longPressed) { longPressed = false; return; }
        go(p.lat, p.lng);
        setRadius(p.radius);
        name.value = p.name;
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
        if (!confirm(t('map.confirm_delete', { name: p.name }))) return;
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

  async function saveFavorite() {
    const answer = prompt(t('map.favorite_name'), name.value.trim());
    if (answer === null || !answer.trim()) return;
    const c = center();
    try {
      await savePlace({ name: answer.trim(), lat: c.lat, lng: c.lng, radius });
    } catch (e) {
      placeError(e);
      return;
    }
    if (!name.value.trim()) name.value = answer.trim();
    refreshPlaces();
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
    close({ name: name.value.trim() || t('map.pinned_place'), ...center(), radius, trigger });
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
